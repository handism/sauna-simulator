"""Measure the parallax of a cube capture above the water for underwater glossy lobes.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/diagnose_water_above_capture.py -- --out DIR

The lobes of diagnose_water_reflection_targets.py are sampled again (same
endpoints, roughness and seeds, daylight scene without lights). Terminals that
left the water and hit a surface above it (above_water) or nothing (sky) are
looked up in candidate captures: one probe over the pool centre at several
heights, the nearest probe of a grid, and box-projected versions of both. The
report compares the object and position the capture returns with the true hit.
Geometry only: no radiance, and the source blend is not saved.
"""
import argparse
from collections import defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from diagnose_water_reflection_targets import WATER, classify, glb_materials, stratified  # noqa: E402
from water_capture_parallax import (FAR, angle_degrees, axis_box, box_lookup, compare, grid_probes,  # noqa: E402
                                    nearest, nested_box_lookup, weighted_quantile)
from water_reflection_trace import dot, normalize, sample_ggx_reflection, schlick, trace_branches  # noqa: E402

HEIGHTS = (0.02, 0.1, 0.3)
GRID_HEIGHT = 0.1
GRIDS = ((2, 2), (3, 3), (4, 6))
# Outer (courtyard) proxy: axis rays from this height above the water top, above the tub walls.
OUTER_HEIGHT = 1.0
TOLERANCES = (0.02, 0.1)
ANGLES = (2, 5, 10)
IMAGE_METHODS = ('center_h0.10', 'box_grid3x3', 'nested_center_h0.10', 'nested_grid3x3')


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--glb', type=Path, default=Path('public/models/sauna.glb'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=64, help='lobe samples per endpoint (square)')
    parser.add_argument('--limit', type=int, help='first N endpoints only (smoke test)')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    if source_hash != metadata['input_sha256']:
        raise RuntimeError('Fixtures belong to a different blend')
    with gzip.open(args.input / 'trace-rays.json.gz', 'rt') as stream:
        records = json.load(stream)['original']
    materials = glb_materials(args.glb)
    scene = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    water_obj = scene.objects[WATER]
    evaluated = water_obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    water_tree = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices],
                                      [list(p.vertices) for p in mesh.polygons])
    evaluated.to_mesh_clear()
    bounds = metadata['water_bounds']

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
    print('CAPTURE_BVH', len(vertices), len(polygons), flush=True)
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

    (x0, y0, z0), (x1, y1, z1) = bounds
    center_xy = ((x0 + x1) / 2, (y0 + y1) / 2)
    probe_info = {}

    def describe(probe):
        """Axis-ray proxy box and whether the probe sits inside a closed mesh (a back face is hit first)."""
        if probe not in probe_info:
            hits = {d: surface(probe, d, 'camera') for d in
                    ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))}
            box = axis_box(probe, lambda c, d: hits[d] and hits[d]['distance'], z0)
            inside = [list(d) for d, h in hits.items() if h and dot(h['normal'], d) > 0]
            probe_info[probe] = {'position': list(probe), 'box': [list(box[0]), list(box[1])],
                                 'axis_hits': {','.join(str(v) for v in d): h and [h['object'], round(h['distance'], 4)]
                                               for d, h in hits.items()},
                                 'back_faces': inside}
        return probe_info[probe]

    def nested(probe):
        """Tub box capped at the lowest wall top, inside a courtyard box measured above the walls."""
        info = describe(probe)
        if 'nested' not in info:
            lower, upper = info['box']
            tops = {}
            for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)):
                wall = surface(probe, d, 'camera')
                if wall is None:
                    continue
                inside = tuple(a + b * 0.02 for a, b in zip(wall['position'], d))
                top = surface((inside[0], inside[1], z1 + OUTER_HEIGHT), (0, 0, -1), 'camera')
                tops[','.join(str(v) for v in d)] = top and [top['object'], round(top['position'][2], 4)]
            wall_top = min(t[1] for t in tops.values() if t)
            outer = describe((probe[0], probe[1], z1 + OUTER_HEIGHT))['box']
            info['nested'] = {'wall_tops': tops, 'boxes': [[lower, [upper[0], upper[1], wall_top]], outer]}
        return [[tuple(v) for v in box] for box in info['nested']['boxes']]

    methods = {}
    for h in HEIGHTS:
        probe = (center_xy[0], center_xy[1], z1 + h)
        methods[f'center_h{h:.2f}'] = (lambda o, d, p=probe: (p, d))
    for h in (GRID_HEIGHT,):
        probe = (center_xy[0], center_xy[1], z1 + h)
        box = [tuple(v) for v in describe(probe)['box']]
        methods[f'box_center_h{h:.2f}'] = (lambda o, d, p=probe, b=box: (p, box_lookup(o, d, p, b)))
        boxes = nested(probe)
        methods[f'nested_center_h{h:.2f}'] = (lambda o, d, p=probe, b=boxes: (p, nested_box_lookup(o, d, p, b)))
    for nx, ny in GRIDS:
        probes = grid_probes((x0, y0), (x1, y1), nx, ny, z1 + GRID_HEIGHT)
        methods[f'grid{nx}x{ny}'] = (lambda o, d, ps=probes: (nearest(o, ps), d))
        boxes = {p: [tuple(v) for v in describe(p)['box']] for p in probes}
        methods[f'box_grid{nx}x{ny}'] = (lambda o, d, ps=probes, bs=boxes:
                                         (lambda p: (p, box_lookup(o, d, p, bs[p])))(nearest(o, ps)))
        if (nx, ny) != (2, 2):
            proxies = {p: nested(p) for p in probes}
            methods[f'nested_grid{nx}x{ny}'] = (lambda o, d, ps=probes, bs=proxies:
                                                (lambda p: (p, nested_box_lookup(o, d, p, bs[p])))(nearest(o, ps)))
    names = list(methods)
    print('CAPTURE_METHODS', names, flush=True)

    # Accumulators: per method and truth category, weighted matches and error lists.
    categories = ('above_water', 'sky')
    sums = {n: {c: defaultdict(float) for c in categories} for n in names}
    errors = {n: {'position': [], 'angle': [], 'weight': []} for n in names}
    by_object = defaultdict(lambda: defaultdict(float))
    by_group = defaultdict(lambda: defaultdict(float))
    totals = defaultdict(float)
    segment_lengths = ([], [])
    spreads = ([], [])
    width, height = metadata['resolution']
    images = {n: np.full((height, width, 3), 0.035, dtype=np.float32) for n in IMAGE_METHODS}

    reached = [r for r in records if r.get('hit') and r['events']][:args.limit]
    for number, record in enumerate(reached):
        hit = record['hit']
        point = hit['position']
        view = normalize(tuple(a - b for a, b in zip(record['events'][-1]['position'], point)))
        normal = normalize(hit['normal'])
        if dot(view, normal) < 0:
            normal = tuple(-n for n in normal)
        params = materials.get(hit['material'], {'roughness': 0.5, 'f0': 0.04})
        alpha = max(params['roughness'], 1e-3) ** 2
        rng = random.Random(number)  # same seeds as the population pass of the targets diagnosis
        lobe_total = 0.0
        pixel = defaultdict(float)
        pixel_weight = 0.0
        exits = []
        family = ('tile' if 'pool tile' in (hit['material'] or '') else
                  'wall' if 'quiet honed stone' in (hit['material'] or '') else
                  'base' if hit['material'] == 'Blackened bronze' else 'other')
        group = f"{record['first_exit']}/{family}"
        for u1, u2 in stratified(args.samples, rng):
            sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
            if sample is None:
                continue
            direction, weight, cos_vh = sample
            weight *= schlick(params['f0'], cos_vh)
            lobe_total += weight
            for terminal in trace_branches(point, direction, water, surface, weight=weight):
                category = classify(terminal, bounds, lambda _: True)
                totals[category] += terminal['weight']
                if category not in categories:
                    continue
                w = terminal['weight']
                origin, d = terminal['origin'], terminal['direction']
                last = terminal['events'][-1][0] if terminal['events'] else 'reflect'
                visibility = 'transmission' if last in {'exit', 'enter'} else 'glossy'
                truth = terminal.get('hit')
                if truth:
                    segment_lengths[0].append(truth['distance'])
                    segment_lengths[1].append(w)
                    by_object[truth['object']]['weight'] += w
                by_group[group][category] += w
                pixel_weight += w
                exits.append((d, w))
                for name in names:
                    probe, lookup = methods[name](origin, d)
                    acc = sums[name][category]
                    acc['weight'] += w
                    if lookup is None:  # segment origin outside the proxy box: fall back to the direction
                        acc['outside_box'] += w
                        lookup = d
                    found = surface(probe, lookup, visibility)
                    for tolerance in TOLERANCES:
                        if compare(truth, found, tolerance):
                            acc[f'match_{tolerance:g}'] += w
                            if tolerance == 0.1:
                                by_group[group][name] += w
                                if truth:
                                    by_object[truth['object']][name] += w
                                if name in images:
                                    pixel[name] += w
                    if truth is None:
                        continue
                    if found is not None and found['object'] == truth['object']:
                        acc['same_object'] += w
                    toward = tuple(a - b for a, b in zip(truth['position'], probe))
                    seen = surface(probe, normalize(toward), visibility)
                    if seen is not None and seen['object'] == truth['object'] and \
                            math.dist(seen['position'], truth['position']) <= 0.02:
                        acc['visible_from_probe'] += w
                    errors[name]['position'].append(math.dist(found['position'], truth['position'])
                                                    if found else math.inf)
                    error = angle_degrees(lookup, toward)
                    for limit in ANGLES:
                        if error < limit:
                            acc[f'angle_lt_{limit}'] += w
                    errors[name]['angle'].append(error)
                    errors[name]['weight'].append(w)
        totals['lobe'] += lobe_total
        if exits:
            # Spread of the lobe that left the water: median deviation from its mean direction.
            mean = normalize(tuple(sum(d[i] * w for d, w in exits) for i in range(3)))
            spreads[0].append(weighted_quantile([angle_degrees(d, mean) for d, _ in exits], [w for _, w in exits], 0.5))
            spreads[1].append(pixel_weight / lobe_total)
        if pixel_weight > 0:
            col, row = record['pixel']
            for name in images:
                good = pixel[name] / pixel_weight
                images[name][row, col] = (1 - good, good, 0.15)
        if number % 500 == 0:
            print('CAPTURE_PROGRESS', number, len(reached), flush=True)

    def quantiles(values, weights):
        return {f'p{int(q * 100)}': (lambda v: None if v is None or math.isinf(v) else round(v, 5))(
            weighted_quantile(values, weights, q)) for q in (0.5, 0.75, 0.9)}

    report_methods = {}
    for name in names:
        entry = {}
        for category in categories:
            acc = sums[name][category]
            total = acc['weight'] or 1
            entry[category] = {k: v / total for k, v in sorted(acc.items()) if k != 'weight'}
            entry[category]['weight_share_of_lobe'] = acc['weight'] / totals['lobe']
        entry['above_water']['position_error_m'] = quantiles(errors[name]['position'], errors[name]['weight'])
        entry['above_water']['lookup_angle_error_deg'] = quantiles(errors[name]['angle'], errors[name]['weight'])
        report_methods[name] = entry
    top_objects = sorted(by_object.items(), key=lambda item: -item[1]['weight'])[:15]
    above_total = sums[names[0]]['above_water']['weight']
    report = {
        'input_sha256': source_hash, 'trace_sha256': sha(args.input / 'trace-rays.json.gz'),
        'glb_sha256': sha(args.glb), 'script_sha256': sha(Path(__file__)),
        'helper_sha256': {name: sha(Path(__file__).with_name(name)) for name in
                          ('water_capture_parallax.py', 'water_reflection_trace.py',
                           'diagnose_water_reflection_targets.py')},
        'blender': bpy.app.version_string, 'coordinates': 'Blender Z-up, meters',
        'water_bounds': bounds, 'samples': args.samples, 'endpoints': len(reached),
        'heights_above_water_top': HEIGHTS, 'grid_height': GRID_HEIGHT, 'grids': GRIDS, 'outer_height': OUTER_HEIGHT,
        'tolerances_m': TOLERANCES, 'far_m': FAR,
        'category_share_of_lobe': {k: v / totals['lobe'] for k, v in sorted(totals.items()) if k != 'lobe'},
        'segment_length_m': quantiles(*segment_lengths),
        'exit_lobe_median_spread_deg': quantiles(*spreads),
        'angle_thresholds_deg': ANGLES,
        'methods': report_methods,
        'probes': list(probe_info.values()),
        'objects': [{'object': name, 'share_of_above_water': v['weight'] / above_total,
                     **{f'match_0.1_{m}': v[m] / v['weight'] for m in names}} for name, v in top_objects],
        'groups': {g: {'above_water_weight': v['above_water'], 'sky_weight': v['sky'],
                       **{f'match_0.1_{m}': v[m] / ((v['above_water'] + v['sky']) or 1) for m in names}}
                   for g, v in sorted(by_group.items())},
        'limitations': [
            'Geometry only: whether the capture returns the same object and place, not its colour.',
            'Lobes as in water-reflection-targets (single-scattering GGX, exported roughness, scalar F0, geometric '
            'normals, smooth water) but without lights: terminals on lights (0.1%) fall through to what is behind.',
            'Lookups use the ray visibility of the true last segment (transmission after leaving the water), '
            'not a camera render of the capture; a baked cube would need the same visibility.',
            'Proxy boxes come from axis rays of each probe (nothing hit: 50 m) and reach down to the water bottom; '
            'a segment starting outside its box falls back to the direction lookup.',
            'Nested proxies: the tub box is capped at the lowest of the four wall tops found below the probe\'s axis '
            'hits; the courtyard box comes from axis rays 1 m above the water top at the same XY.',
            'Camera 03 static waves only; the product water mesh is not used.',
            'position_error_m quantiles are null where the capture returns the sky for a surface hit (infinite error).',
        ],
    }
    for name, image in images.items():
        target = bpy.data.images.new('capture-' + name, width=width, height=height, alpha=True)
        rgba = np.ones((height, width, 4), dtype=np.float32)
        rgba[:, :, :3] = image
        target.pixels.foreach_set(rgba[::-1].flatten())
        target.filepath_raw = str((args.out / f'match-{name}.png').resolve())
        target.file_format = 'PNG'
        target.save()
        bpy.data.images.remove(target)
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report['source_unchanged'] = True
    (args.out / 'capture.json').write_text(json.dumps(report, indent=2) + '\n')
    print('CAPTURE_DONE', flush=True)


if __name__ == '__main__':
    main()
