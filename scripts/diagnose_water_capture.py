"""Evaluate un-refracted color/depth capture coverage; no radiance is rendered.

Run in Blender with the source blend and -- --out DIR. Saved path endpoints are
projected into a same-camera pass and a clipped overhead orthographic pass.
"""
import argparse
from collections import Counter
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys


def texel_center(uv, resolution):
    if not all(0 <= v < 1 for v in uv):
        return None
    return tuple((math.floor(v * n) + 0.5) / n for v, n in zip(uv, resolution))


def matches(target, hit, tolerance):
    return bool(hit and target['object'] == hit['object'] and
                math.dist(target['position'], hit['position']) <= tolerance)


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    source = Path(bpy.data.filepath)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    if source_hash != metadata['input_sha256']:
        raise RuntimeError('Endpoint fixture belongs to a different blend')
    with gzip.open(args.input / 'trace-rays.json.gz', 'rt') as stream:
        traces = json.load(stream)
    scene = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    camera = scene.objects[metadata['camera']]
    inverse = camera.matrix_world.inverted()
    frame = camera.data.view_frame(scene=scene)
    xmin, xmax = min(v.x for v in frame), max(v.x for v in frame)
    ymin, ymax = min(v.y for v in frame), max(v.y for v in frame)
    z = frame[0].z
    lower, upper = metadata['water_bounds']
    # Capture extends 20 cm beyond the source volume. Starting 10 cm above its
    # top clips overlying architecture, but retains coping and underwater walls.
    lo = [lower[i] - 0.2 for i in range(2)]
    hi = [upper[i] + 0.2 for i in range(2)]
    top = upper[2] + 0.1

    def project(point, mode):
        if mode == 'camera':
            local = inverse @ point
            if local.z >= -1e-6:
                return None
            scale = z / local.z
            return ((local.x * scale - xmin) / (xmax - xmin),
                    (local.y * scale - ymin) / (ymax - ymin))
        if point.z >= top:
            return None
        return tuple((point[i] - lo[i]) / (hi[i] - lo[i]) for i in range(2))

    def ray(uv, mode):
        if mode == 'camera':
            origin = camera.matrix_world.translation.copy()
            direction = (camera.matrix_world.to_3x3() @ Vector(
                (xmin + uv[0] * (xmax - xmin), ymin + uv[1] * (ymax - ymin), z))).normalized()
            return origin, direction
        return Vector((lo[0] + uv[0] * (hi[0] - lo[0]), lo[1] + uv[1] * (hi[1] - lo[1]), top)), Vector((0, 0, -1))

    # Build the camera-visible geometry once instead of walking render-hidden
    # intersections through scene.ray_cast for every lookup.
    vertices, polygons, owners = [], [], []
    for instance in deps.object_instances:
        obj = instance.object
        if obj.type not in {'MESH', 'CURVE', 'SURFACE', 'FONT', 'META'}:
            continue
        if obj.name == 'V4 rippled spring water volume' or obj.hide_render or not obj.visible_camera:
            continue
        mesh = obj.to_mesh()
        if mesh is None:
            continue
        base = len(vertices)
        vertices.extend(instance.matrix_world @ v.co for v in mesh.vertices)
        polygons.extend(tuple(base + i for i in p.vertices) for p in mesh.polygons)
        owners.extend([obj.name] * len(mesh.polygons))
        obj.to_mesh_clear()
    print('CAPTURE_BVH', len(vertices), len(polygons), flush=True)
    tree = BVHTree.FromPolygons(vertices, polygons)
    del vertices, polygons

    def cast(origin, direction):
        position, normal, face, _ = tree.ray_cast(origin, direction)
        if position is None:
            return None
        return {'position': tuple(position), 'object': owners[face], 'normal': tuple(normal)}

    width, height = metadata['resolution']
    report = {'input_sha256': source_hash, 'trace_sha256': sha(args.input / 'trace-rays.json.gz'),
              'script_sha256': sha(Path(__file__)), 'blender': bpy.app.version_string,
              'camera': metadata['camera'], 'source_resolution': [width, height],
              'overhead_bounds_xy': [lo, hi], 'overhead_origin_z': top,
              'coordinates': 'Blender Z-up, meters', 'results': {}}
    colors = {'match_2mm': (0.1, 0.8, 0.55), 'match_10mm': (0.9, 0.7, 0.1),
              'mismatch': (0.95, 0.15, 0.12), 'outside': (0.3, 0.4, 1), 'unresolved': (0.9, 0.1, 0.9)}
    for variant, records in traces.items():
        report['results'][variant] = {}
        statuses = {}
        for mode in ['camera', 'overhead']:
            for size in [0, 512, 1024]:
                resolution = (size, round(size * height / width)) if mode == 'camera' else (size, size)
                counts = {key: Counter() for key in ['all', 'side_tir', 'side_transmit', 'bottom']}
                sample_status = []
                blockers = Counter()
                angles = []
                rgba = np.ones((height, width, 4), dtype=np.float32)
                rgba[:, :, :3] = 0.035
                for record in records:
                    target = record.get('hit')
                    status = 'unresolved'
                    if target:
                        point = Vector(target['position'])
                        uv = project(point, mode)
                        uv = None if uv is None else texel_center(uv, resolution) if size else uv
                        if uv is None or not all(0 <= v < 1 for v in uv):
                            status = 'outside'
                        else:
                            origin, direction = ray(uv, mode)
                            hit = cast(origin, direction)
                            status = ('match_2mm' if matches(target, hit, 0.002) else
                                      'match_10mm' if matches(target, hit, 0.01) else 'mismatch')
                            if status == 'mismatch':
                                blockers[hit['object'] if hit else '<miss>'] += 1
                            if status == 'match_2mm' and record['events']:
                                last = Vector(record['events'][-1]['position'])
                                incoming = (point - last).normalized()
                                angles.append(math.degrees(math.acos(max(-1, min(1, incoming.dot(direction))))))
                    sample_status.append(status)
                    counts['all'][status] += 1
                    if record['first_exit'] in counts:
                        counts[record['first_exit']][status] += 1
                    col, row = record['pixel']
                    rgba[row, col, :3] = colors[status]
                key = f'{mode}-{size or "continuous"}'
                statuses[key] = sample_status
                report['results'][variant][key] = {
                    'resolution': list(resolution) if size else None,
                    'counts': {k: dict(v) for k, v in counts.items()},
                    'mismatch_first_objects': dict(blockers.most_common(12)),
                    'matched_2mm_direction_difference_degrees':
                        dict(zip(['median', 'p90', 'max'], map(float, np.percentile(angles, [50, 90, 100])))) if angles else None,
                }
                if size in [0, 512]:
                    image = bpy.data.images.new(key, width=width, height=height, alpha=True)
                    image.pixels.foreach_set(rgba[::-1].flatten())
                    image.filepath_raw = str((args.out / f'{variant}-{key}.png').resolve())
                    image.file_format = 'PNG'
                    image.save()
                    bpy.data.images.remove(image)
                print('CAPTURE_COVERAGE', variant, key, dict(counts['all']), flush=True)
        unions = {}
        for size in ['continuous', '512', '1024']:
            groups = {}
            for group in ['all', 'side_tir', 'side_transmit', 'bottom']:
                indices = [i for i, r in enumerate(records) if group == 'all' or r['first_exit'] == group]
                groups[group] = {'count': len(indices)}
                for tolerance, accepted in [('2mm', {'match_2mm'}), ('10mm', {'match_2mm', 'match_10mm'})]:
                    groups[group][tolerance] = sum(any(statuses[f'{mode}-{size}'][i] in accepted
                                                     for mode in ['camera', 'overhead']) for i in indices)
            unions[size] = groups
        report['results'][variant]['two_capture_union'] = unions
    report['limitations'] = [
        'Geometry-only lookup feasibility, no HDR color, shading, Fresnel or browser/GPU cost measurement.',
        'Same camera and static common water mask as the input fixture; no other views or animated waves.',
        'Viewport source geometry, camera visibility, opaque treatment of other transparent materials; not exported GLB.',
        'Continuous rays are an optimistic visibility bound; finite results use nearest texel, not bilinear filtering or MSAA.',
        'Matches require the same object and Euclidean position within 2mm/10mm; these are diagnostic tolerances, not quality gates.',
        'Overhead clips geometry above its origin plane; square map covers only the stated XY bounds.',
        'Direction difference concerns the final path segment, not a measured radiance error.',
    ]
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    (args.out / 'coverage.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
