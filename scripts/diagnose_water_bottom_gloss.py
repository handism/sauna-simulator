"""What makes the inside of the plunge's dusk disks uneven in Cycles, and whether its light is seen.

Blender -b blender/scene/SUI_Retreat.blend -S "SUI • Blue hour" --python-exit-code 1 --python scripts/diagnose_water_bottom_gloss.py -- <out dir>
(Metal, a few minutes.) Two parts, the blend is never saved:

1. The lounge dusk fill's patches of diagnose_water_bump.py (the evening water stage looking down
   and at heading 2), 512 samples without denoising, with the dusk fill in its own light group, in
   four variants: as it is; the pool tiles' Specular IOR Level at 0; the water's bottom face moved
   below the tiles (0.19 m); both. Each crop is saved as <variant>-<view>.npz (linear Combined and
   the dusk fill's group, top row first) and <variant>-<view>-display.npy (Blender's AgX with the
   scene's exposure, 0–1).
2. How much of the dusk fill the floor sees along the refracted path (water_gloss.py): on a 24×28
   grid over the floor, the fraction of 216 points on its 2 m disk reached by the exact path (exit
   inside the water's box, then a clear line to the point), the same for the disk's center alone,
   the product's approximation (the exit of the straight line's air direction, then a clear line
   to the center) and the straight line from the floor.

gloss.json holds the tile material, the spot's mean per variant and light group and the grid's
means; the npz/npy and grid (visibility.npy) stay out of Git.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
import OpenImageIO as oiio
import PyOpenColorIO as ocio
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_stage_reference as ref  # noqa: E402
from water_gloss import BOTTOM, LEVEL, exact_exit, product_exit  # noqa: E402

WATER = 'V4 rippled spring water volume'
TILE = 'V10 | submerged light / Teal glazed pool tile'
FILL = 'V10 lounge dusk fill / dusk'
# (heading, pitch, x0, x1, y0, y1), pixels from the top left of the 1280×800 view.
CROPS = [(1, 'down', 680, 940, 0, 180), (2, 'level', 120, 420, 520, 720)]
VARIANTS = ['base', 'spec0', 'nobottom', 'nobottom-spec0']
SAMPLES = 512
LOWERED = 0.19
# The dusk fill in Blender axes (glTF (5.9, 2.8, 1.4), facing (-0.3142, -0.6569, -0.6854)), 2 m disk.
CENTER = Vector((5.9, -1.4, 2.8))
FACING = Vector((-0.3142, 0.6854, -0.6569)).normalized()
RADIUS = 1.0
# The water's box in Blender xy.
BOX = (-0.155, 2.515, 0.905, 4.095)


def use_gpu(scene):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = 'GPU'


def read_layers(path):
    image = oiio.ImageBuf(str(path))
    spec = image.spec()
    pixels = image.get_pixels(oiio.FLOAT).reshape(spec.height, spec.width, -1)
    layers = {}
    for name in ('Combined', 'Combined_fill'):
        layers[name] = np.stack([pixels[..., spec.channelnames.index(f'ViewLayer.{name}.{c}')] for c in 'RGB'], -1)
    return layers


def render_crops(scene, out):
    render = scene.render
    render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    render.image_settings.color_depth = '32'
    scene.cycles.samples, scene.cycles.use_denoising = SAMPLES, False
    layer = scene.view_layers[0]
    layer.lightgroups.add(name='fill')
    bpy.data.objects[FILL].lightgroup = 'fill'
    tile = bpy.data.materials[TILE]
    bsdf = next(n for n in tile.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    specular = bsdf.inputs['Specular IOR Level'].default_value
    material = {
        name: float(bsdf.inputs[name].default_value)
        for name in ('Roughness', 'Specular IOR Level', 'IOR', 'Metallic')
        if not bsdf.inputs[name].is_linked
    }
    water = bpy.data.objects[WATER]
    assert water.matrix_world.translation.length < 1e-6
    bottom = [v for v in water.data.vertices if abs(v.co.z - BOTTOM) < 1e-4]
    assert len(bottom) > 0

    view = json.loads((ref.ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
    position, target = view['position'], view['target']
    d = [t - p for t, p in zip(target, position)]
    yaw0 = math.atan2(-d[0], -d[2])
    render.resolution_x, render.resolution_y, render.resolution_percentage = 1280, 800, 100
    data = bpy.data.cameras.new('gloss survey')
    data.sensor_fit = 'VERTICAL'
    data.angle_y = math.radians(view['fov'])
    data.clip_start, data.clip_end = 0.05, 250
    camera = bpy.data.objects.new('gloss survey', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    render.use_border = render.use_crop_to_border = True

    config = ocio.Config.CreateFromFile(
        str(Path(bpy.utils.resource_path('LOCAL')) / 'datafiles/colormanagement/config.ocio')
    )
    display = config.getProcessor(
        ocio.DisplayViewTransform(src='Linear Rec.709', display='sRGB', view='AgX')
    ).getDefaultCPUProcessor()
    exposure = 2 ** scene.view_settings.exposure

    spots = {}
    for variant in VARIANTS:
        bsdf.inputs['Specular IOR Level'].default_value = 0.0 if 'spec0' in variant else specular
        for vertex in bottom:
            vertex.co.z = LOWERED if 'nobottom' in variant else BOTTOM
        water.data.update()
        for heading, pitch, x0, x1, y0, y1 in CROPS:
            camera.matrix_world = ref.camera_matrix(position, yaw0 - 0.8 * heading, ref.PITCH[pitch])
            render.border_min_x, render.border_max_x = x0 / 1280, x1 / 1280
            render.border_min_y, render.border_max_y = 1 - y1 / 800, 1 - y0 / 800
            name = f'{variant}-{heading}-{pitch}'
            path = out / f'{name}.exr'
            render.filepath = str(path)
            bpy.ops.render.render(write_still=True)
            layers = read_layers(path)
            np.savez(out / f'{name}.npz', **layers)
            shown = np.ascontiguousarray(layers['Combined'] * exposure, np.float32)
            display.applyRGB(shown)
            np.save(out / f'{name}-display.npy', np.clip(shown, 0, 1))
            spots[name] = layers
    bsdf.inputs['Specular IOR Level'].default_value = specular
    for vertex in bottom:
        vertex.co.z = BOTTOM
    water.data.update()
    render.use_border = False

    # The spot: the brightest fifth of the dusk fill's group as it is.
    report = {}
    for heading, pitch, *_ in CROPS:
        view_name = f'{heading}-{pitch}'
        fill = spots[f'base-{view_name}']['Combined_fill'].mean(-1)
        mask = fill > np.percentile(fill, 80)
        report[view_name] = {
            variant: {
                group: float(spots[f'{variant}-{view_name}'][group].mean(-1)[mask].mean())
                for group in ('Combined', 'Combined_fill')
            }
            for variant in VARIANTS
        }
    return material, report


def scene_bvh(scene):
    graph = bpy.context.evaluated_depsgraph_get()
    vertices, polygons = [], []
    for o in scene.objects:
        if o.type != 'MESH' or o.hide_render or o.name == WATER or o.name == 'Water volume' or not o.visible_shadow:
            continue
        mesh = o.evaluated_get(graph).to_mesh()
        base = len(vertices)
        vertices += [o.matrix_world @ v.co for v in mesh.vertices]
        polygons += [[base + i for i in p.vertices] for p in mesh.polygons]
        o.evaluated_get(graph).to_mesh_clear()
    return BVHTree.FromPolygons(vertices, polygons)


def visibility(scene, out):
    bvh = scene_bvh(scene)
    u = FACING.orthogonal().normalized()
    v = FACING.cross(u)
    disk = []
    for ring in range(6):
        for k in range(6 * (2 * ring + 1)):
            r = (ring + 0.5) / 6 * RADIUS
            a = 2 * math.pi * (k + 0.5) / (6 * (2 * ring + 1))
            disk.append(CENTER + u * (r * math.cos(a)) + v * (r * math.sin(a)))
    x0, x1, y0, y1 = BOX

    def inside(q):
        return x0 < q[0] < x1 and y0 < q[1] < y1

    def clear(start, end, skip=1e-3):
        d = end - start
        distance = d.length
        d.normalize()
        return bvh.ray_cast(start + d * skip, d, distance - skip - 1e-2)[2] is None

    def seen(floor, point):
        q = exact_exit(floor, point)
        return inside(q) and clear(Vector(q), point)

    grid = []
    for i in range(24):
        for j in range(28):
            floor = (x0 + 0.02 + (x1 - x0 - 0.04) * (i + 0.5) / 24, y0 + 0.02 + (y1 - y0 - 0.04) * (j + 0.5) / 28, 0.202)
            q = product_exit(floor, CENTER)
            grid.append([
                floor[0],
                floor[1],
                sum(seen(floor, point) for point in disk) / len(disk),
                float(seen(floor, CENTER)),
                float(inside(q) and clear(Vector(q), CENTER)),
                float(clear(Vector(floor), CENTER, 2e-2)),
            ])
    grid = np.array(grid)
    np.save(out / 'visibility.npy', grid)
    names = ['exactDisk', 'exactCenter', 'productExit', 'straightLine']
    return {
        'grid': [24, 28],
        'diskPoints': len(disk),
        'mean': {name: float(grid[:, 2 + k].mean()) for k, name in enumerate(names)},
        'productVsExactCenterAgreement': float((grid[:, 4] == grid[:, 3]).mean()),
    }


def main():
    out = Path(sys.argv[sys.argv.index('--') + 1])
    out.mkdir(parents=True, exist_ok=True)
    source = Path(bpy.data.filepath)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    scene = bpy.context.scene
    assert scene.name == 'SUI • Blue hour', scene.name
    use_gpu(scene)
    material, spots = render_crops(scene, out)
    seen = visibility(scene, out)
    assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
    report = {
        'blend': source.name,
        'blendSha256': source_hash,
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'samples': SAMPLES,
        'crops': CROPS,
        'variants': VARIANTS,
        'tileMaterial': material,
        'spotMeanLinear': spots,
        'visibility': seen,
    }
    (out / 'gloss.json').write_text(json.dumps(report, indent=1) + '\n')
    print('WATER_GLOSS', json.dumps(seen), flush=True)


if __name__ == '__main__':
    main()
