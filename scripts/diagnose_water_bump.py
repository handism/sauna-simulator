"""Where the frayed edges of the lights seen off the plunge's bottom come from (Cycles).

Blender -b blender/scene/SUI_Retreat.blend -S "SUI • Blue hour" --python-exit-code 1 --python scripts/diagnose_water_bump.py -- <out dir>
(Metal, about 12 minutes.) Two parts, the blend is never saved:

1. The evening water stage views of blender_stage_reference.py, cropped to the lounge dusk fill's
   patches, as 32-bit EXRs: the reference settings (128 denoised samples), 2048 samples without
   denoising, and the same with the water's Bump node disconnected.
2. The water's shading normal seen straight down (orthographic 0.5 m, 1000², one sample at the
   pixel center, only the water rendered) with and without the bump; the slopes' rms, median and
   95th percentile of their difference go to bump.json.

Crops and normals are also saved as .npy (linear RGB / normal, top row first). The EXRs and npy
stay out of Git; bump.json and the review of the crops go to docs/3d-qa/water-bottom-bump.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_stage_reference as ref  # noqa: E402

WATER = 'V4 rippled spring water volume'
MATERIAL = 'V4 | clear spring water'
# (heading, pitch, x0, x1, y0, y1), pixels from the top left of the 1280×800 view.
CROPS = [(1, 'down', 680, 940, 0, 180), (2, 'level', 120, 420, 520, 720), (0, 'level', 0, 260, 560, 800)]
VARIANTS = [('base', 128, True, True), ('clean', 2048, False, True), ('nobump', 2048, False, False)]


def load(path):
    image = bpy.data.images.load(str(path))
    w, h = image.size
    pixels = np.array(image.pixels[:], np.float32).reshape(h, w, 4)[::-1, :, :3]
    bpy.data.images.remove(image)
    return pixels


def use_gpu(scene):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = 'GPU'


def main():
    out = Path(sys.argv[sys.argv.index('--') + 1])
    out.mkdir(parents=True, exist_ok=True)
    source = Path(bpy.data.filepath)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    scene = bpy.context.scene
    assert scene.name == 'SUI • Blue hour', scene.name
    use_gpu(scene)
    render = scene.render
    render.image_settings.file_format = 'OPEN_EXR'
    render.image_settings.color_depth = '32'
    material = bpy.data.materials[MATERIAL]
    bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bump = bsdf.inputs['Normal'].links[0].from_socket
    assert bump.node.type == 'BUMP'

    def set_bump(on):
        links = material.node_tree.links
        if not on and bsdf.inputs['Normal'].is_linked:
            links.remove(bsdf.inputs['Normal'].links[0])
        if on and not bsdf.inputs['Normal'].is_linked:
            links.new(bump, bsdf.inputs['Normal'])

    # 1. The stage crops.
    view = json.loads((ref.ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
    position, target = view['position'], view['target']
    d = [t - p for t, p in zip(target, position)]
    yaw0 = math.atan2(-d[0], -d[2])
    render.resolution_x, render.resolution_y, render.resolution_percentage = 1280, 800, 100
    data = bpy.data.cameras.new('bump survey')
    data.sensor_fit = 'VERTICAL'
    data.angle_y = math.radians(view['fov'])
    data.clip_start, data.clip_end = 0.05, 250
    camera = bpy.data.objects.new('bump survey', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    render.use_border = render.use_crop_to_border = True
    for name, samples, denoise, on in VARIANTS:
        scene.cycles.samples, scene.cycles.use_denoising = samples, denoise
        set_bump(on)
        for heading, pitch, x0, x1, y0, y1 in CROPS:
            camera.matrix_world = ref.camera_matrix(position, yaw0 - 0.8 * heading, ref.PITCH[pitch])
            render.border_min_x, render.border_max_x = x0 / 1280, x1 / 1280
            render.border_min_y, render.border_max_y = 1 - y1 / 800, 1 - y0 / 800
            path = out / f'{name}-{heading}-{pitch}.exr'
            render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            np.save(path.with_suffix('.npy'), load(path))
    set_bump(True)
    render.use_border = False

    # 2. The bump's slopes on the shading normal, seen from above away from the spout.
    scene.cycles.samples, scene.cycles.use_denoising = 1, False
    scene.cycles.pixel_filter_type, scene.cycles.filter_width = 'BOX', 0.01
    render.resolution_x = render.resolution_y = 1000
    data = bpy.data.cameras.new('bump normals')
    data.type, data.ortho_scale = 'ORTHO', 0.5
    top = bpy.data.objects.new('bump normals', data)
    scene.collection.objects.link(top)
    top.location, top.rotation_euler = (1.6, 2.5, 1.5), (0, 0, 0)
    scene.camera = top
    hidden = [o for o in scene.objects if o.type == 'MESH' and o.name != WATER and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    scene.view_layers[0].use_pass_normal = True
    scene.use_nodes = True
    tree = scene.node_tree
    for node in list(tree.nodes):
        tree.nodes.remove(node)
    layers = tree.nodes.new('CompositorNodeRLayers')
    tree.links.new(layers.outputs['Normal'], tree.nodes.new('CompositorNodeComposite').inputs['Image'])
    normals = {}
    for name, on in (('bump', True), ('flat', False)):
        set_bump(on)
        path = out / f'normal-{name}.exr'
        render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        normals[name] = load(path)
        np.save(path.with_suffix('.npy'), normals[name])
    a, b = normals['bump'], normals['flat']
    slope = np.hypot(a[..., 0] / a[..., 2] - b[..., 0] / b[..., 2], a[..., 1] / a[..., 2] - b[..., 1] / b[..., 2])
    stats = {
        'rms': float(np.sqrt((slope ** 2).mean())),
        'p50': float(np.median(slope)),
        'p95': float(np.percentile(slope, 95)),
    }
    assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
    report = {
        'blend': source.name,
        'blendSha256': source_hash,
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'crops': CROPS,
        'variants': VARIANTS,
        'normalView': {'center': [1.6, 2.5], 'size': 0.5, 'pixels': 1000},
        'bumpSlope': stats,
    }
    (out / 'bump.json').write_text(json.dumps(report, indent=1) + '\n')
    print('WATER_BUMP', json.dumps(stats), flush=True)


if __name__ == '__main__':
    main()
