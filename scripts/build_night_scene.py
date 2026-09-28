"""Add a moonlit night scene ('SUI • Night') to the source blend, next to Daylight and Blue hour.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/build_night_scene.py -- [--preview DIR [--cameras 01,07] [--percentage 25] [--samples 32]]

The scene is a copy of 'SUI • Blue hour' that shares its geometry, materials and cameras (the
Blue hour scene links the Daylight objects the same way) and owns copies of its lights, named
'<base name> / night' so that the probe bake (scripts/bake_irradiance_probes.py base_name) and the
browser treat them like the other scenes' lights ('<Blue hour name without its / suffix> / night'). Only the lights in NIGHT change: the sun lamp
becomes the moon (same direction, so the browser keeps one cached shadow; a 0.5 degree disk), and
the hidden sky fills dim to a moonlit blue. The accent, lantern and sauna-room lights keep their
Blue hour power. The world is a copy with the night's flat colour and the 'SUI sky gate' node the
bake expects; scripts/build_sky_world.py --keys night then builds its sky.

With --preview it renders the named cameras into DIR and saves nothing. Otherwise it saves the
source blend (keep a copy first, e.g. SUI_Retreat_v13.blend) and prints the input and output hashes.
Existing scenes are not changed: a fingerprint of every other scene is compared before saving.
"""
import argparse
import hashlib
import sys
from pathlib import Path

import bpy

SOURCE, NIGHT_SCENE, NIGHT_WORLD = 'SUI • Blue hour', 'SUI • Night', 'Night sky'
# View exposure (stops) of the night scene; Daylight 0.15, Blue hour 0.55.
EXPOSURE = 0.9
# The flat colour that diffuse rays see (build_sky_world.py FLAT['night']).
FLAT = [0.10 * 0.03, 0.17 * 0.03, 0.33 * 0.03]
# Base light name -> changed properties. The moon keeps the sun's direction.
NIGHT = {
    'Late afternoon sunlight': dict(energy=0.10, color=(0.62, 0.74, 1.0), angle=0.0093),
    'Sky softbox': dict(energy=45.0, color=(0.30, 0.42, 1.0)),
    'Sunlit courtyard': dict(energy=12.0, color=(0.55, 0.66, 1.0)),
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def base_name(name):
    name = name.split(' / ')[0]
    return name[:-4] if len(name) > 4 and name[-4] == '.' and name[-3:].isdigit() else name


def fingerprint(scene):
    """What the renders and bakes read from a scene: settings, lights, world nodes, objects."""
    lights = sorted(
        (o.name, o.data.type, round(o.data.energy, 6), tuple(round(c, 6) for c in o.data.color),
         tuple(round(v, 6) for row in o.matrix_basis for v in row), o.visible_camera, o.visible_glossy,
         o.visible_transmission, o.hide_render)
        for o in scene.objects if o.type == 'LIGHT')
    world = scene.world
    nodes = sorted(
        (n.name, n.bl_idname, tuple(repr(getattr(i, 'default_value', None)) for i in n.inputs))
        for n in world.node_tree.nodes)
    c = scene.cycles
    settings = (scene.view_settings.exposure, scene.view_settings.view_transform, scene.view_settings.look,
                c.samples, c.max_bounces, c.diffuse_bounces, c.glossy_bounces, c.transmission_bounces,
                c.sample_clamp_indirect, c.blur_glossy, scene.camera.name if scene.camera else None)
    return repr((settings, lights, world.name, nodes, len(scene.objects)))


def build():
    source = bpy.data.scenes[SOURCE]
    assert NIGHT_SCENE not in bpy.data.scenes, f'{NIGHT_SCENE} exists already'
    scene = source.copy()
    scene.name = NIGHT_SCENE
    # Nothing else uses the scene (the Blue hour one has a fake user too); saving would drop it.
    scene.use_fake_user = True
    # The copy links the same objects; give it its own lights.
    changed = set()
    for o in [o for o in scene.collection.objects if o.type == 'LIGHT']:
        light = o.copy()
        light.data = o.data.copy()
        base = base_name(o.name)
        # Keep the numbered name (four lanterns share a base name).
        light.name = light.data.name = f"{o.name.split(' / ')[0]} / night"
        for key, value in NIGHT.get(base, {}).items():
            setattr(light.data, key, value)
            changed.add(base)
        scene.collection.objects.unlink(o)
        scene.collection.objects.link(light)
    assert changed == set(NIGHT), changed
    assert all(o.type != 'LIGHT' or o.name.endswith(' / night') for o in scene.objects)
    # A flat world with the gate that the probe bake sets; build_sky_world.py replaces it.
    world = bpy.data.worlds.new(NIGHT_WORLD)
    world.use_nodes = True
    world.cycles_visibility.camera = source.world.cycles_visibility.camera
    tree = world.node_tree
    tree.nodes.clear()
    gate = tree.nodes.new('ShaderNodeMath')
    gate.operation = 'MULTIPLY'
    gate.name = gate.label = 'SUI sky gate'
    gate.inputs[0].default_value = gate.inputs[1].default_value = 1.0
    background = tree.nodes.new('ShaderNodeBackground')
    background.inputs['Color'].default_value = (*FLAT, 1.0)
    background.inputs['Strength'].default_value = 1.0
    tree.links.new(background.outputs['Background'], tree.nodes.new('ShaderNodeOutputWorld').inputs['Surface'])
    scene.world = world
    scene.view_settings.exposure = EXPOSURE
    return scene


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview')
    parser.add_argument('--cameras', default='01,07')
    parser.add_argument('--percentage', type=int, default=25)
    parser.add_argument('--samples', type=int, default=32)
    args = parser.parse_args(argv)
    path = Path(bpy.data.filepath)
    before = sha256(path)
    others = {s.name: fingerprint(s) for s in bpy.data.scenes}
    scene = build()
    assert others == {s.name: fingerprint(s) for s in bpy.data.scenes if s != scene}

    if args.preview:
        out = Path(args.preview)
        out.mkdir(parents=True, exist_ok=True)
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        scene.render.resolution_percentage = args.percentage
        scene.render.image_settings.file_format = 'PNG'
        scene.cycles.samples = args.samples
        scene.cycles.use_denoising = True
        if any(device.type == 'METAL' for device in prefs.devices):
            for device in prefs.devices:
                device.use = device.type == 'METAL'
            scene.cycles.device = 'GPU'
        for number in args.cameras.split(','):
            scene.camera = next(o for o in scene.objects if o.type == 'CAMERA' and o.name.startswith(number))
            scene.render.filepath = str(out / f'night-{number}.png')
            bpy.ops.render.render(write_still=True, scene=scene.name)
        assert before == sha256(path)
        print('NIGHT_PREVIEW', out, flush=True)
        return

    bpy.ops.wm.save_mainfile()
    print('NIGHT_SCENE', before, '->', sha256(path), flush=True)


main()
