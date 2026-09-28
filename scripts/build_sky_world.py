"""Give the source worlds a sky that camera and glossy rays see, keeping what diffuse rays see.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/build_sky_world.py -- [--preview DIR [--cameras 01,07] [--percentage 25] [--samples 32]]

The source worlds ('Forest late afternoon sky' for SUI • Daylight, '.002' for SUI • Blue hour) are
a flat colour; the scenes are lit by hidden area lights (Sky softbox, Sunlit courtyard) and the
sun, so that flat world is a dim backdrop that the browser draws as a single colour. This keeps
the flat colour for every path that has had a diffuse bounce (Light Path 'Diffuse Depth' > 0, or a
volume scatter) and shows a sky on the others: a zenith-horizon gradient, a glow around a
direction (the sun by day, a point under the horizon at the sun's azimuth at blue hour), FBM
clouds on a curved plane, Voronoi stars and, on paths without any glossy bounce, the sun's disk
(the source sun lamp's angle and strength; the lamp itself stays invisible to glossy rays). The
gate keeps the lighting unchanged: a Cycles test with world MIS on and off lit a diffuse plane
by the flat colour and a rough metal by the sky alone. The sky only reads the ray direction, so
the browser evaluates the same graph (src/components/3d/sky.ts).

Two Math nodes gate the sky for the probe bake (scripts/bake_irradiance_probes.py): 'SUI sky gate'
(0: every ray sees the flat colour, as after a diffuse bounce) and 'SUI sun disk gate' (0: no
disk, as on a glossy ray). Both multiply by 1 in the saved blend.

Writes src/components/3d/sky.json (the parameters, the input and output blend hashes). With --preview it renders the named cameras of both scenes into DIR instead and saves
nothing. Otherwise it saves the source blend (keep a copy first, e.g. SUI_Retreat_v12.blend).
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
import OpenImageIO as oiio

ROOT = Path(__file__).resolve().parents[1]
WORLDS = {'day': ('SUI • Daylight', 'Forest late afternoon sky'), 'evening': ('SUI • Blue hour', 'Forest late afternoon sky.002')}
# The source's flat colours (Color x Strength of the Background nodes), kept for diffuse rays.
FLAT = {'day': [0.22 * 0.34, 0.32 * 0.34, 0.40 * 0.34], 'evening': [0.10 * 0.20, 0.17 * 0.20, 0.33 * 0.20]}
SUN = 'Late afternoon sunlight'
EVENING_GLOW_ELEVATION = math.radians(-4)
LUMA = np.array([0.2126, 0.7152, 0.0722])
# Mean upward irradiance of the courtyard probe grid (docs/3d-export/irradiance-report.json).
COURTYARD = {key: scene['grids']['courtyard']['upward_irradiance_mean'] for key, scene in
             json.loads((ROOT / 'docs/3d-export/irradiance-report.json').read_text())['scenes'].items()}

# Scene-linear radiance. Displayed colours through AgX at each scene's exposure are in comments.
SKY = {
    'day': dict(
        zenith=[0.065, 0.148, 0.507],  # #4f7cb4
        horizon=[0.54, 0.834, 1.22],  # #b4c3cf
        gradient_power=0.45,
        # Glow = sum of color * max(cos, 0)^power around the glow direction (the sun by day).
        glow=[dict(color=[2.2, 1.4, 0.55], power=24.0), dict(color=[0.35, 0.25, 0.12], power=3.0)],
        clouds=dict(scale=1.6, offset=[3.1, -7.4, 0.37], detail=6.0, roughness=0.55, lacunarity=2.1,
                    low=0.47, high=0.68, opacity=0.92, bend=0.12, horizon_fade=0.12,
                    shade=[0.32, 0.4, 0.56], lit=[3.6, 3.4, 3.0], lit_power=4.0),
        stars=dict(scale=150.0, radius=0.08, density=0.006, color=[0.0, 0.0, 0.0], power=3.0),
        disk=True,
    ),
    'evening': dict(
        zenith=[0.0062, 0.0093, 0.0285],  # #101b33
        horizon=[0.0292, 0.0461, 0.104],  # #34496c
        gradient_power=0.5,
        glow=[dict(color=[0.3, 0.1, 0.045], power=40.0), dict(color=[0.03, 0.018, 0.016], power=6.0)],
        clouds=dict(scale=1.6, offset=[3.1, -7.4, 0.37], detail=6.0, roughness=0.55, lacunarity=2.1,
                    low=0.5, high=0.72, opacity=0.85, bend=0.12, horizon_fade=0.12,
                    shade=[0.016, 0.02, 0.045], lit=[0.12, 0.08, 0.1], lit_power=3.0),
        stars=dict(scale=150.0, radius=0.08, density=0.006, color=[6.0, 6.2, 7.0], power=3.0),
        disk=False,
    ),
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def sun_lamp(scene):
    lamp = next(o for o in scene.objects if o.type == 'LIGHT' and o.data.type == 'SUN' and o.name.startswith(SUN))
    # A sun lamp shines along its local -Z; the sky direction toward the sun is +Z. In background
    # mode a non-active scene's objects read matrix_world as identity, so use the unparented basis.
    assert lamp.parent is None, lamp.name
    return lamp, [round(v, 6) for v in lamp.matrix_basis.to_3x3().col[2].normalized()]


class Graph:
    """Small helpers over a world node tree; each returns an output socket."""

    def __init__(self, tree):
        self.tree = tree
        self.x = -2400

    def node(self, kind, **props):
        n = self.tree.nodes.new(kind)
        n.location = (self.x, 0)
        self.x += 40
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def link(self, value, socket):
        if isinstance(value, bpy.types.NodeSocket):
            self.tree.links.new(value, socket)
        else:
            socket.default_value = value

    def math(self, op, a, b=0.0, clamp=False, name=None):
        n = self.node('ShaderNodeMath', operation=op, use_clamp=clamp)
        if name:
            n.name = n.label = name
        self.link(a, n.inputs[0])
        self.link(b, n.inputs[1])
        return n.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        n = self.node('ShaderNodeVectorMath', operation=op)
        self.link(a, n.inputs[0])
        if b is not None:
            self.link(b, n.inputs[1])
        if scale is not None:
            self.link(scale, n.inputs['Scale'])
        return n.outputs['Value' if op in ('DOT_PRODUCT', 'LENGTH') else 'Vector']

    def mix(self, factor, a, b):
        n = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MIX', clamp_factor=True)
        # The Mix node has a Float, Vector and Color socket of each name; use the Color ones.
        color = lambda sockets, name: next(s for s in sockets if s.name == name and s.type == 'RGBA')
        self.link(factor, n.inputs['Factor'])
        self.link(list(a) + [1.0] if not isinstance(a, bpy.types.NodeSocket) else a, color(n.inputs, 'A'))
        self.link(list(b) + [1.0] if not isinstance(b, bpy.types.NodeSocket) else b, color(n.inputs, 'B'))
        return color(n.outputs, 'Result')

    def map_range(self, value, low, high, smooth=False):
        n = self.node('ShaderNodeMapRange', data_type='FLOAT', interpolation_type='SMOOTHSTEP' if smooth else 'LINEAR', clamp=True)
        self.link(value, n.inputs['Value'])
        n.inputs['From Min'].default_value = low
        n.inputs['From Max'].default_value = high
        n.inputs['To Min'].default_value = 0.0
        n.inputs['To Max'].default_value = 1.0
        return n.outputs['Result']

    def color_times(self, color, value):
        # Vector Math Scale keeps it one node; colors pass through as vectors.
        return self.vmath('SCALE', color, scale=value)


def build(world, key, sun_dir, measure=False):
    """measure: without stars and disk, for the irradiance of the scaled part."""
    p = SKY[key]
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()
    g = Graph(tree)
    coords = g.node('ShaderNodeTexCoord')
    d = g.vmath('NORMALIZE', coords.outputs['Generated'])
    xyz = g.node('ShaderNodeSeparateXYZ')
    g.link(d, xyz.inputs[0])
    dz = xyz.outputs['Z']
    up = g.math('MAXIMUM', dz, 0.0)

    # Gradient.
    t = g.math('POWER', up, p['gradient_power'])
    sky = g.mix(t, p['horizon'], p['zenith'])

    # Glow.
    glow_dir = p['glow_direction']
    cos_glow = g.math('MAXIMUM', g.vmath('DOT_PRODUCT', d, glow_dir), 0.0)
    for lobe in p['glow']:
        sky = g.vmath('ADD', sky, g.color_times(lobe['color'], g.math('POWER', cos_glow, lobe['power'])))

    fade = g.map_range(dz, 0.0, p['clouds']['horizon_fade'])

    # Stars: Voronoi F1 cells with a point closer than `radius`, kept for `density` of the cells.
    s = p['stars']
    voronoi = g.node('ShaderNodeTexVoronoi', voronoi_dimensions='3D', feature='F1', distance='EUCLIDEAN', normalize=False)
    g.link(d, voronoi.inputs['Vector'])
    voronoi.inputs['Scale'].default_value = s['scale']
    voronoi.inputs['Detail'].default_value = 0.0
    voronoi.inputs['Randomness'].default_value = 1.0
    cell = g.node('ShaderNodeSeparateColor')
    g.link(voronoi.outputs['Color'], cell.inputs[0])
    star = g.math('LESS_THAN', voronoi.outputs['Distance'], s['radius'])
    star = g.math('MULTIPLY', star, g.math('LESS_THAN', cell.outputs['Green'], s['density']))
    star = g.math('MULTIPLY', star, g.math('POWER', cell.outputs['Red'], s['power']))
    star = g.math('MULTIPLY', star, fade)
    sky = g.vmath('ADD', sky, g.color_times([0.0] * 3 if measure else s['color'], star))

    # The sun's disk, on paths without a glossy bounce.
    light_path = g.node('ShaderNodeLightPath')
    if p['disk'] and not measure:
        cos_sun = g.vmath('DOT_PRODUCT', d, sun_dir)
        inside = g.math('GREATER_THAN', cos_sun, p['disk_cos'])
        no_gloss = g.math('LESS_THAN', light_path.outputs['Glossy Depth'], 0.5)
        disk_gate = g.math('MULTIPLY', no_gloss, 1.0, name='SUI sun disk gate')
        sky = g.vmath('ADD', sky, g.color_times(p['disk_radiance'], g.math('MULTIPLY', inside, disk_gate)))

    # Clouds on a curved plane, over the stars and the disk: q = d.xy / (max(d.z, 0) + bend).
    c = p['clouds']
    denominator = g.math('ADD', up, c['bend'])
    plane = g.node('ShaderNodeCombineXYZ')
    g.link(g.math('DIVIDE', xyz.outputs['X'], denominator), plane.inputs['X'])
    g.link(g.math('DIVIDE', xyz.outputs['Y'], denominator), plane.inputs['Y'])
    plane_vector = g.vmath('ADD', plane.outputs['Vector'], c['offset'])
    noise = g.node('ShaderNodeTexNoise', noise_dimensions='3D', noise_type='FBM', normalize=True)
    g.link(plane_vector, noise.inputs['Vector'])
    for name, value in (('Scale', c['scale']), ('Detail', c['detail']), ('Roughness', c['roughness']),
                        ('Lacunarity', c['lacunarity']), ('Distortion', 0.0)):
        noise.inputs[name].default_value = value
    cover = g.map_range(noise.outputs['Fac'], c['low'], c['high'], smooth=True)
    cover = g.math('MULTIPLY', cover, fade)
    cover = g.math('MULTIPLY', cover, c['opacity'])
    cloud = g.mix(g.math('POWER', cos_glow, c['lit_power']), c['shade'], c['lit'])
    sky = g.mix(cover, sky, cloud)

    # Gate: the sky before any diffuse bounce or volume scatter, the flat colour after.
    first = g.math('LESS_THAN', light_path.outputs['Diffuse Depth'], 0.5)
    first = g.math('MULTIPLY', first, g.math('SUBTRACT', 1.0, light_path.outputs['Is Volume Scatter Ray']))
    gate = g.math('MULTIPLY', first, 1.0, name='SUI sky gate')
    color = g.mix(gate, FLAT[key], sky)
    background = g.node('ShaderNodeBackground')
    g.link(color, background.inputs['Color'])
    background.inputs['Strength'].default_value = 1.0
    output = g.node('ShaderNodeOutputWorld')
    g.link(background.outputs['Background'], output.inputs['Surface'])


def world_panorama(world, path, width, samples):
    """Linear RGB of an equirectangular render of `world` alone: rows from +Z down, columns from -Y
    with the azimuth decreasing to the right (Cycles' layout). Needs the gates at 1."""
    scene = bpy.data.scenes.new('SUI sky panorama')
    try:
        scene.world = world
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = samples
        scene.cycles.use_denoising = False
        scene.cycles.filter_width = 0.01  # point samples at pixel centers
        scene.render.resolution_x, scene.render.resolution_y = width, width // 2
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_depth = '32'
        scene.view_settings.view_transform = 'Standard'
        camera = bpy.data.objects.new('SUI sky panorama', bpy.data.cameras.new('SUI sky panorama'))
        camera.data.type = 'PANO'
        camera.data.panorama_type = 'EQUIRECTANGULAR'
        camera.rotation_euler = (math.pi / 2, 0, -math.pi / 2)  # looks along +X, up +Z
        scene.collection.objects.link(camera)
        scene.camera = camera
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        pixels = oiio.ImageBuf(str(path)).get_pixels(oiio.FLOAT)[:, :, :3]
        bpy.data.objects.remove(camera)
        return np.asarray(pixels, dtype=np.float64)
    finally:
        bpy.data.scenes.remove(scene)


def upward_irradiance(pixels):
    height, width = pixels.shape[:2]
    theta = (np.arange(height) + 0.5) / height * math.pi  # from +Z
    weight = np.maximum(np.cos(theta), 0) * np.sin(theta) * (math.pi / height) * (2 * math.pi / width)
    return (pixels * weight[:, None, None]).sum(axis=(0, 1))


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview')
    parser.add_argument('--cameras', default='01,07')
    parser.add_argument('--percentage', type=int, default=25)
    parser.add_argument('--samples', type=int, default=32)
    args = parser.parse_args(argv)
    source = Path(bpy.data.filepath)
    before = sha256(source)

    params = {}
    for key, (scene_name, world_name) in WORLDS.items():
        scene = bpy.data.scenes[scene_name]
        world = bpy.data.worlds[world_name]
        assert scene.world == world, (scene_name, scene.world.name)
        lamp, sun_dir = sun_lamp(scene)
        p = SKY[key]
        if key == 'day':
            p['glow_direction'] = sun_dir
        else:
            azimuth = math.atan2(sun_dir[1], sun_dir[0])
            p['glow_direction'] = [round(math.cos(EVENING_GLOW_ELEVATION) * math.cos(azimuth), 6),
                                   round(math.cos(EVENING_GLOW_ELEVATION) * math.sin(azimuth), 6),
                                   round(math.sin(EVENING_GLOW_ELEVATION), 6)]
        if p['disk']:
            # Radiance of the lamp's disk: strength (W/m^2) over its solid angle.
            half = lamp.data.angle / 2
            solid = 2 * math.pi * (1 - math.cos(half))
            p['disk_cos'] = math.cos(half)
            p['disk_radiance'] = [round(lamp.data.energy * c / solid, 4) for c in lamp.data.color]
        # Scale the gradient, glow and clouds so that the sky lights an upward surface as the
        # baked courtyard probes do (their mean upward irradiance, which also holds bounce light
        # and the trees' occlusion): a sky as bright as the scene's diffuse light.
        build(world, key, sun_dir, measure=True)
        measured = upward_irradiance(world_panorama(world, Path(bpy.app.tempdir) / f'sky-{key}.exr', 256, 64))
        target = np.array(COURTYARD[key])
        scale = float(LUMA @ target / (LUMA @ measured))
        scaled = lambda c: [round(v * scale, 5) for v in c]
        p['zenith'], p['horizon'] = scaled(p['zenith']), scaled(p['horizon'])
        p['glow'] = [dict(lobe, color=scaled(lobe['color'])) for lobe in p['glow']]
        p['clouds'] = dict(p['clouds'], shade=scaled(p['clouds']['shade']), lit=scaled(p['clouds']['lit']))
        p['irradiance'] = dict(target=target.round(4).tolist(), before=measured.round(4).tolist(), scale=round(scale, 4))
        print('SKY_SCALE', key, p['irradiance'], flush=True)
        build(world, key, sun_dir)
        params[key] = dict(p, sun_direction=sun_dir, flat=FLAT[key])

    if args.preview:
        out = Path(args.preview)
        out.mkdir(parents=True, exist_ok=True)
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for key, (scene_name, _) in WORLDS.items():
            scene = bpy.data.scenes[scene_name]
            scene.render.resolution_percentage = args.percentage
            scene.render.image_settings.file_format = 'PNG'
            scene.cycles.samples = args.samples
            scene.cycles.use_denoising = True
            if any(device.type == 'METAL' for device in prefs.devices):
                for device in prefs.devices:
                    device.use = True
                scene.cycles.device = 'GPU'
            for number in args.cameras.split(','):
                scene.camera = next(o for o in scene.objects if o.type == 'CAMERA' and o.name.startswith(number))
                scene.render.filepath = str(out / f'{key}-{number}.png')
                bpy.ops.render.render(write_still=True, scene=scene.name)
        assert before == sha256(source)
        print('SKY_PREVIEW', out, flush=True)
        return

    bpy.ops.wm.save_mainfile()
    after = sha256(source)
    record = dict(
        note='Written by scripts/build_sky_world.py. Radiance is scene-linear Rec.709; directions '
             'are in Blender axes (the browser turns its glTF view direction (x, y, z) into (x, -z, y)).',
        input_sha256=before, output_sha256=after, blender=bpy.app.version_string, scenes=params,
    )
    (ROOT / 'src/components/3d/sky.json').write_text(json.dumps(record, indent=2) + '\n')
    print('SKY_WORLD', before, '->', after, flush=True)


main()
