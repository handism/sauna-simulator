"""Classify where the glossy lobe of underwater endpoints goes in the source scene.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/diagnose_water_reflection_targets.py -- --out DIR

For every endpoint of the saved original-water paths (camera 03), GGX lobe
directions are sampled with the exported material roughness and followed
through the original water mesh with both Fresnel branches
(water_reflection_trace.py). Terminals are grouped by which existing reference
could supply their colour: the underwater diffuse capture (overhead / face
coordinates), the constant sky colour, or nothing yet (surfaces above water).
No radiance is rendered and the source blend is not saved.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from water_reflection_trace import dot, normalize, sample_ggx_reflection, schlick, trace_branches  # noqa: E402

WATER = 'V4 rippled spring water volume'
# Cycles Volume Absorption: sigma = density * (1 - color), per metre in scene units.
ABSORPTION = (0.12 * (1 - 0.57), 0.12 * (1 - 0.84), 0.12 * (1 - 0.78))
CATEGORIES = ['pool_overhead', 'pool_face', 'sky', 'above_water', 'light', 'unresolved']
COLORS = {'pool_overhead': (0.1, 0.8, 0.55), 'pool_face': (0.95, 0.75, 0.1), 'sky': (0.25, 0.45, 1.0),
          'above_water': (0.95, 0.15, 0.12), 'light': (1, 1, 1), 'unresolved': (0.9, 0.1, 0.9)}
SCENES = {'day': 'SUI • Daylight', 'evening': 'SUI • Blue hour'}


def glb_materials(path):
    data = path.read_bytes()
    gltf = json.loads(data[20:20 + int.from_bytes(data[12:16], 'little')])
    result = {}
    for material in gltf['materials']:
        pbr = material.get('pbrMetallicRoughness', {})
        specular = material.get('extensions', {}).get('KHR_materials_specular', {})
        metal = pbr.get('metallicFactor', 1.0)
        base = pbr.get('baseColorFactor', [1, 1, 1, 1])[:3]
        dielectric = 0.04 * specular.get('specularFactor', 1.0)
        # Scalar F0 for weighting lobe samples only (mean of RGB).
        f0 = sum((1 - metal) * dielectric + metal * c for c in base) / 3
        result[material['name']] = {'roughness': pbr.get('roughnessFactor', 1.0), 'f0': f0}
    return result


def stratified(count, rng):
    side = int(math.isqrt(count))
    if side * side != count:
        raise ValueError('sample count must be a square')
    return [((i + rng.random()) / side, (j + rng.random()) / side) for i in range(side) for j in range(side)]


def classify(terminal, bounds, overhead):
    kind = terminal['kind']
    if kind == 'escape':
        return 'sky'
    if kind != 'surface':
        return 'unresolved'
    if terminal['hit'].get('light'):
        return 'light'
    x, y, z = terminal['hit']['position']
    (x0, y0, _), (x1, y1, z1) = bounds
    if x0 - 0.2 <= x <= x1 + 0.2 and y0 - 0.2 <= y <= y1 + 0.2 and z <= z1:
        return 'pool_overhead' if overhead(terminal['hit']) else 'pool_face'
    return 'above_water'


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--radiance', type=Path, default=Path('docs/3d-qa/water-radiance/radiance.json'))
    parser.add_argument('--glb', type=Path, default=Path('public/models/sauna.glb'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=64, help='lobe samples per endpoint (square)')
    parser.add_argument('--selected-samples', type=int, default=1024, help='for the radiance fixture points')
    parser.add_argument('--limit', type=int, help='first N population endpoints only (smoke test)')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    radiance = json.loads(args.radiance.read_text())
    if source_hash != metadata['input_sha256'] or source_hash != radiance['input_sha256']:
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
        slots = [s.material.name if s.material else None for s in obj.material_slots]
        base = len(vertices)
        vertices.extend(instance.matrix_world @ v.co for v in mesh.vertices)
        for p in mesh.polygons:
            polygons.append(tuple(base + i for i in p.vertices))
            owners.append((obj.original.name, slots[p.material_index] if p.material_index < len(slots) else None, flags))
        obj.to_mesh_clear()
    scene_tree = BVHTree.FromPolygons(vertices, polygons)
    print('REFLECTION_BVH', len(vertices), len(polygons), flush=True)
    del vertices, polygons
    visibility_index = {'camera': 0, 'glossy': 1, 'transmission': 2}

    def light_hit(light, origin, direction, visibility):
        """Front face of an area light, or a point/spot sphere inside its cone; None otherwise."""
        if not getattr(light['object'], 'visible_' + visibility):
            return None
        if light['type'] == 'AREA':
            o = light['inverse'] @ Vector(origin)
            d = light['inverse_basis'] @ Vector(direction)
            if d.z <= 1e-12:  # emits toward local -Z; the back side is not visible
                return None
            t = -o.z / d.z
            if t <= 1e-6:
                return None
            x, y = o.x + d.x * t, o.y + d.y * t
            sx, sy = light['half_size']
            inside = (abs(x) <= sx and abs(y) <= sy) if light['shape'] in {'SQUARE', 'RECTANGLE'} else \
                (x / sx) ** 2 + (y / sy) ** 2 <= 1
            return t if inside else None
        center, radius = light['center'], light['radius']
        if radius <= 0:
            return None
        oc = Vector(origin) - center
        b = oc.dot(Vector(direction))
        disc = b * b - (oc.dot(oc) - radius * radius)
        if disc < 0:
            return None
        t = -b - math.sqrt(disc)
        if t <= 1e-6:
            return None
        if light['type'] == 'SPOT':
            toward = (Vector(origin) + Vector(direction) * t - center).normalized()
            if toward.dot(light['axis']) < math.cos(light['spot_size'] / 2):
                return None
        return t

    def scene_lights(scene_name):
        lights = []
        for obj in bpy.data.scenes[scene_name].objects:
            if obj.type != 'LIGHT' or obj.hide_render or obj.data.type == 'SUN':
                continue
            matrix = obj.matrix_world
            data = obj.data
            entry = {'object': obj, 'name': obj.name, 'type': data.type}
            if data.type == 'AREA':
                entry.update(inverse=matrix.inverted(), inverse_basis=matrix.inverted().to_3x3(), shape=data.shape,
                             half_size=(data.size / 2, (data.size_y if data.shape in {'RECTANGLE', 'ELLIPSE'} else data.size) / 2))
            elif data.type in {'POINT', 'SPOT'}:
                scale = max(matrix.to_scale())
                entry.update(center=matrix.translation.copy(), radius=data.shadow_soft_size * scale,
                             axis=(matrix.to_3x3() @ Vector((0, 0, -1))).normalized(),
                             spot_size=getattr(data, 'spot_size', math.pi))
            else:
                continue
            lights.append(entry)
        return lights

    def make_surface(lights):
        def with_lights(origin, direction, visibility):
            hit = surface(origin, direction, visibility)
            for light in lights:
                t = light_hit(light, origin, direction, visibility)
                if t is not None and (hit is None or t < hit['distance']):
                    hit = {'distance': t, 'position': tuple(Vector(origin) + Vector(direction) * t),
                           'normal': None, 'object': light['name'], 'material': None, 'light': True}
            return hit
        return with_lights

    def surface(origin, direction, visibility):
        start, ray = Vector(origin), Vector(direction)
        for _ in range(64):
            position, normal, face, _ = scene_tree.ray_cast(start, ray)
            if position is None:
                return None
            name, material, flags = owners[face]
            if flags[visibility_index[visibility]]:
                return {'distance': float((position - Vector(origin)).length), 'position': tuple(position),
                        'normal': tuple(normal), 'object': name, 'material': material}
            start = position + ray * 1e-4
        raise RuntimeError('Too many invisible intersections')

    def water(origin, direction):
        _, normal, _, distance = water_tree.ray_cast(Vector(origin), Vector(direction))
        return (distance, tuple(normal)) if normal is not None else None

    top = bounds[1][2] + 0.1
    # Escaping lobe weight within each sun disk (Cycles may not sample it through water).
    suns = {}
    for scene_name in ('SUI • Daylight', 'SUI • Blue hour'):
        for light in bpy.data.scenes[scene_name].objects:
            if light.type == 'LIGHT' and light.data.type == 'SUN' and not light.hide_render:
                toward = (light.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
                suns[scene_name] = {'object': light.name, 'direction': tuple(toward),
                                    'half_angle': light.data.angle / 2, 'strength': light.data.energy}
    lights_by_scene = {label: scene_lights(name) for label, name in SCENES.items()}
    overhead_cache = {}

    def overhead(hit):
        """Same rule as diagnose_water_capture.py: continuous overhead ray, same object within 2 mm."""
        key = (round(hit['position'][0], 4), round(hit['position'][1], 4), round(hit['position'][2], 4), hit['object'])
        if key not in overhead_cache:
            found = surface((hit['position'][0], hit['position'][1], top), (0, 0, -1), 'camera')
            overhead_cache[key] = bool(found and found['object'] == hit['object'] and
                                       math.dist(found['position'], hit['position']) <= 0.002)
        return overhead_cache[key]

    def lobe(record, count, seed, scene_label):
        traced_surface = make_surface(lights_by_scene[scene_label])
        sun = suns.get(SCENES[scene_label])
        hit = record['hit']
        point = hit['position']
        view = normalize(tuple(a - b for a, b in zip(record['events'][-1]['position'], point)))
        normal = normalize(hit['normal'])
        if dot(view, normal) < 0:
            normal = tuple(-n for n in normal)  # two-sided shading like Cycles
        params = materials.get(hit['material'], {'roughness': 0.5, 'f0': 0.04})
        alpha = max(params['roughness'], 1e-3) ** 2
        rng = random.Random(seed)
        sums = defaultdict(float)
        absorbed = defaultdict(float)
        objects = Counter()
        paths = Counter()
        sun_weight = 0.0
        total = 0.0
        for u1, u2 in stratified(count, rng):
            sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
            if sample is None:
                continue
            direction, weight, cos_vh = sample
            weight *= schlick(params['f0'], cos_vh)
            total += weight
            for terminal in trace_branches(point, direction, water, traced_surface, weight=weight):
                category = classify(terminal, bounds, overhead)
                sums[category] += terminal['weight']
                transmittance = sum(math.exp(-s * terminal['water_length']) for s in ABSORPTION) / 3
                absorbed[category] += terminal['weight'] * transmittance
                steps = tuple(e[0] + '_' + e[1] for e in terminal['events'])
                paths[(category, ' > '.join(steps) or 'direct')] += terminal['weight']
                if terminal['kind'] == 'escape' and sun and \
                        dot(terminal['direction'], sun['direction']) >= math.cos(sun['half_angle']):
                    sun_weight += terminal['weight']
                if terminal['kind'] == 'surface':
                    objects[(category, terminal['hit']['object'])] += terminal['weight']
        if total <= 0:
            return None
        return {'material': hit['material'], 'roughness': params['roughness'], 'f0': params['f0'],
                'samples': count, 'lobe_weight_mean': total / count,
                'fractions': {c: sums[c] / total for c in CATEGORIES},
                'absorbed_fractions': {c: absorbed[c] / total for c in CATEGORIES},
                'sun_disk_fraction': sun_weight / total,
                'paths': [[c, p, w / total] for (c, p), w in paths.most_common(8)],
                'objects': [[c, o, w / total] for (c, o), w in objects.most_common(8)]}

    reached = [r for r in records if r.get('hit') and r['events']][:args.limit]
    report = {'input_sha256': source_hash, 'trace_sha256': sha(args.input / 'trace-rays.json.gz'),
              'radiance_sha256': sha(args.radiance), 'glb_sha256': sha(args.glb),
              'script_sha256': sha(Path(__file__)),
              'helper_sha256': sha(Path(__file__).with_name('water_reflection_trace.py')),
              'blender': bpy.app.version_string, 'coordinates': 'Blender Z-up, meters',
              'water_bounds': bounds, 'overhead_origin_z': top, 'absorption_per_m': ABSORPTION,
              'categories': CATEGORIES, 'samples': args.samples, 'selected_samples': args.selected_samples,
              'endpoints': len(reached), 'suns': suns, 'selected': {}, 'population': {},
              'lights': {label: [l['name'] for l in lights_by_scene[label]] for label in SCENES},
              'cycles_settings': {name: {
                  'caustics_reflective': bpy.data.scenes[name].cycles.caustics_reflective,
                  'caustics_refractive': bpy.data.scenes[name].cycles.caustics_refractive,
                  'blur_glossy': bpy.data.scenes[name].cycles.blur_glossy,
                  'world': bpy.data.scenes[name].world.name,
                  'world_nodes': sorted(n.type for n in bpy.data.scenes[name].world.node_tree.nodes),
                  'world_visibility': {k: getattr(bpy.data.scenes[name].world.cycles_visibility, k)
                                       for k in ('camera', 'diffuse', 'glossy', 'transmission')},
                  'glossy_visible_lights': sorted(o.name for o in bpy.data.scenes[name].objects
                                                  if o.type == 'LIGHT' and not o.hide_render and o.visible_glossy),
              } for name in ('SUI • Daylight', 'SUI • Blue hour')}}
    width, height = metadata['resolution']
    rows = {}
    for label in SCENES:
        report['selected'][label] = []
        for index, record in enumerate(radiance['selected']):
            result = lobe(record, args.selected_samples, 1000 + index, label)
            report['selected'][label].append({'index': index, 'group': record['group'], 'pixel': record['pixel'],
                                              'position': record['hit']['position'], **(result or {'skipped': True})})
            print('REFLECTION_SELECTED', label, index, json.dumps(result and result['fractions']), flush=True)
        rgba = np.ones((height, width, 4), dtype=np.float32)
        rgba[:, :, :3] = 0.035
        groups = defaultdict(lambda: {'count': 0, 'fractions': defaultdict(float),
                                      'absorbed': defaultdict(float), 'sun': 0.0})
        rows[label] = []
        for number, record in enumerate(reached):
            result = lobe(record, args.samples, number, label)
            if result is None:
                continue
            hit_material = record['hit']['material'] or ''
            family = ('tile' if 'pool tile' in hit_material else 'wall' if 'quiet honed stone' in hit_material else
                      'base' if hit_material == 'Blackened bronze' else 'other')
            for key in ('all', record['first_exit'], family, f"{record['first_exit']}/{family}"):
                group = groups[key]
                group['count'] += 1
                group['sun'] += result['sun_disk_fraction']
                for c in CATEGORIES:
                    group['fractions'][c] += result['fractions'][c]
                    group['absorbed'][c] += result['absorbed_fractions'][c]
            rows[label].append([record['pixel'], family] + [round(result['fractions'][c], 5) for c in CATEGORIES])
            col, row = record['pixel']
            rgba[row, col, :3] = [sum(result['fractions'][c] * COLORS[c][i] for c in CATEGORIES) for i in range(3)]
            if number % 1000 == 0:
                print('REFLECTION_POPULATION', label, number, len(reached), flush=True)
        report['population'][label] = {
            key: {'count': g['count'],
                  'mean_fractions': {c: g['fractions'][c] / g['count'] for c in CATEGORIES},
                  'mean_absorbed_fractions': {c: g['absorbed'][c] / g['count'] for c in CATEGORIES},
                  'mean_sun_disk_fraction': g['sun'] / g['count']}
            for key, g in sorted(groups.items())}
        image = bpy.data.images.new('reflection-targets-' + label, width=width, height=height, alpha=True)
        image.pixels.foreach_set(rgba[::-1].flatten())
        image.filepath_raw = str((args.out / f'targets-{label}.png').resolve())
        image.file_format = 'PNG'
        image.save()
        bpy.data.images.remove(image)
    report['rows_columns'] = ['pixel', 'family'] + CATEGORIES
    report['limitations'] = [
        'Geometry only: lobe weight x water-boundary Fresnel, no radiance of the targets.',
        'Single-scattering GGX with exported roughness and a scalar Schlick F0; Cycles uses multiscatter GGX and F82 metals.',
        'Geometric normals of viewport-evaluated meshes; no bump or shading normals; water treated as smooth (source roughness 0.018).',
        'Other transparent materials are opaque; the water mesh is the only refractive boundary.',
        'Lights: front face of area lights and point/spot spheres (cone only) with their ray visibility; '
        'the sun is not a surface and only its disk fraction of escaping weight is reported.',
        'pool_* = hit inside the water XY bounds +-0.2 m and below the water top; overhead uses the capture rule '
        '(continuous ray, same object within 2 mm); pool_face is everything else there and still needs a face-coordinate capture.',
        'Camera 03 static waves only; same endpoint set as water-side-continuation.',
    ]
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report['source_unchanged'] = True
    with gzip.open(args.out / 'target-rows.json.gz', 'wt', encoding='utf-8') as stream:
        json.dump(rows, stream, separators=(',', ':'))
    (args.out / 'targets.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
