"""Render local endpoint radiance from path/capture directions in source Cycles.

Blender: -b SOURCE --python-exit-code 1 --python SCRIPT -- --out DIR.
This is a local shading experiment, not a water image or WebGL implementation.
Camera rays start 1 mm before the endpoint; capture occlusion is deliberately
excluded (diagnose_water_capture.py evaluates it separately).
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time


def select_records(records, per_group=3):
    """Stratify important endpoint materials, then sample spatially ordered ranks."""
    groups = {}
    for record in records:
        hit = record.get('hit')
        if not hit or not record['events']:
            continue
        material = hit['material']
        family = ('tile' if 'Teal glazed pool tile' in material else
                  'wall' if 'quiet honed stone' in material else
                  'base' if material == 'Blackened bronze' else None)
        if family is not None:
            groups.setdefault(f"{record['first_exit']}/{family}", []).append(record)
    selected = []
    for name, group in sorted(groups.items()):
        group.sort(key=lambda r: (r['pixel'][1], r['pixel'][0]))
        for index in sorted({min(len(group) - 1, int((i + 0.5) * len(group) / per_group))
                             for i in range(per_group)}):
            selected.append({'group': name, 'population': len(group), **group[index]})
    return selected


def combine_passes(passes):
    """Cycles pass reconstruction; direct/indirect passes exclude BSDF color."""
    def component(prefix):
        return [(a + b) * c for a, b, c in zip(passes[prefix + 'Dir'],
                passes[prefix + 'Ind'], passes[prefix + 'Col'])]
    diffuse, glossy, transmission = [component(p) for p in ('Diff', 'Gloss', 'Trans')]
    de = [a + b for a, b in zip(diffuse, passes['Emit'])]
    total = [a + b + c + d for a, b, c, d in zip(de, glossy, transmission, passes['Env'])]
    return {'diffuse_emission': de, 'glossy': glossy, 'transmission': transmission,
            'reconstructed': total, 'combined': passes['Combined']}


def main():
    import bpy
    import numpy as np
    import OpenImageIO as oiio
    from mathutils import Vector
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=1024)
    parser.add_argument('--per-group', type=int, default=3)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.samples < 1 or args.per_group < 1:
        parser.error('samples and per-group must be positive')
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    if source_hash != metadata['input_sha256']:
        raise RuntimeError('Endpoint fixture belongs to a different blend')
    with gzip.open(args.input / 'trace-rays.json.gz', 'rt') as stream:
        selected = select_records(json.load(stream)['original'], args.per_group)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    gpu = any(d.use for d in prefs.devices)
    cam_data = bpy.data.cameras.new('Water radiance diagnostic')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 0.00001  # 10 micrometre footprint, not texture-resolution QA.
    cam_data.clip_start = 0.000001
    cam_data.clip_end = 100
    cam_data.dof.use_dof = False
    camera = bpy.data.objects.new(cam_data.name, cam_data)
    report = {'input_sha256': source_hash, 'script_sha256': sha(Path(__file__)),
              'trace_sha256': sha(args.input / 'trace-rays.json.gz'),
              'blender': bpy.app.version_string, 'device': 'METAL' if gpu else 'CPU',
              'resolution': [5, 5], 'sample_texel': [2, 2],
              'samples': args.samples, 'seeds': [17, 83], 'footprint_m': cam_data.ortho_scale,
              'camera_distance_m': 0.001, 'color_space': 'scene-linear Rec.709',
              'selected': selected, 'renders': []}
    started = time.monotonic()
    for label, scene_name in [('day', 'SUI • Daylight'), ('evening', 'SUI • Blue hour')]:
        scene = bpy.data.scenes[scene_name]
        bpy.context.window.scene = scene
        original_camera = scene.objects[metadata['camera']]
        original_location = original_camera.matrix_world.translation.copy()
        scene.collection.objects.link(camera)
        scene.camera = camera
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'GPU' if gpu else 'CPU'
        scene.cycles.samples = args.samples
        scene.cycles.use_adaptive_sampling = False
        scene.cycles.use_denoising = False
        scene.cycles.pixel_filter_type = 'BOX'
        scene.render.use_persistent_data = True
        scene.render.resolution_x = scene.render.resolution_y = 5
        scene.render.resolution_percentage = 100
        scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1
        scene.render.use_border = False
        scene.render.use_compositing = False
        scene.render.use_sequencer = False
        scene.render.use_motion_blur = False
        scene.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
        scene.render.image_settings.color_depth = '32'
        scene.render.image_settings.exr_codec = 'ZIP'
        for layer in scene.view_layers:
            layer.use = layer == scene.view_layers[0]
        layer = scene.view_layers[0]
        for family in ('diffuse', 'glossy', 'transmission'):
            for kind in ('direct', 'indirect', 'color'):
                setattr(layer, f'use_pass_{family}_{kind}', True)
        layer.use_pass_emit = layer.use_pass_environment = True
        layer.use_pass_position = True
        for index, record in enumerate(selected):
            point = Vector(record['hit']['position'])
            last = Vector(record['events'][-1]['position'])
            directions = {'path': (point - last).normalized(),
                          'camera': (point - original_location).normalized(),
                          'overhead': Vector((0, 0, -1)),
                          'normal': -Vector(record['hit']['normal']).normalized()}
            for mode, direction in directions.items():
                # A vertical camera cannot capture a vertical wall. Do not turn
                # its grazing/incorrect hit into a valid color measurement.
                if direction.dot(Vector(record['hit']['normal'])) >= -0.001:
                    report['renders'].append({'scene': label, 'index': index, 'mode': mode,
                                              'skipped': 'backface_or_grazing'})
                    continue
                camera.location = point - direction * 0.001
                camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
                for seed in report['seeds']:
                    scene.cycles.seed = seed
                    path = args.out / f'{label}-{index:02d}-{mode}-{seed}.exr'
                    scene.render.filepath = str(path.resolve())
                    bpy.ops.render.render(write_still=True)
                    inp = oiio.ImageInput.open(str(path))
                    spec = inp.spec()
                    names = list(spec.channelnames)
                    # Blender clamps images below 4 pixels; use an odd 5x5 image
                    # and its centre texel so every direction samples the endpoint.
                    pixels = np.asarray(inp.read_image(format='float')).reshape(spec.height, spec.width, spec.nchannels)
                    data = pixels[spec.height // 2, spec.width // 2]
                    if (spec.width, spec.height) != (5, 5):
                        raise RuntimeError('Unexpected render resolution')
                    inp.close()
                    def rgb(name):
                        channels = [f'{layer.name}.{name}.{axis}' for axis in 'RGB']
                        if name == 'Position':
                            channels = [f'{layer.name}.{name}.{axis}' for axis in 'XYZ']
                        return [float(data[names.index(channel)]) for channel in channels]
                    passes = {name: rgb(name) for name in ['Combined', 'Emit', 'Env'] +
                              [p + k for p in ('Diff', 'Gloss', 'Trans') for k in ('Dir', 'Ind', 'Col')]}
                    position = rgb('Position')
                    position_error = float(np.linalg.norm(np.array(position) - np.array(point)))
                    colors = combine_passes(passes)
                    residual = float(np.max(np.abs(np.array(colors['combined']) - colors['reconstructed'])))
                    if not np.isfinite(data).all() or residual > 1e-4:
                        raise RuntimeError(f'Invalid radiance or pass reconstruction: {path}: {residual}')
                    report['renders'].append({'scene': label, 'index': index, 'mode': mode, 'seed': seed,
                        'direction': list(direction), 'position': position, 'position_error_m': position_error,
                        'valid_position': position_error <= 0.0001, 'passes': passes, 'colors': colors,
                        'reconstruction_max_abs': residual, 'exr': path.name, 'exr_sha256': sha(path)})
                    print('RADIANCE_SAMPLE', label, index, mode, seed, position_error, flush=True)
    report['elapsed_seconds'] = time.monotonic() - started
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report['source_unchanged'] = True
    (args.out / 'radiance.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
