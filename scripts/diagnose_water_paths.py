"""Compare original-water ray exits with a box and flat-surface approximation.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/diagnose_water_paths.py -- --out <dir>
No scene or delivery assets are saved. Classification measures paths, not radiance.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

IOR = 1.333
WATER = 'V4 rippled spring water volume'
LABELS = ['bottom', 'side_tir', 'side_transmit', 'other', 'miss']
COLORS = [(0.1, 0.45, 0.9), (0.9, 0.12, 0.1), (0.95, 0.75, 0.1), (0.5, 0.5, 0.5), (1, 0, 1)]


def refract(direction, normal, eta):
    """Unit incident direction and opposing unit normal; None means total reflection."""
    cosine = -sum(a * b for a, b in zip(direction, normal))
    k = 1 - eta * eta * (1 - cosine * cosine)
    if k < 0:
        return None
    return tuple(eta * d + (eta * cosine - math.sqrt(k)) * n for d, n in zip(direction, normal))


def box_exit(origin, direction, lower, upper):
    """First positive exit from an axis-aligned box, for an origin inside it."""
    if any(p < lo - 1e-7 or p > hi + 1e-7 for p, lo, hi in zip(origin, lower, upper)):
        return None
    candidates = []
    for axis in range(3):
        if abs(direction[axis]) < 1e-12:
            continue
        sign = 1 if direction[axis] > 0 else -1
        plane = upper[axis] if sign > 0 else lower[axis]
        distance = (plane - origin[axis]) / direction[axis]
        if distance > 1e-7:
            normal = tuple(sign if i == axis else 0 for i in range(3))
            candidates.append((distance, normal))
    return min(candidates, key=lambda item: item[0]) if candidates else None


def classify(direction, outward):
    if outward[2] < -0.5:
        return 'bottom'
    if abs(outward[2]) > 0.5:
        return 'other'
    return 'side_tir' if refract(direction, tuple(-v for v in outward), IOR) is None else 'side_transmit'


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--width', type=int, default=420)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.width < 32:
        parser.error('--width must be at least 32')
    args.out.mkdir(parents=True, exist_ok=True)
    source = Path(bpy.data.filepath)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    scene = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    obj = scene.objects[WATER]
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    vertices = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    tree = BVHTree.FromPolygons(vertices, [list(p.vertices) for p in mesh.polygons])
    lower = tuple(min(v[i] for v in vertices) for i in range(3))
    upper = tuple(max(v[i] for v in vertices) for i in range(3))
    smooth_faces = sum(p.use_smooth for p in mesh.polygons)
    evaluated.to_mesh_clear()
    definition = json.loads(Path('public/models/sauna.scene.json').read_text())
    level = definition['water']['center'][1]
    camera = scene.objects['03 • Water / cold plunge']
    width, height = args.width, round(args.width * 2 / 3)
    frame = camera.data.view_frame(scene=scene)
    xmin, xmax = min(v.x for v in frame), max(v.x for v in frame)
    ymin, ymax = min(v.y for v in frame), max(v.y for v in frame)
    z = frame[0].z
    origin = camera.matrix_world.translation
    rotation = camera.matrix_world.to_3x3()
    variants = ['original', 'box_same_ray', 'flat_box', 'wave_box']
    maps = {name: np.full((height, width), -1, dtype=np.int16) for name in variants}
    # Rows are top to bottom. All variants use the same original visible top-surface pixels.
    for row in range(height):
        for col in range(width):
            ray = (rotation @ Vector((xmin + (col + 0.5) / width * (xmax - xmin),
                                      ymax - (row + 0.5) / height * (ymax - ymin), z))).normalized()
            entry, normal, _, distance = tree.ray_cast(origin, ray)
            if entry is None or normal.z < 0.5:
                continue
            # Scene.ray_cast also sees render-hidden legacy water. Skip it explicitly.
            start = origin.copy()
            blocked = False
            for _ in range(128):
                remaining = distance - (start - origin).dot(ray) - 1e-4
                if remaining <= 0:
                    break
                hit, location, _, _, hit_obj, _ = scene.ray_cast(deps, start, ray, distance=remaining)
                if not hit:
                    break
                if hit_obj.original != obj and not hit_obj.hide_render and hit_obj.visible_camera:
                    blocked = True
                    break
                start = location + ray * 1e-4
            else:
                raise RuntimeError('Too many hidden intersections')
            if blocked:
                continue
            inside = Vector(refract(ray, normal, 1 / IOR))
            _, exit_normal, _, _ = tree.ray_cast(entry + inside * 1e-4, inside)
            actual = classify(inside, exit_normal) if exit_normal is not None else 'miss'
            boxed = box_exit(entry + inside * 1e-4, inside, lower, upper)
            box_label = classify(inside, boxed[1]) if boxed else 'miss'
            flat_direction = Vector(refract(ray, (0, 0, 1), 1 / IOR))
            flat_entry = origin + ray * ((level - origin.z) / ray.z)
            flat_hit = box_exit(flat_entry + flat_direction * 1e-4, flat_direction, lower, upper)
            # The mask is held fixed to isolate path classification, not edge coverage.
            flat_label = classify(flat_direction, flat_hit[1]) if flat_hit else 'miss'
            # Runtime's static wave normal, evaluated on its flat water plane (Blender axes).
            dx, dy = flat_entry.x - 1.18, flat_entry.y - 3.99
            radius = max(math.hypot(dx, dy), 1e-4)
            slope = 0.005585 * math.exp(-1.6814 * radius) * (33.988 * math.cos(33.988 * radius) - 1.6814 * math.sin(33.988 * radius))
            plane = 0.000684 * math.cos(15 * flat_entry.x + 10 * flat_entry.y)
            wave_normal = Vector((-slope * dx / radius - 15 * plane, -slope * dy / radius - 10 * plane, 1)).normalized()
            wave_direction = Vector(refract(ray, wave_normal, 1 / IOR))
            wave_hit = box_exit(flat_entry + wave_direction * 1e-4, wave_direction, lower, upper)
            wave_label = classify(wave_direction, wave_hit[1]) if wave_hit else 'miss'
            for name, label in zip(variants, [actual, box_label, flat_label, wave_label]):
                maps[name][row, col] = LABELS.index(label)
        if row % 40 == 0:
            print('WATER_PATH_ROW', row, flush=True)
    mask = maps['original'] >= 0
    count = int(mask.sum())
    if not count:
        raise RuntimeError('No visible water samples')
    results = {}
    for name, values in maps.items():
        confusion = [[int(np.sum(mask & (maps['original'] == i) & (values == j))) for j in range(len(LABELS))]
                     for i in range(len(LABELS))]
        target = maps['original'] == LABELS.index('side_tir')
        candidate = values == LABELS.index('side_tir')
        union = int(np.sum(target | candidate))
        results[name] = {
            'counts': {label: int(np.sum(values == i)) for i, label in enumerate(LABELS)},
            'agreement': float(np.mean(values[mask] == maps['original'][mask])),
            'tir_iou': float(np.sum(target & candidate) / union) if union else 1.0,
            'confusion_actual_rows_candidate_columns': confusion,
        }
        rgba = np.ones((height, width, 4), dtype=np.float32)
        rgba[:, :, :3] = 0.035
        for i, color in enumerate(COLORS):
            rgba[values == i, :3] = color
        image = bpy.data.images.new(name, width=width, height=height, alpha=True)
        image.pixels.foreach_set(rgba[::-1].flatten())
        image.filepath_raw = str((args.out / (name + '.png')).resolve())
        image.file_format = 'PNG'
        image.save()
        bpy.data.images.remove(image)
    report = {
        'input_sha256': source_hash, 'blender': bpy.app.version_string,
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'scene_definition_sha256': hashlib.sha256(Path('public/models/sauna.scene.json').read_bytes()).hexdigest(),
        'wave_shader_sha256': hashlib.sha256(Path('src/components/3d/waterEffects.ts').read_bytes()).hexdigest(),
        'camera': camera.name, 'resolution': [width, height], 'visible_water_samples': count,
        'coordinates': 'Blender Z-up, meters', 'water_bounds': [lower, upper], 'flat_level': level, 'smooth_water_faces': smooth_faces,
        'labels': LABELS, 'results': results,
        'limitations': ['Viewport evaluated geometry; render-hidden and camera-invisible blockers skipped; transparent blockers treated opaque.',
                        'Geometric face normals, not interpolated shading normals or material bump; this is not a Cycles ray oracle.',
                        'First water exit only; no radiance, wall hits, or subsequent bounces.',
                        'Original visible top-surface mask is shared; silhouette error is excluded.',
                        'Box bounds come from evaluated source geometry, not the wider WATER_BOX lighting region.',
                        'One fixed camera and original static waves; no temporal or browser validation.'],
    }
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash:
        raise RuntimeError('Source blend changed during diagnosis')
    (args.out / 'paths.json').write_text(json.dumps(report, indent=2) + '\n')
    print('WATER_PATHS', json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
