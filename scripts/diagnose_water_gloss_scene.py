"""Which part of the source plunge dims the tile gloss of the dusk fill against the flat-slab analysis.

Blender -b blender/scene/SUI_Retreat.blend -S 'SUI • Blue hour' --python-exit-code 1
  --python scripts/diagnose_water_gloss_scene.py -- --out DIR [--samples 1024]

The two crops of diagnose_water_bottom_gloss.py (evening water stage, looking down / heading 2) are
rendered with the dusk fill in its own light group, the tiles' Specular IOR Level as is and at 0
(same seed); the difference is the tile gloss. The source is stripped one feature at a time
(unsaved, in memory):

- `source`: as it is;
- `clear`: the water white (base color 1, no volume absorption), roughness and bump kept;
- `smooth`: also roughness 0 and no bump;
- `flat`: also the top at the mean level (0.765 m, Blender z);
- `rim`: also every object hidden but the tub (walls, coping, shadow joints, plinth, bottom);
- `bare`: also the coping and joints hidden and the walls cut at the water level (0.765 m), so
  nothing stands between the water and the lamp, yet no light enters through the water's sides.

For each variant a mapping render replaces the tile surface by emission (other objects hidden,
no diffuse bounces, the tiles not sampled as lights so every render traces the same paths): 1 (the view path's RGB throughput × tile coverage), the position and Geometry
Incoming (the air-gap direction to the viewer), offset to stay positive. Positions and directions are
throughput-weighted means per pixel. On every 5th pixel the flat-slab light-side integral
(diagnose_water_gloss_slab.slab_integral, Fresnel of both faces, no occlusion, clear water) at that
position and direction, times the mapped throughput, is the analysis the render is compared with.

EXR/NPZ stay in DIR; scene.json (in DIR) holds the spot means, ratios and hashes. The blend is
never saved; its SHA-256 is checked before and after.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from diagnose_water_gloss_slab import slab_integral  # noqa: E402
from water_gloss import LEVEL  # noqa: E402

WATER = 'V4 rippled spring water volume'
WATER_MATERIAL = 'V4 | clear spring water'
TILE = 'V10 | submerged light / Teal glazed pool tile'
FILL = 'V10 lounge dusk fill / dusk'
CROPS = [(1, 'down', 680, 940, 0, 180), (2, 'level', 120, 420, 520, 720)]
VARIANTS = ['source', 'clear', 'smooth', 'flat', 'rim', 'bare']
TUB = ('Plunge side basalt', 'Plunge end basalt', 'Honed pool coping', 'V8 coping shadow joint', 'Plunge bottom',
       'V8 recessed pool plinth')
WALLS = ('Plunge side basalt', 'Plunge end basalt')
CUT = ('Honed pool coping', 'V8 coping shadow joint')
STRIDE = 5
# Encoded emission = value + OFFSET keeps every channel positive.
OFFSET = 2.0


# Blender modules, bound by main() so the analysis below imports without Blender.
bpy = oiio = ref = None
LUMINANCE = np.array([0.2126, 0.7152, 0.0722])


def read(path, names):
    image = oiio.ImageBuf(str(path))
    spec = image.spec()
    pixels = image.get_pixels(oiio.FLOAT).reshape(spec.height, spec.width, -1)
    return {
        name: np.stack([pixels[..., spec.channelnames.index(f'ViewLayer.{name}.{c}')] for c in 'RGB'], -1)
        for name in names
    }


def gltf(v):
    return np.array([v[0], v[2], -v[1]])


class Scene:
    def __init__(self, scene, samples):
        self.scene = scene
        self.samples = samples
        render = scene.render
        render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
        render.image_settings.color_depth = '32'
        render.resolution_x, render.resolution_y, render.resolution_percentage = 1280, 800, 100
        render.use_border = render.use_crop_to_border = True
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
        scene.cycles.device = 'GPU'
        scene.cycles.use_denoising = scene.cycles.use_adaptive_sampling = False
        self.cycles = {k: getattr(scene.cycles, k) for k in ('samples', 'diffuse_bounces', 'seed')}
        layer = scene.view_layers[0]
        layer.lightgroups.add(name='fill')
        self.fill = bpy.data.objects[FILL]
        self.fill.lightgroup = 'fill'
        # Other lights and the world never reach the fill's group; hiding them only saves time.
        for o in scene.objects:
            if o.type == 'LIGHT' and o is not self.fill:
                o.hide_render = True
        self.world = scene.world
        scene.world = None

        self.water = bpy.data.objects[WATER]
        self.tiles = [o for o in scene.objects if o.name.startswith('Individual submerged tile')]
        assert len(self.tiles) == 208, len(self.tiles)
        self.others = [
            o for o in scene.objects
            if o.type not in ('LIGHT', 'CAMERA') and not o.hide_render and o is not self.water and o not in self.tiles
        ]
        self.tub = [o for o in self.others if o.name.startswith(TUB)]
        self.cut = [o for o in self.tub if o.name.startswith(CUT)]
        assert len(self.tub) == 14 and len(self.cut) == 8, [o.name for o in self.tub]
        self.walls = []
        for o in self.tub:
            if o.name.startswith(WALLS):
                assert o.data.users == 1
                self.walls += [(o, v, v.co.copy()) for v in o.data.vertices if (o.matrix_world @ v.co).z > 0.9]
        assert len(self.walls) == 16, len(self.walls)
        self.top = [v for v in self.water.data.vertices if v.co.z > 0.5]
        self.top_z = [v.co.z for v in self.top]

        wm = bpy.data.materials[WATER_MATERIAL]
        nodes, links = wm.node_tree.nodes, wm.node_tree.links
        self.water_bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
        self.water_output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
        self.volume = self.water_output.inputs['Volume'].links[0].from_node
        self.bump = self.water_bsdf.inputs['Normal'].links[0].from_node
        self.water_links = links
        self.water_defaults = {
            'Base Color': tuple(self.water_bsdf.inputs['Base Color'].default_value),
            'Roughness': self.water_bsdf.inputs['Roughness'].default_value,
        }

        tm = bpy.data.materials[TILE]
        self.tile_tree = tm.node_tree
        self.tile_material = tm
        self.emission_sampling = tm.cycles.emission_sampling
        self.tile_bsdf = next(n for n in tm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        self.tile_output = next(n for n in tm.node_tree.nodes if n.type == 'OUTPUT_MATERIAL')
        self.specular = self.tile_bsdf.inputs['Specular IOR Level'].default_value
        nodes = tm.node_tree.nodes
        self.geometry = nodes.new('ShaderNodeNewGeometry')
        self.offset = nodes.new('ShaderNodeVectorMath')
        self.offset.operation = 'ADD'
        self.offset.inputs[1].default_value = (OFFSET, OFFSET, OFFSET)
        self.emission = nodes.new('ShaderNodeEmission')
        self.emission.inputs['Strength'].default_value = 1.0
        tm.node_tree.links.new(self.offset.outputs[0], self.emission.inputs['Color'])

        view = json.loads((ref.ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
        self.position = view['position']
        d = [t - p for t, p in zip(view['target'], self.position)]
        self.yaw0 = math.atan2(-d[0], -d[2])
        data = bpy.data.cameras.new('gloss scene')
        data.sensor_fit = 'VERTICAL'
        data.angle_y = math.radians(view['fov'])
        data.clip_start, data.clip_end = 0.05, 250
        self.camera = bpy.data.objects.new('gloss scene', data)
        scene.collection.objects.link(self.camera)
        scene.camera = self.camera

    def variant(self, name):
        stage = VARIANTS.index(name)
        b = self.water_bsdf
        b.inputs['Base Color'].default_value = (1, 1, 1, 1) if stage >= 1 else self.water_defaults['Base Color']
        volume = self.water_output.inputs['Volume']
        if stage >= 1 and volume.links:
            self.water_links.remove(volume.links[0])
        if stage < 1 and not volume.links:
            self.water_links.new(self.volume.outputs[0], volume)
        b.inputs['Roughness'].default_value = 0.0 if stage >= 2 else self.water_defaults['Roughness']
        normal = b.inputs['Normal']
        if stage >= 2 and normal.links:
            self.water_links.remove(normal.links[0])
        if stage < 2 and not normal.links:
            self.water_links.new(self.bump.outputs[0], normal)
        for v, z in zip(self.top, self.top_z):
            v.co.z = LEVEL if stage >= 3 else z
        self.water.data.update()
        for o, v, co in self.walls:
            if stage >= 5:
                world = o.matrix_world @ co
                world.z = LEVEL
                v.co = o.matrix_world.inverted() @ world
            else:
                v.co = co
            o.data.update()
        self.stage = stage
        self.hide_others(False)

    def hide_others(self, mapping):
        """Hide what the variant drops; for a mapping render everything but the water and tiles."""
        for o in self.others:
            if mapping:
                o.hide_render = True
            elif self.stage >= 5:
                o.hide_render = o not in self.tub or o in self.cut
            elif self.stage >= 4:
                o.hide_render = o not in self.tub
            else:
                o.hide_render = False

    def shot(self, crop, path, names):
        heading, pitch, x0, x1, y0, y1 = crop
        render = self.scene.render
        self.camera.matrix_world = ref.camera_matrix(self.position, self.yaw0 - 0.8 * heading, ref.PITCH[pitch])
        render.border_min_x, render.border_max_x = x0 / 1280, x1 / 1280
        render.border_min_y, render.border_max_y = 1 - y1 / 800, 1 - y0 / 800
        render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        return read(path, names)

    def gloss(self, crop, out, name):
        s = self.scene.cycles
        s.samples, s.seed, s.diffuse_bounces = self.samples, 17, self.cycles['diffuse_bounces']
        layers = {}
        for spec in ('on', 'off'):
            self.tile_bsdf.inputs['Specular IOR Level'].default_value = self.specular if spec == 'on' else 0.0
            layers[spec] = self.shot(crop, out / f'{name}-{spec}.exr', ('Combined', 'Combined_fill'))
        self.tile_bsdf.inputs['Specular IOR Level'].default_value = self.specular
        return layers

    def mapping(self, crop, out, name):
        s = self.scene.cycles
        s.samples, s.seed, s.diffuse_bounces = 64, 17, 0
        links = self.tile_tree.links
        surface = self.tile_output.inputs['Surface']
        principled = surface.links[0].from_socket
        links.new(self.emission.outputs[0], surface)
        # The fill's own mirror image in the water would add to the emission.
        self.hide_others(True)
        self.fill.hide_render = True
        # As a light the emission's value would steer the light tree: each render would trace
        # other paths and the ratios to the weight render would be noise.
        self.tile_material.cycles.emission_sampling = 'NONE'
        maps = {}
        for key, socket in (('weight', None), ('position', 'Position'), ('incoming', 'Incoming')):
            for link in list(self.offset.inputs[0].links):
                links.remove(link)
            if socket:
                links.new(self.geometry.outputs[socket], self.offset.inputs[0])
                self.emission.inputs['Strength'].default_value = 1.0
            else:
                self.offset.inputs[0].default_value = (1 - OFFSET, 1 - OFFSET, 1 - OFFSET)
            maps[key] = self.shot(crop, out / f'{name}-map-{key}.exr', ('Combined',))['Combined']
        links.new(principled, surface)
        self.hide_others(False)
        self.fill.hide_render = False
        self.tile_material.cycles.emission_sampling = self.emission_sampling
        s.samples, s.diffuse_bounces = self.samples, self.cycles['diffuse_bounces']
        # The tinted water weighs each channel differently: decode per channel.
        safe = np.maximum(maps['weight'], 1e-6)
        return {
            'weight': maps['weight'].mean(-1),
            'weightRGB': maps['weight'],
            'position': maps['position'] / safe - OFFSET,
            'incoming': maps['incoming'] / safe - OFFSET,
        }

    def restore(self):
        self.variant('source')
        for o in self.scene.objects:
            if o.type == 'LIGHT':
                o.hide_render = False
        self.scene.world = self.world


def analysis(maps, light, radiance, steps):
    """The flat-slab light-side integral at every STRIDE-th mapped pixel, times its throughput."""
    h, w = maps['weight'].shape
    points = []
    for y in range(STRIDE // 2, h, STRIDE):
        for x in range(STRIDE // 2, w, STRIDE):
            weight = float(maps['weight'][y, x])
            p = gltf(maps['position'][y, x])
            v = gltf(maps['incoming'][y, x])
            if weight < 0.05 or not 0.19 < p[1] < 0.21 or np.linalg.norm(v) < 0.9 or v[1] <= 0.02:
                continue
            v = v / np.linalg.norm(v)
            p[1] = 0.202
            points.append((y, x, weight, maps['weightRGB'][y, x] * slab_integral(p, v, light, steps) * radiance))
    return points


def score(gloss, spot, points):
    """Cycles (a STRIDE² block mean, to cut the noise) over the analysis at the points, in luminance."""
    half = STRIDE // 2
    measured = np.array([gloss[y - half:y + half + 1, x - half:x + half + 1].reshape(-1, 3).mean(0) for y, x, *_ in points])
    expected = np.array([a for *_, a in points])
    in_spot = np.array([spot[y, x] for y, x, *_ in points])
    m, e = measured @ LUMINANCE, expected @ LUMINANCE
    return {
        'points': len(points),
        'spotPoints': int(in_spot.sum()),
        'cyclesOverAnalysisAll': float(m.sum() / e.sum()),
        'cyclesOverAnalysisSpot': float(m[in_spot].sum() / e[in_spot].sum()),
        'correlationAll': float(np.corrcoef(m, e)[0, 1]),
        'correlationSpot': float(np.corrcoef(m[in_spot], e[in_spot])[0, 1]),
    }


def main():
    global bpy, oiio, ref
    import bpy
    import OpenImageIO as oiio
    from mathutils import Vector
    import blender_stage_reference as ref

    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=int, default=1024)
    parser.add_argument('--steps', type=int, default=161)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.out.mkdir(parents=True, exist_ok=True)
    source = Path(bpy.data.filepath)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    scene = bpy.context.scene
    assert scene.name == 'SUI • Blue hour', scene.name
    s = Scene(scene, args.samples)
    lamp = s.fill
    light = (gltf(lamp.matrix_basis.translation), gltf(lamp.matrix_basis.to_quaternion() @ Vector((0, 0, -1))), lamp.data.size / 2)
    radiance = np.array(lamp.data.color) * lamp.data.energy / (np.pi**2 * light[2] ** 2)

    results = {}
    spot = {}
    for variant in VARIANTS:
        s.variant(variant)
        for crop in CROPS:
            view = f'{crop[0]}-{crop[1]}'
            name = f'{variant}-{view}'
            layers = s.gloss(crop, args.out, name)
            gloss = layers['on']['Combined_fill'] - layers['off']['Combined_fill']
            maps = s.mapping(crop, args.out, name)
            np.savez(args.out / f'{name}.npz', gloss=gloss, fillOn=layers['on']['Combined_fill'],
                     fillOff=layers['off']['Combined_fill'], **maps)
            if variant == 'source':
                fill = layers['on']['Combined_fill'].mean(-1)
                spot[view] = fill > np.percentile(fill, 80)
            points = analysis(maps, light, radiance, args.steps)
            np.save(args.out / f'{name}-analysis.npy', np.array([(y, x, wt, *a) for y, x, wt, a in points]))
            results[name] = {
                'spotGlossMean': (gloss[spot[view]].mean(0)).tolist(),
                'spotFillOnMean': layers['on']['Combined_fill'][spot[view]].mean(0).tolist(),
                'spotWeightMean': float(maps['weight'][spot[view]].mean()),
                **score(gloss, spot[view], points),
            }
            print('GLOSS_SCENE', name, json.dumps(results[name]), flush=True)
    s.restore()
    assert before == hashlib.sha256(source.read_bytes()).hexdigest()
    here = Path(__file__).resolve().parent
    report = {
        'blend': source.name,
        'blendSha256': before,
        'blender': bpy.app.version_string,
        'scripts': {f: hashlib.sha256((here / f).read_bytes()).hexdigest() for f in (
            'diagnose_water_gloss_scene.py', 'diagnose_water_gloss_slab.py', 'diagnose_water_floor_disk.py',
            'diagnose_water_gloss_calibration.py', 'water_gloss.py')},
        'samples': args.samples,
        'mappingSamples': 64,
        'seed': 17,
        'integrationSteps': args.steps,
        'stride': STRIDE,
        'crops': CROPS,
        'variants': VARIANTS,
        'lightRadiance': radiance.tolist(),
        'results': results,
    }
    (args.out / 'scene.json').write_text(json.dumps(report, indent=1) + '\n')


if __name__ == '__main__':
    main()
