"""Measure how much of a light's highlight on the plunge floor survives the source's clamp.

Blender -b blender/scene/SUI_Retreat.blend [-S "SUI • Blue hour"] --python-exit-code 1
--python scripts/diagnose_water_floor_highlight.py -- --out DIR
[--light "V9 lounge patch of sunlight"] [--samples 512]

An orthographic camera looks at the tub along the light's mirror direction over the tub's
middle (raised to 53 degrees above the horizon when the light is low), the pool tile's base
color is black and the scene is split into two light groups (the light, and the mesh
emission). The tile's glossy highlight of the light is the light group's Combined with the
tile's Specular IOR Level 0.5 minus 0; the light is kept from glossy rays through the water
(the path over the floor leaves the water as a transmission ray) so that the water surface's
own mirror image does not drown the difference. The highlight seen through the water at the
source's indirect clamp, at 30 and 100, without the clamp and without Russian roulette is
divided by the one on the floor with the water removed (unclamped direct light); the mesh
emission's ratio is the view's transmittance. The ratios feed WET_SAMPLE_WEIGHT in
src/components/3d/waterBottom.ts. The source blend is not saved.
"""
import argparse
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
import numpy as np
import OpenImageIO as oiio

# Blender axes: the tub (x, y) range and the water surface height.
TUB = ((-0.2, 2.56), (0.86, 4.12))
SURFACE = 0.765
CENTRE = Vector((1.18, 2.5, 0.2))
TILE = 'V10 | submerged light / Teal glazed pool tile'
WATER = 'V4 rippled spring water volume'
LUMA = np.array([0.2126, 0.7152, 0.0722])
VARIANTS = {'through water': {}, 'clamp 30': {'clamp': 30.0}, 'clamp 100': {'clamp': 100.0},
            'no clamp': {'clamp': 0.0}, 'no Russian roulette': {'rr': False}, 'dry': {'dry': True}}


def parse():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--light', default='V9 lounge patch of sunlight')
    parser.add_argument('--samples', type=int, default=512)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])


def camera(scene, lamp):
    # In background mode a non-active scene's lights read matrix_world as identity.
    view = lamp.matrix_basis.translation - CENTRE
    view = Vector((-view.x, -view.y, view.z)).normalized()
    if view.z < 0.8:
        flat = Vector((view.x, view.y, 0)).normalized() * 0.6
        view = Vector((flat.x, flat.y, 0.8))
    data = bpy.data.cameras.new('sui ortho')
    data.type, data.ortho_scale = 'ORTHO', 4.5
    cam = bpy.data.objects.new('sui ortho', data)
    scene.collection.objects.link(cam)
    cam.location = CENTRE + view * 8
    cam.rotation_euler = (-view).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    return view


def render(scene, path):
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = oiio.ImageBuf(str(path))
    spec = image.spec()
    pixels = image.get_pixels(oiio.FLOAT).reshape(spec.height, spec.width, -1)
    channel = lambda name, c='RGB': pixels[..., [spec.channelnames.index(f'ViewLayer.{name}.{x}') for x in c]]
    return channel('Combined_lamp') @ LUMA, channel('Combined_emis') @ LUMA, channel('Position', 'XYZ')


def main():
    args = parse()
    args.out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == 'METAL'
    cycles = scene.cycles
    cycles.device, cycles.samples = 'GPU', args.samples
    cycles.use_denoising = cycles.use_adaptive_sampling = False
    cycles.pixel_filter_type = 'BOX'
    layer = scene.view_layers[0]
    layer.use_pass_position = True
    for name in ('lamp', 'emis'):
        if name not in layer.lightgroups:
            layer.lightgroups.add(name=name)
    lamp = bpy.data.objects[args.light]
    for obj in scene.objects:
        if obj.type == 'MESH':
            obj.lightgroup = 'emis'
        elif obj.type == 'LIGHT':
            obj.lightgroup = 'lamp' if obj == lamp else ''
    scene.world.lightgroup = ''
    view = camera(scene, lamp)
    scene.render.resolution_x = scene.render.resolution_y = 320
    scene.render.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    scene.render.image_settings.color_depth = '32'
    bsdf = next(n for n in bpy.data.materials[TILE].node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    water = bpy.data.objects[WATER]
    clamp = cycles.sample_clamp_indirect
    sums = {}
    for index, (name, variant) in enumerate(VARIANTS.items()):
        dry = variant.get('dry', False)
        water.hide_render = dry
        lamp.visible_glossy = dry
        cycles.sample_clamp_indirect = variant.get('clamp', clamp)
        cycles.min_light_bounces = 0 if variant.get('rr', True) else 64
        result = {}
        for level in (0.5, 0.0):
            bsdf.inputs['Specular IOR Level'].default_value = level
            cycles.seed = 17 * index + (level > 0)
            result[level] = render(scene, args.out / f'{index}-{level}.exr')
        lit, emission, position = result[0.5]
        (x0, x1), (y0, y1) = TUB
        inside = (position[..., 0] > x0) & (position[..., 0] < x1) & (position[..., 1] > y0) & (position[..., 1] < y1)
        # Through the water the first hit is the surface; without it, the underwater surfaces.
        mask = inside & (position[..., 2] < SURFACE - 0.015 if dry else np.abs(position[..., 2] - SURFACE) < 0.04)
        sums[name] = {'highlight': float((lit - result[0.0][0])[mask].sum()), 'emission': float(emission[mask].sum()),
                      'pixels': int(mask.sum())}
        print('SUM', name, sums[name], flush=True)
    dry = sums['dry']
    summary = {
        'light': args.light, 'scene': scene.name, 'view': list(view), 'samples': args.samples,
        'source_clamp_indirect': clamp, 'sums': sums,
        'highlight_over_dry': {k: v['highlight'] / dry['highlight'] for k, v in sums.items() if k != 'dry'},
        'view_transmittance_emission': sums['through water']['emission'] / dry['emission'],
    }
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=1))
    print('RESULT', json.dumps(summary['highlight_over_dry']), summary['view_transmittance_emission'])


main()
