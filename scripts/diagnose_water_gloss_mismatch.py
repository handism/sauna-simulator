"""Separate why the traced water-exit specular exceeds the Cycles glossy pass at some endpoints.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/diagnose_water_gloss_mismatch.py -- --out DIR

The 19 endpoints of diagnose_water_radiance.py are rendered again from 1 mm
before the hit along the last ray segment (its 'path' camera, all 5x5 pixels
averaged) while the source scene is changed one assumption of the lobe trace
(water_reflection_trace.py) at a time:

  base       source settings (glossy bounces 4, Filter Glossy 1, indirect clamp 10)
  bounces    all bounce limits 64
  blur0      Filter Glossy 0
  clamp0     no indirect clamp
  nobump     water Principled BSDF without its bump normal
  noabsorb   water without volume absorption
  flat       water faces flat shaded (the trace uses geometric normals; in the
             V11 source the side and bottom faces were single smooth strips whose
             corner normals leaned 45 degrees)
  model      every change above at once
  smooth     every water face smooth shaded (the V11 source before
             flatten_water_sides.py)
  walls      side strip and bottom flat, top smooth (flatten_water_sides.py)
  sides      side strip flat only
  bottom     bottom face flat only
The shading variants mark the edges between flat and smooth faces sharp, as
flatten_water_sides.py does for the rim.

Glossy is GlossCol x (GlossDir + GlossInd). Every change is undone before the
next variant and the source blend is not saved.
summarize_water_gloss_mismatch.py compares the passes with the traced exit.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))

from blend_lineage import same_geometry  # noqa: E402
from diagnose_water_radiance import combine_passes, select_records  # noqa: E402
from diagnose_water_reflection_targets import SCENES, WATER  # noqa: E402

SINGLE = ['bounces', 'blur0', 'clamp0', 'nobump', 'noabsorb', 'flat']
SHADING = ['smooth', 'walls', 'sides', 'bottom']
VARIANTS = {'base': [], **{name: [name] for name in SINGLE}, 'model': SINGLE,
            **{name: [name] for name in SHADING}}
BOUNCES = ('max_bounces', 'diffuse_bounces', 'glossy_bounces', 'transmission_bounces',
           'transparent_max_bounces', 'volume_bounces')
SIZE = 5


def main():
    import bpy
    import numpy as np
    import OpenImageIO as oiio
    from mathutils import Vector
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=256, help='per pixel; 25 pixels are averaged')
    parser.add_argument('--seeds', default='17,83')
    parser.add_argument('--variants', default=','.join(VARIANTS))
    parser.add_argument('--scenes', default='day,evening')
    parser.add_argument('--limit', type=int, help='first N endpoints only (smoke test)')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    variants = args.variants.split(',')
    if any(v not in VARIANTS for v in variants):
        parser.error(f'variants must be among {list(VARIANTS)}')
    seeds = [int(s) for s in args.seeds.split(',')]
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    source = Path(bpy.data.filepath)
    source_hash = sha(source)
    metadata = json.loads((args.input / 'trace-summary.json').read_text())
    if not same_geometry(source_hash, metadata['input_sha256']):
        raise RuntimeError('Endpoint fixture belongs to a different blend')
    with gzip.open(args.input / 'trace-rays.json.gz', 'rt') as stream:
        selected = select_records(json.load(stream)['original'], 3)[:args.limit]

    water = bpy.data.objects[WATER]
    mesh = water.data
    sharp = mesh.attributes.get('sharp_face')
    sharp_saved = [False] * len(mesh.polygons)
    if sharp is not None:
        sharp.data.foreach_get('value', sharp_saved)
    edges_saved = [e.use_edge_sharp for e in mesh.edges]
    edge_faces = {}
    for poly in mesh.polygons:
        for key in poly.edge_keys:
            edge_faces.setdefault(key, []).append(poly.index)
    # The top grid is at 0.765 m +- 1 cm, the bottom at 0.215 m; the side strip spans both.
    heights = [[mesh.vertices[v].co.z for v in p.vertices] for p in mesh.polygons]
    parts = ['top' if min(z) > 0.5 else 'bottom' if max(z) < 0.5 else 'side' for z in heights]
    shaders = []
    for slot in water.material_slots:
        tree = slot.material.node_tree
        out = next(n for n in tree.nodes if n.bl_idname == 'ShaderNodeOutputMaterial' and n.is_active_output)
        bsdf = out.inputs['Surface'].links[0].from_node
        shaders.append({'material': slot.material.name, 'tree': tree, 'bsdf': bsdf, 'output': out,
                        'normal': bsdf.inputs['Normal'].links[0].from_socket
                        if bsdf.inputs['Normal'].is_linked else None,
                        'volume': out.inputs['Volume'].links[0].from_socket
                        if out.inputs['Volume'].is_linked else None})

    def apply(scene, changes, saved):
        cycles = scene.cycles
        for name in BOUNCES + ('blur_glossy', 'sample_clamp_indirect'):
            setattr(cycles, name, saved[name])
        for entry in shaders:
            links = entry['tree'].links
            for socket, source_socket in ((entry['bsdf'].inputs['Normal'], entry['normal']),
                                          (entry['output'].inputs['Volume'], entry['volume'])):
                for link in list(socket.links):
                    links.remove(link)
                if source_socket is not None:
                    links.new(source_socket, socket)
        sharp = sharp_saved
        if 'flat' in changes:
            sharp = [True] * len(mesh.polygons)
        elif 'smooth' in changes:
            sharp = [False] * len(mesh.polygons)
        elif any(name in changes for name in ('walls', 'sides', 'bottom')):
            flat_part = {'walls': ('side', 'bottom'), 'sides': ('side',), 'bottom': ('bottom',)}[changes[0]]
            sharp = [part in flat_part for part in parts]
        attribute = mesh.attributes.get('sharp_face') or mesh.attributes.new('sharp_face', 'BOOLEAN', 'FACE')
        attribute.data.foreach_set('value', sharp)
        # Cycles shades smooth faces with vertex normals that average in the flat neighbours
        # unless the edge between them is sharp (as flatten_water_sides.py marks the rim).
        for edge in mesh.edges:
            edge.use_edge_sharp = (edges_saved[edge.index] if sharp is sharp_saved else
                                   len({sharp[f] for f in edge_faces[edge.key]}) > 1)
        mesh.update()
        if 'bounces' in changes:
            for name in BOUNCES:
                setattr(cycles, name, 64)
        if 'blur0' in changes:
            cycles.blur_glossy = 0.0
        if 'clamp0' in changes:
            cycles.sample_clamp_indirect = 0.0
        for entry in shaders:
            links = entry['tree'].links
            if 'nobump' in changes:
                for link in list(entry['bsdf'].inputs['Normal'].links):
                    links.remove(link)
            if 'noabsorb' in changes:
                for link in list(entry['output'].inputs['Volume'].links):
                    links.remove(link)

    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    gpu = any(d.use for d in prefs.devices)
    cam_data = bpy.data.cameras.new('Water gloss mismatch')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 0.00001
    cam_data.clip_start = 0.000001
    cam_data.clip_end = 100
    camera = bpy.data.objects.new(cam_data.name, cam_data)
    report = {'input_sha256': source_hash, 'script_sha256': sha(Path(__file__)),
              'trace_sha256': sha(args.input / 'trace-rays.json.gz'),
              'blender': bpy.app.version_string, 'device': 'METAL' if gpu else 'CPU',
              'water_materials': [{'material': e['material'], 'bump': e['normal'] is not None,
                                   'volume': e['volume'] is not None} for e in shaders],
              'water_faces': len(mesh.polygons), 'water_sharp_faces': sum(sharp_saved),
              'water_sharp_edges': sum(edges_saved),
              'samples_per_pixel': args.samples, 'pixels': SIZE * SIZE, 'seeds': seeds,
              'footprint_m': cam_data.ortho_scale, 'camera_distance_m': 0.001,
              'variants': {v: VARIANTS[v] for v in variants}, 'color_space': 'scene-linear Rec.709',
              'endpoints': [{'index': i, 'group': r['group'], 'pixel': r['pixel'], 'material': r['hit']['material'],
                             'position': r['hit']['position']} for i, r in enumerate(selected)],
              'scenes': {}, 'renders': []}
    started = time.monotonic()
    for label in args.scenes.split(','):
        scene = bpy.data.scenes[SCENES[label]]
        bpy.context.window.scene = scene
        cycles = scene.cycles
        saved = {name: getattr(cycles, name) for name in BOUNCES + ('blur_glossy', 'sample_clamp_indirect')}
        report['scenes'][label] = {'scene': scene.name, 'settings': saved}
        scene.collection.objects.link(camera)
        scene.camera = camera
        scene.render.engine = 'CYCLES'
        cycles.device = 'GPU' if gpu else 'CPU'
        cycles.samples = args.samples
        cycles.use_adaptive_sampling = False
        cycles.use_denoising = False
        cycles.pixel_filter_type = 'BOX'
        scene.render.use_persistent_data = True
        scene.render.resolution_x = scene.render.resolution_y = SIZE
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
        layer.use_pass_emit = layer.use_pass_environment = layer.use_pass_position = True
        for variant in variants:
            apply(scene, VARIANTS[variant], saved)
            tick = time.monotonic()
            for index, record in enumerate(selected):
                point = Vector(record['hit']['position'])
                direction = (point - Vector(record['events'][-1]['position'])).normalized()
                camera.location = point - direction * 0.001
                camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
                for seed in seeds:
                    # A seed change alone is not synced with persistent data; a new
                    # output path per seed (as in diagnose_water_radiance.py) is.
                    cycles.seed = seed
                    path = args.out / f'render-{seed}.exr'
                    scene.render.filepath = str(path.resolve())
                    bpy.ops.render.render(write_still=True)
                    image = oiio.ImageInput.open(str(path))
                    spec = image.spec()
                    names = list(spec.channelnames)
                    pixels = np.asarray(image.read_image(format='float')).reshape(spec.height, spec.width, -1)
                    image.close()
                    if (spec.width, spec.height) != (SIZE, SIZE) or not np.isfinite(pixels).all():
                        raise RuntimeError(f'Invalid render {label} {variant} {index}')
                    mean = pixels.reshape(-1, spec.nchannels).mean(axis=0)

                    def rgb(name, axes='RGB'):
                        return [float(mean[names.index(f'{layer.name}.{name}.{a}')]) for a in axes]
                    passes = {name: rgb(name) for name in ['Combined', 'Emit', 'Env'] +
                              [p + k for p in ('Diff', 'Gloss', 'Trans') for k in ('Dir', 'Ind', 'Col')]}
                    position = np.array([rgb('Position', 'XYZ')])
                    cells = pixels[:, :, [names.index(f'{layer.name}.Position.{a}') for a in 'XYZ']]
                    error = float(np.linalg.norm(cells.reshape(-1, 3) - np.array(point), axis=1).max())
                    colors = combine_passes(passes)
                    # Per-pixel products do not commute with the 25-pixel mean; keep the check loose.
                    residual = float(np.max(np.abs(np.array(colors['combined']) - colors['reconstructed'])))
                    report['renders'].append({'scene': label, 'variant': variant, 'index': index, 'seed': seed,
                                              'position': position[0].tolist(), 'position_error_m': error,
                                              'passes': passes, 'colors': colors,
                                              'reconstruction_max_abs': residual})
            print('GLOSS_MISMATCH', label, variant, round(time.monotonic() - tick, 1), flush=True)
        apply(scene, [], saved)
        scene.collection.objects.unlink(camera)
    report['elapsed_seconds'] = time.monotonic() - started
    if sha(source) != source_hash:
        raise RuntimeError('Source blend changed')
    report['source_unchanged'] = True
    (args.out / 'gloss.json').write_text(json.dumps(report, indent=1) + '\n')
    print('GLOSS_MISMATCH_DONE', report['elapsed_seconds'], flush=True)


if __name__ == '__main__':
    main()
