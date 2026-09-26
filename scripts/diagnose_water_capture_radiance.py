"""Render the proposed above-water capture and the true radiance of the lobe terminals it replaces.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/diagnose_water_capture_radiance.py -- --out DIR

The candidate of water-above-capture (one probe 10 cm over the pool centre with
the tub box inside the courtyard box) is rendered by Cycles as equirectangular
panoramas for daylight and blue hour. For a subset of the underwater endpoints
the glossy lobes of diagnose_water_above_capture.py are sampled again (same
seeds); every terminal that left the water (above_water / sky) gets its true
radiance from a 10 micrometre orthographic camera 1 mm before the hit, looking
along the last segment. Colours are compared by summarize_water_capture_radiance.py.

Camera rays are given each object's transmission visibility (the last segment
after leaving the water is a transmission ray) and the water is hidden from
them only, so that it still lights the tub. Lights whose highlights the browser
draws (V9; the five accents at blue hour) are hidden from camera rays in both
the capture and the truth, as in the reflection bake. The source blend is not saved.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import random
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from diagnose_water_radiance import select_records  # noqa: E402
from diagnose_water_reflection_targets import SCENES, WATER, classify, glb_materials, stratified  # noqa: E402
from water_capture_parallax import nested_box_lookup  # noqa: E402
from water_reflection_trace import dot, normalize, sample_ggx_reflection, schlick, trace_branches  # noqa: E402

# Lights whose highlights the browser draws itself stay out of camera rays, as in the reflection
# bake of bake_irradiance_probes.py (DRAWN_SPECULAR, and DRAWN_EVENING at blue hour).
DRAWN_SPECULAR = {'V9 lounge patch of sunlight'}
DRAWN_EVENING = {'V10 lounge dusk fill', 'V10 path grazing light 1', 'V10 path grazing light 4',
                 'V10 path grazing light 7', 'V10 specimen uplight'}
PROBE_HEIGHT = 0.1
FOOTPRINT = 0.00001
TRUTH_DISTANCE = 0.001
TRUTH_SIZE = 5


def base_name(name):
    name = name.split(' / ')[0]
    return name[:-4] if len(name) > 4 and name[-4] == '.' and name[-3:].isdigit() else name


def drawn(obj, label):
    name = base_name(obj.name)
    return obj.type == 'LIGHT' and (name in DRAWN_SPECULAR or (label == 'evening' and name in DRAWN_EVENING))


def main():
    import bpy
    import numpy as np
    import OpenImageIO as oiio
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--capture', type=Path, default=Path('docs/3d-qa/water-above-capture/capture.json'))
    parser.add_argument('--glb', type=Path, default=Path('public/models/sauna.glb'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=64, help='lobe samples per endpoint (square)')
    parser.add_argument('--width', type=int, default=2048, help='panorama width (height is half)')
    parser.add_argument('--capture-samples', type=int, default=1024)
    parser.add_argument('--capture-seeds', default='17,83')
    parser.add_argument('--truth-samples', type=int, default=1024, help='per pixel; 25 pixels are averaged')
    parser.add_argument('--endpoints', type=int, default=48, help='spatially stratified endpoints besides the 19')
    parser.add_argument('--limit', type=int, help='first N selected endpoints only (smoke test)')
    parser.add_argument('--scenes', default='day,evening')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    seeds = [int(s) for s in args.capture_seeds.split(',')]
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    capture = json.loads(args.capture.read_text())
    if source_hash != metadata['input_sha256'] or source_hash != capture['input_sha256']:
        raise RuntimeError('Fixtures belong to a different blend')
    with gzip.open(args.input / 'trace-rays.json.gz', 'rt') as stream:
        records = json.load(stream)['original']
    materials = glb_materials(args.glb)
    scene = bpy.data.scenes[SCENES['day']]
    bpy.context.window.scene = scene
    deps = bpy.context.evaluated_depsgraph_get()
    water_obj = scene.objects[WATER]
    evaluated = water_obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    water_tree = BVHTree.FromPolygons([evaluated.matrix_world @ v.co for v in mesh.vertices],
                                      [list(p.vertices) for p in mesh.polygons])
    evaluated.to_mesh_clear()
    bounds = metadata['water_bounds']
    if bounds != capture['water_bounds']:
        raise RuntimeError('Water bounds differ from the capture diagnosis')

    # Same scene BVH as diagnose_water_above_capture.py.
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

    # The candidate probe and its proxy boxes as measured by the parallax diagnosis.
    (x0, y0, z0), (x1, y1, z1) = bounds
    probe = ((x0 + x1) / 2, (y0 + y1) / 2, z1 + PROBE_HEIGHT)
    entry = next(p for p in capture['probes'] if 'nested' in p and
                 max(abs(a - b) for a, b in zip(p['position'], probe)) < 1e-6)
    tub, court = [[tuple(v) for v in box] for box in entry['nested']['boxes']]
    coping = min(t[1] for t in entry['nested']['wall_tops'].values() if t and 'coping' in t[0])
    proxies = {'nested_measured': [tub, court],
               'nested_coping': [(tub[0], (tub[1][0], tub[1][1], coping)), court]}

    reached = [r for r in records if r.get('hit') and r['events']]
    by_pixel = {tuple(r['pixel']): n for n, r in enumerate(reached)}
    radiance_points = {by_pixel[tuple(r['pixel'])]: i for i, r in enumerate(select_records(records, 3))}
    stratified_points = {min(len(reached) - 1, int((i + 0.5) * len(reached) / args.endpoints))
                         for i in range(args.endpoints)}
    chosen = sorted(set(radiance_points) | stratified_points)[:args.limit]

    endpoints, terminals = [], []
    for number in chosen:
        record = reached[number]
        hit = record['hit']
        point = hit['position']
        view = normalize(tuple(a - b for a, b in zip(record['events'][-1]['position'], point)))
        normal = normalize(hit['normal'])
        if dot(view, normal) < 0:
            normal = tuple(-n for n in normal)
        params = materials.get(hit['material'], {'roughness': 0.5, 'f0': 0.04})
        alpha = max(params['roughness'], 1e-3) ** 2
        rng = random.Random(number)  # the seeds of the population pass of the targets diagnosis
        lobe_total, shares = 0.0, {}
        for u1, u2 in stratified(args.samples, rng):
            sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
            if sample is None:
                continue
            direction, weight, cos_vh = sample
            weight *= schlick(params['f0'], cos_vh)
            lobe_total += weight
            for terminal in trace_branches(point, direction, water, surface, weight=weight):
                category = classify(terminal, bounds, lambda _: True)
                shares[category] = shares.get(category, 0.0) + terminal['weight']
                if category not in ('above_water', 'sky'):
                    continue
                origin, d = terminal['origin'], terminal['direction']
                lookups = {'direction': list(d)}
                for name, boxes in proxies.items():
                    found = nested_box_lookup(origin, d, probe, boxes)
                    lookups[name] = list(found) if found is not None else None
                truth = terminal.get('hit')
                terminals.append({'endpoint': len(endpoints), 'category': category, 'weight': terminal['weight'],
                                  'origin': list(origin), 'direction': list(d), 'lookups': lookups,
                                  'hit': truth and {'object': truth['object'], 'position': list(truth['position']),
                                                    'normal': list(truth['normal'])},
                                  'truth': {}})
        endpoints.append({'reached_index': number, 'pixel': record['pixel'], 'first_exit': record['first_exit'],
                          'material': hit['material'], 'position': list(point),
                          'radiance_index': radiance_points.get(number), 'samples': args.samples,
                          'lobe_total': lobe_total, 'category_weight': shares})
    print('CAPTURE_RADIANCE_TERMINALS', len(endpoints), len(terminals), flush=True)

    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    gpu = any(d.use for d in prefs.devices)
    pano_data = bpy.data.cameras.new('Water capture probe')
    pano_data.type = 'PANO'
    pano_data.panorama_type = 'EQUIRECTANGULAR'
    pano_data.clip_start = 0.001
    pano_data.clip_end = 10000
    pano = bpy.data.objects.new(pano_data.name, pano_data)
    pano.location = probe
    pano.rotation_euler = (1.5707963267948966, 0, 0)  # as bake_irradiance_probes.py; see water_capture_radiance.py
    ortho_data = bpy.data.cameras.new('Water capture truth')
    ortho_data.type = 'ORTHO'
    ortho_data.ortho_scale = FOOTPRINT
    ortho_data.clip_start = 0.000001
    ortho_data.clip_end = 10000
    ortho = bpy.data.objects.new(ortho_data.name, ortho_data)

    def read(path, *passes):
        image = oiio.ImageInput.open(str(path))
        spec = image.spec()
        pixels = np.asarray(image.read_image(format='float')).reshape(spec.height, spec.width, spec.nchannels)
        image.close()
        names = list(spec.channelnames)
        layer = names[0].split('.')[0]
        axes = {'Combined': 'RGB', 'Position': 'XYZ'}
        return [pixels[:, :, [names.index(f'{layer}.{p}.{a}') for a in axes[p]]] for p in passes]

    report = {'input_sha256': source_hash, 'script_sha256': sha(Path(__file__)),
              'helper_sha256': {name: sha(Path(__file__).with_name(name)) for name in
                                ('water_capture_parallax.py', 'water_reflection_trace.py',
                                 'diagnose_water_reflection_targets.py', 'diagnose_water_radiance.py')},
              'trace_sha256': sha(args.input / 'trace-rays.json.gz'), 'capture_json_sha256': sha(args.capture),
              'glb_sha256': sha(args.glb), 'blender': bpy.app.version_string, 'device': 'METAL' if gpu else 'CPU',
              'coordinates': 'Blender Z-up, meters', 'color_space': 'scene-linear Rec.709',
              'water_bounds': bounds, 'probe': list(probe), 'proxies': proxies, 'coping_top': coping,
              'panorama': [args.width, args.width // 2], 'capture_samples': args.capture_samples,
              'capture_seeds': seeds, 'truth_samples_per_pixel': args.truth_samples,
              'truth_pixels': TRUTH_SIZE * TRUTH_SIZE, 'truth_footprint_m': FOOTPRINT,
              'truth_distance_m': TRUTH_DISTANCE, 'lobe_samples': args.samples,
              'endpoints': endpoints, 'terminals': terminals, 'scenes': {}}
    started = time.monotonic()
    checker = (np.add.outer(np.arange(TRUTH_SIZE), np.arange(TRUTH_SIZE)) % 2).astype(bool)
    for label in args.scenes.split(','):
        scene = bpy.data.scenes[SCENES[label]]
        bpy.context.window.scene = scene
        saved = {o.name: o.visible_camera for o in scene.objects}
        world_camera = scene.world.cycles_visibility.camera
        for o in scene.objects:
            o.visible_camera = o.visible_transmission and o != water_obj and not drawn(o, label)
        scene.world.cycles_visibility.camera = scene.world.cycles_visibility.transmission
        for camera in (pano, ortho):
            if camera.name not in scene.collection.objects:
                scene.collection.objects.link(camera)
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'GPU' if gpu else 'CPU'
        scene.cycles.use_adaptive_sampling = False
        scene.cycles.use_denoising = False
        scene.cycles.pixel_filter_type = 'BOX'
        scene.render.use_persistent_data = True
        scene.render.resolution_percentage = 100
        scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
        scene.render.use_border = False
        scene.render.film_transparent = False
        scene.render.use_compositing = False
        scene.render.use_sequencer = False
        scene.render.use_motion_blur = False
        scene.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
        scene.render.image_settings.color_depth = '32'
        scene.render.image_settings.exr_codec = 'ZIP'
        for layer in scene.view_layers:
            layer.use = layer == scene.view_layers[0]
        scene.view_layers[0].use_pass_position = True
        scene_report = {'scene': SCENES[label], 'world_camera_visibility': scene.world.cycles_visibility.camera,
                        'lights_in_camera': sorted(o.name for o in scene.objects if o.type == 'LIGHT' and o.visible_camera),
                        'drawn_lights_excluded': sorted(o.name for o in scene.objects if drawn(o, label)),
                        'captures': []}

        scene.camera = pano
        scene.render.resolution_x, scene.render.resolution_y = args.width, args.width // 2
        scene.cycles.samples = args.capture_samples
        for seed in seeds:
            scene.cycles.seed = seed
            tick = time.monotonic()
            path = args.out / f'capture-{label}-{seed}.exr'
            scene.render.filepath = str(path.resolve())
            bpy.ops.render.render(write_still=True)
            color, position = read(path, 'Combined', 'Position')
            np.save(args.out / f'capture-{label}-{seed}.npy', color.astype(np.float32))
            np.save(args.out / f'position-{label}-{seed}.npy', position.astype(np.float32))
            scene_report['captures'].append({'seed': seed, 'seconds': time.monotonic() - tick, 'exr': path.name,
                                             'exr_sha256': sha(path)})
            print('CAPTURE_RADIANCE_PANORAMA', label, seed, time.monotonic() - tick, flush=True)

        scene.camera = ortho
        scene.render.resolution_x = scene.render.resolution_y = TRUTH_SIZE
        scene.cycles.samples = args.truth_samples
        scene.cycles.seed = seeds[0]
        path = args.out / 'truth.exr'
        scene.render.filepath = str(path.resolve())
        tick = time.monotonic()
        for index, terminal in enumerate(terminals):
            d = Vector(terminal['direction'])
            if terminal['hit']:
                target = Vector(terminal['hit']['position'])
                ortho.location = target - d * TRUTH_DISTANCE
            else:
                target = None
                ortho.location = Vector(terminal['origin']) + d * TRUTH_DISTANCE
            ortho.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            bpy.ops.render.render(write_still=True)
            color, position = read(path, 'Combined', 'Position')
            if not np.isfinite(color).all():
                raise RuntimeError(f'Non-finite truth radiance at terminal {index}')
            error = None
            if target is not None:
                error = float(np.linalg.norm(position - np.array(target), axis=-1).max())
            terminal['truth'][label] = {'rgb': color.reshape(-1, 3).mean(axis=0).tolist(),
                                        'halves': [color[checker].mean(axis=0).tolist(),
                                                   color[~checker].mean(axis=0).tolist()],
                                        'position_error_m': error}
            if index % 200 == 0:
                print('CAPTURE_RADIANCE_TRUTH', label, index, len(terminals), time.monotonic() - tick, flush=True)
        scene_report['truth_seconds'] = time.monotonic() - tick
        report['scenes'][label] = scene_report
        for name, value in saved.items():
            scene.objects[name].visible_camera = value
        scene.world.cycles_visibility.camera = world_camera
        for camera in (pano, ortho):
            scene.collection.objects.unlink(camera)
    report['elapsed_seconds'] = time.monotonic() - started
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report['source_unchanged'] = True
    with gzip.open(args.out / 'terminals.json.gz', 'wt') as stream:
        json.dump(report, stream)
    print('CAPTURE_RADIANCE_DONE', report['elapsed_seconds'], flush=True)


if __name__ == '__main__':
    main()
