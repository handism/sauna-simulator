"""Trace the underwater glossy lobes with the water's geometric and interpolated shading normals.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/diagnose_water_shading_normals.py -- --out DIR

In the V11 source the water's side and bottom faces were single smooth strips
whose corner normals leaned 45 degrees, so Cycles refracted and totally
reflected there with normals that differ from the face normals used by
water_reflection_trace.py (flatten_water_sides.py has since made them flat).
Cycles shades smooth faces next to flat ones with vertex normals unless the
edge between them is sharp; this trace reads Blender's corner normals, which
split there either way.
For the 19 endpoints of diagnose_water_radiance.py the glossy lobe of
diagnose_water_capture_radiance.py (same GLB roughness, F0 and seeds) is traced
through the water twice: with face normals, and with the corner normals
interpolated over the triangle as Cycles does (the material bump is left out;
inside/outside still flips at every transmission). No radiance is rendered:
the terminals that leave the water are written for
summarize_water_gloss_mismatch.py, which looks them up in the capture. The
source blend is not saved.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from blend_lineage import same_geometry  # noqa: E402
from diagnose_water_radiance import select_records  # noqa: E402
from diagnose_water_reflection_targets import SCENES, WATER, classify, glb_materials, stratified  # noqa: E402
from water_reflection_trace import dot, normalize, sample_ggx_reflection, schlick, trace_branches  # noqa: E402

MODES = ('geometric', 'shading')


def barycentric(p, a, b, c):
    """Barycentric weights of p (on the triangle plane) for a, b, c."""
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
    d20, d21 = v2.dot(v0), v2.dot(v1)
    denom = d00 * d11 - d01 * d01
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    return 1 - v - w, v, w


def main():
    import bpy
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--glb', type=Path, default=Path('public/models/sauna.glb'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', default='64,1024', help='lobe samples per endpoint (squares)')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    counts = [int(s) for s in args.samples.split(',')]
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    if not same_geometry(source_hash, metadata['input_sha256']):
        raise RuntimeError('Endpoint fixture belongs to a different blend')
    with gzip.open(args.input / 'trace-rays.json.gz', 'rt') as stream:
        records = json.load(stream)['original']
    materials = glb_materials(args.glb)
    scene = bpy.data.scenes[SCENES['day']]
    bpy.context.window.scene = scene
    deps = bpy.context.evaluated_depsgraph_get()
    water_obj = scene.objects[WATER]
    evaluated = water_obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    matrix = evaluated.matrix_world
    rotation = matrix.to_3x3().inverted().transposed()
    positions = [matrix @ v.co for v in mesh.vertices]
    triangles, corner_normals = [], []
    for tri in mesh.loop_triangles:
        triangles.append(tuple(tri.vertices))
        corner_normals.append([(rotation @ Vector(n)).normalized() for n in tri.split_normals])
    water_tree = BVHTree.FromPolygons(positions, triangles)
    evaluated.to_mesh_clear()
    bounds = metadata['water_bounds']

    # Same scene BVH as diagnose_water_capture_radiance.py.
    vertices, polygons, owners = [], [], []
    for instance in deps.object_instances:
        obj = instance.object
        if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT', 'META'} or obj.original == water_obj or obj.hide_render:
            continue
        flags = (obj.visible_camera, obj.visible_glossy, obj.visible_transmission)
        if not any(flags):
            continue
        part = obj.to_mesh()
        if part is None:
            continue
        base = len(vertices)
        vertices.extend(instance.matrix_world @ v.co for v in part.vertices)
        for p in part.polygons:
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

    deviation = []

    def water_for(mode):
        def water(origin, direction):
            position, normal, index, distance = water_tree.ray_cast(Vector(origin), Vector(direction))
            if normal is None:
                return None
            if mode == 'geometric':
                return distance, tuple(normal)
            a, b, c = (positions[i] for i in triangles[index])
            weights = barycentric(position, a, b, c)
            shading = sum((w * n for w, n in zip(weights, corner_normals[index])), Vector()).normalized()
            deviation.append(shading.angle(normal))
            return distance, tuple(shading)
        return water

    selected = select_records(records, 3)
    reached = [r for r in records if r.get('hit') and r['events']]
    by_pixel = {tuple(r['pixel']): n for n, r in enumerate(reached)}
    report = {'input_sha256': source_hash, 'script_sha256': sha(Path(__file__)),
              'helper_sha256': {name: sha(Path(__file__).with_name(name)) for name in
                                ('water_reflection_trace.py', 'diagnose_water_reflection_targets.py',
                                 'diagnose_water_radiance.py')},
              'trace_sha256': sha(args.input / 'trace-rays.json.gz'), 'glb_sha256': sha(args.glb),
              'blender': bpy.app.version_string, 'coordinates': 'Blender Z-up, meters',
              'water_triangles': len(triangles), 'water_bounds': bounds, 'samples': counts,
              'modes': list(MODES), 'endpoints': []}
    started = time.monotonic()
    for index, record in enumerate(selected):
        number = by_pixel[tuple(record['pixel'])]
        hit = record['hit']
        point = hit['position']
        view = normalize(tuple(a - b for a, b in zip(record['events'][-1]['position'], point)))
        normal = normalize(hit['normal'])
        if dot(view, normal) < 0:
            normal = tuple(-n for n in normal)
        params = materials.get(hit['material'], {'roughness': 0.5, 'f0': 0.04})
        alpha = max(params['roughness'], 1e-3) ** 2
        entry = {'index': index, 'reached_index': number, 'group': record['group'], 'pixel': record['pixel'],
                 'material': hit['material'], 'position': list(point), 'runs': []}
        for count in counts:
            for mode in MODES:
                water = water_for(mode)
                rng = random.Random(number)  # the seeds of diagnose_water_capture_radiance.py
                lobe_total, shares, terminals = 0.0, {}, []
                for u1, u2 in stratified(count, rng):
                    sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
                    if sample is None:
                        continue
                    direction, weight, cos_vh = sample
                    weight *= schlick(params['f0'], cos_vh)
                    lobe_total += weight
                    for terminal in trace_branches(point, direction, water, surface, weight=weight):
                        category = classify(terminal, bounds, lambda _: True)
                        shares[category] = shares.get(category, 0.0) + terminal['weight']
                        if category in ('above_water', 'sky'):
                            terminals.append({'category': category, 'weight': terminal['weight'],
                                              'origin': list(terminal['origin']),
                                              'direction': list(terminal['direction']),
                                              'events': [e[0] for e in terminal['events']]})
                entry['runs'].append({'samples': count, 'mode': mode, 'lobe_total': lobe_total,
                                      'category_weight': shares, 'exit_terminals': terminals})
        report['endpoints'].append(entry)
        print('SHADING_NORMALS', index, round(time.monotonic() - started, 1), flush=True)
    deviation.sort()
    report['shading_deviation_deg'] = {q: math.degrees(deviation[int(f * (len(deviation) - 1))])
                                       for q, f in (('p50', 0.5), ('p90', 0.9), ('max', 1.0))}
    report['elapsed_seconds'] = time.monotonic() - started
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report['source_unchanged'] = True
    with gzip.open(args.out / 'shading.json.gz', 'wt') as stream:
        json.dump(report, stream)
    print('SHADING_NORMALS_DONE', report['elapsed_seconds'], report['shading_deviation_deg'], flush=True)


if __name__ == '__main__':
    main()
