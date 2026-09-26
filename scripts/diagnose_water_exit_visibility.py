"""Bake how much light each direction brings from above the water, traced through the source scene.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/diagnose_water_exit_visibility.py -- --out DIR

For the endpoints of diagnose_water_capture_radiance.py and the cell-centred
grid nodes around them (several spacings, see water_exit_visibility.Grid), a
fixed Fibonacci set of directions over the whole sphere is followed through the
source water with both Fresnel branches (water_reflection_trace.py, the same
scene BVH and visibility as the capture radiance diagnosis). The traced exit
weight is the summed weight of the terminals that leave the water (above_water
or sky). A node counts as inside solid geometry when more than a quarter of its
directions first hit a back face.

For the endpoints on the pool floor (normal within 45 degrees of up) a horizon
map is baked as well: at the endpoint and at the nodes of 2D cell-centred floor
grids around them (the floor found by a downward ray from the water level), the
highest elevation per azimuth at which a ray from 1 mm above the floor hits
scene geometry inside the water's bounding box (the tub walls outside it are
left to the box walk's sides). No radiance is rendered and the source
blend is not saved. summarize_water_exit_visibility.py compares the box walk
corrected by these tables with the truth.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from diagnose_water_reflection_targets import SCENES, WATER, classify  # noqa: E402
from water_exit_visibility import Grid, fibonacci_sphere  # noqa: E402
from water_reflection_trace import dot, normalize, trace_branches  # noqa: E402

SPACINGS = (0.05, 0.1, 0.2)
FLOOR_SPACINGS = (0.025, 0.05, 0.1)
AZIMUTHS = 16
ELEVATION_STEP = 1.0
LIFT = 0.001
BOX_INSET = 0.002
BACKFACE_LIMIT = 0.25
# Below the water bottom (0.215 m) down to the plinth and floor tiles (about 0.2 m).
FLOOR = 0.185
MARGIN = 0.02


def domain(bounds):
    (x0, y0, _), (x1, y1, z1) = bounds
    return (x0 - MARGIN, y0 - MARGIN, FLOOR), (x1 + MARGIN, y1 + MARGIN, z1)


def main():
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--terminals', type=Path, default=Path('blender/diagnostics/water-capture-radiance/terminals.json.gz'))
    parser.add_argument('--trace', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--directions', type=int, default=512)
    parser.add_argument('--limit', type=int, help='first N positions only (smoke test)')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    with gzip.open(args.terminals, 'rt') as stream:
        capture = json.load(stream)
    if capture['input_sha256'] != source_hash:
        raise RuntimeError('Terminals belong to a different blend')
    bounds = capture['water_bounds']
    scene = bpy.data.scenes[SCENES['day']]
    bpy.context.window.scene = scene
    deps = bpy.context.evaluated_depsgraph_get()
    water_obj = scene.objects[WATER]
    evaluated = water_obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    water_tree = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices],
                                      [list(p.vertices) for p in mesh.polygons])
    evaluated.to_mesh_clear()

    # Same scene BVH and visibility as diagnose_water_capture_radiance.py.
    vertices, polygons, owners = [], [], []
    for instance in deps.object_instances:
        obj = instance.object
        if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT', 'META'} or obj.original == water_obj or obj.hide_render:
            continue
        flags = (obj.visible_camera, obj.visible_glossy, obj.visible_transmission)
        if not any(flags):
            continue
        mesh = obj.to_mesh()
        if mesh is None:
            continue
        base = len(vertices)
        vertices.extend(instance.matrix_world @ v.co for v in mesh.vertices)
        for p in mesh.polygons:
            polygons.append(tuple(base + i for i in p.vertices))
            owners.append((obj.original.name, flags))
        obj.to_mesh_clear()
    scene_tree = BVHTree.FromPolygons(vertices, polygons)
    del vertices, polygons
    visibility_index = {'camera': 0, 'glossy': 1, 'transmission': 2}

    def surface(origin, direction, visibility):
        start, ray = Vector(origin), Vector(direction)
        for _ in range(64):
            position, normal, face, _ = scene_tree.ray_cast(start, ray)
            if position is None:
                return None
            name, flags = owners[face]
            if flags[visibility_index[visibility]]:
                return {'distance': float((position - Vector(origin)).length), 'position': tuple(position),
                        'normal': tuple(normal), 'object': name}
            start = position + ray * 1e-4
        raise RuntimeError('Too many invisible intersections')

    def water(origin, direction):
        _, normal, _, distance = water_tree.ray_cast(Vector(origin), Vector(direction))
        return (distance, tuple(normal)) if normal is not None else None

    def in_water(point):
        """Odd number of water boundary crossings straight up."""
        start, crossings = Vector(point), 0
        for _ in range(64):
            position, _, _, _ = water_tree.ray_cast(start, Vector((0, 0, 1)))
            if position is None:
                return crossings % 2 == 1
            crossings += 1
            start = position + Vector((0, 0, 1e-5))
        raise RuntimeError('Too many water crossings')

    positions = [{'kind': 'endpoint', 'endpoint': i, 'position': e['position']}
                 for i, e in enumerate(capture['endpoints'])]
    lower, upper = domain(bounds)
    grids = {}
    for spacing in SPACINGS:
        grid = Grid(lower, upper, spacing)
        needed = sorted({key for e in capture['endpoints'] for key, _ in grid.corners(e['position'])})
        grids[str(spacing)] = {'lower': list(lower), 'spacing': spacing, 'counts': list(grid.counts),
                               'nodes': [list(k) for k in needed]}
        positions.extend({'kind': 'node', 'spacing': spacing, 'index': list(k), 'position': list(grid.node(k))}
                         for k in needed)
    positions = positions[:args.limit]

    def inside_water_box(point):
        """Occluders stand inside the water's bounding box; the tub walls lie outside it (side walk of the box)."""
        (x0, y0, _), (x1, y1, z1) = bounds
        return x0 + BOX_INSET < point[0] < x1 - BOX_INSET and y0 + BOX_INSET < point[1] < y1 - BOX_INSET and point[2] < z1

    def horizon(point, normal):
        """Highest occluded elevation (degrees, bin top) per azimuth; 0 when nothing inside the water box blocks."""
        origin = tuple(p + LIFT * n for p, n in zip(point, normal))
        result = []
        for k in range(AZIMUTHS):
            phi = 2 * math.pi * k / AZIMUTHS
            top = 0.0
            for step in range(int(90 / ELEVATION_STEP)):
                elevation = math.radians((step + 0.5) * ELEVATION_STEP)
                d = (math.cos(elevation) * math.cos(phi), math.cos(elevation) * math.sin(phi), math.sin(elevation))
                hit = surface(origin, d, 'glossy')
                if hit is not None and inside_water_box(hit['position']):
                    top = (step + 1) * ELEVATION_STEP
            result.append(top)
        return result

    level = bounds[1][2]
    # Endpoint normals come from the traced paths, as in the capture radiance diagnosis.
    with gzip.open(args.trace / 'trace-rays.json.gz', 'rt') as stream:
        reached = [r for r in json.load(stream)['original'] if r.get('hit') and r['events']]
    floor_endpoints = []
    for i, e in enumerate(capture['endpoints']):
        normal = normalize(reached[e['reached_index']]['hit']['normal'])
        if abs(normal[2]) >= math.cos(math.pi / 4):
            floor_endpoints.append((i, e['position'], tuple(n * math.copysign(1, normal[2]) for n in normal)))
    horizons = {'azimuths': AZIMUTHS, 'elevation_step_degrees': ELEVATION_STEP, 'lift_m': LIFT, 'box_inset_m': BOX_INSET,
                'endpoints': {}, 'grids': {}}
    started = time.monotonic()
    for i, point, normal in floor_endpoints[:args.limit]:
        horizons['endpoints'][str(i)] = {'position': list(point), 'normal': list(normal),
                                         'horizon': horizon(point, normal)}
    for spacing in FLOOR_SPACINGS:
        grid = Grid((lower[0], lower[1], 0.0), (upper[0], upper[1], spacing), spacing)
        needed = sorted({key for _, point, _ in floor_endpoints for key, _ in grid.corners((point[0], point[1], 0.0))})
        nodes = []
        for key in needed[:args.limit]:
            x, y, _ = grid.node(key)
            hit = surface((x, y, level), (0.0, 0.0, -1.0), 'glossy')
            if hit is None:
                nodes.append({'index': list(key), 'floor': None})
                continue
            normal = normalize(hit['normal'])
            normal = tuple(n * math.copysign(1, normal[2]) for n in normal)
            nodes.append({'index': list(key), 'floor': list(hit['position']), 'normal': list(normal),
                          'object': hit['object'], 'horizon': horizon(hit['position'], normal)})
        horizons['grids'][str(spacing)] = {'lower': [lower[0], lower[1]], 'spacing': spacing,
                                           'counts': list(grid.counts[:2]), 'nodes': nodes}
    print('EXIT_VISIBILITY_HORIZONS', len(floor_endpoints), round(time.monotonic() - started, 1), flush=True)

    directions = fibonacci_sphere(args.directions)
    print('EXIT_VISIBILITY_POSITIONS', len(positions), len(directions), flush=True)

    started = time.monotonic()
    for number, entry in enumerate(positions):
        point = tuple(entry['position'])
        inner = entry['kind'] == 'node' and in_water(point)
        traced, backfaces = [], 0
        for d in directions:
            first = surface(point, d, 'glossy')
            edge = water(point, d)
            if first is not None and (edge is None or first['distance'] < edge[0]) and dot(first['normal'], d) > 0:
                backfaces += 1
            total = 0.0
            for terminal in trace_branches(point, d, water, surface, inside=inner):
                if classify(terminal, bounds, lambda _: True) in ('above_water', 'sky'):
                    total += terminal['weight']
            traced.append(total)
        entry.update({'in_water': inner, 'backface_share': backfaces / len(directions),
                      'valid': backfaces / len(directions) <= BACKFACE_LIMIT, 'traced': traced})
        if number % 50 == 0:
            print('EXIT_VISIBILITY', number, len(positions), round(time.monotonic() - started, 1), flush=True)

    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report = {'input_sha256': source_hash, 'script_sha256': sha(Path(__file__)),
              'helper_sha256': {name: sha(Path(__file__).with_name(name)) for name in
                                ('water_exit_visibility.py', 'water_reflection_trace.py',
                                 'diagnose_water_reflection_targets.py')},
              'terminals_sha256': sha(args.terminals), 'blender': bpy.app.version_string,
              'coordinates': 'Blender Z-up, meters', 'water_bounds': bounds, 'domain': [lower, upper],
              'directions': len(directions), 'backface_limit': BACKFACE_LIMIT, 'grids': grids,
              'trace_sha256': sha(args.trace / 'trace-rays.json.gz'), 'positions': positions, 'horizons': horizons,
              'elapsed_seconds': time.monotonic() - started, 'source_unchanged': True}
    with gzip.open(args.out / 'visibility.json.gz', 'wt') as stream:
        json.dump(report, stream)
    print('EXIT_VISIBILITY_DONE', report['elapsed_seconds'], flush=True)


if __name__ == '__main__':
    main()
