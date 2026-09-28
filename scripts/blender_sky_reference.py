"""Run: Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/blender_sky_reference.py

Reference values of the source skies (scripts/build_sky_world.py) for e2e/sky.e2e.ts: Cycles
renders equirectangular panoramas of each scene's world alone, one sample per pixel with a tiny
pixel filter and the same seed, so every panorama sees the same ray per pixel. One panorama
writes the ray direction (Texture Coordinate Generated, normalized, as 0.5 + 0.5 d), one the
sky (camera rays: the sky and the sun's disk), and copies of the worlds write the Voronoi F1
distance and cell color and the cloud noise. Pixels are drawn at random over the sphere, plus the
ring around the sun's disk. Writes e2e/fixtures/blender-sky.json. Never saves the input blend.
"""
import bpy
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import OpenImageIO as oiio

ROOT = Path(__file__).resolve().parents[1]
SCENES = {'day': 'SUI • Daylight', 'evening': 'SUI • Blue hour', 'night': 'SUI • Night'}
WIDTH = 512
RANDOM_POINTS = 480
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
tmp = Path(bpy.app.tempdir)


def render(world, name):
    scene = bpy.data.scenes.new('SUI sky reference')
    try:
        scene.world = world
        scene.render.engine = 'CYCLES'
        scene.cycles.device = 'CPU'
        scene.cycles.samples = 1
        scene.cycles.seed = 0
        scene.cycles.use_denoising = False
        scene.cycles.filter_width = 0.01
        scene.render.resolution_x, scene.render.resolution_y = WIDTH, WIDTH // 2
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = 'OPEN_EXR'
        scene.render.image_settings.color_depth = '32'
        scene.view_settings.view_transform = 'Standard'
        camera = bpy.data.objects.new('SUI sky reference', bpy.data.cameras.new('SUI sky reference'))
        camera.data.type = 'PANO'
        camera.data.panorama_type = 'EQUIRECTANGULAR'
        camera.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
        scene.collection.objects.link(camera)
        scene.camera = camera
        scene.render.filepath = str(tmp / f'{name}.exr')
        bpy.ops.render.render(write_still=True, scene=scene.name)
        bpy.data.objects.remove(camera)
        return np.asarray(oiio.ImageBuf(scene.render.filepath).get_pixels(oiio.FLOAT)[:, :, :3], dtype=np.float64)
    finally:
        bpy.data.scenes.remove(scene)


def probe(world, pick):
    """Panorama of a copy of `world` whose background shows pick(tree) (an RGB-able socket)."""
    copy = world.copy()
    try:
        tree = copy.node_tree
        background = next(n for n in tree.nodes if n.type == 'BACKGROUND')
        tree.links.new(pick(tree), background.inputs['Color'])
        return render(copy, f'{world.name}-{pick.__name__}')
    finally:
        bpy.data.worlds.remove(copy)


def direction(tree):
    coords = tree.nodes.new('ShaderNodeTexCoord')
    normalize = tree.nodes.new('ShaderNodeVectorMath')
    normalize.operation = 'NORMALIZE'
    tree.links.new(coords.outputs['Generated'], normalize.inputs[0])
    encode = tree.nodes.new('ShaderNodeVectorMath')
    encode.operation = 'MULTIPLY_ADD'
    tree.links.new(normalize.outputs['Vector'], encode.inputs[0])
    encode.inputs[1].default_value = (0.5, 0.5, 0.5)
    encode.inputs[2].default_value = (0.5, 0.5, 0.5)
    return encode.outputs['Vector']


def voronoi(tree):
    node = next(n for n in tree.nodes if n.type == 'TEX_VORONOI')
    split = tree.nodes.new('ShaderNodeSeparateColor')
    tree.links.new(node.outputs['Color'], split.inputs[0])
    join = tree.nodes.new('ShaderNodeCombineXYZ')
    tree.links.new(node.outputs['Distance'], join.inputs[0])
    tree.links.new(split.outputs['Red'], join.inputs[1])
    tree.links.new(split.outputs['Green'], join.inputs[2])
    return join.outputs['Vector']


def noise(tree):
    return next(n for n in tree.nodes if n.type == 'TEX_NOISE').outputs['Fac']


record = dict(input_sha256=source_hash, blender=bpy.app.version_string, width=WIDTH, scenes={})
for key, scene_name in SCENES.items():
    world = bpy.data.scenes[scene_name].world
    for gate in ('SUI sky gate', 'SUI sun disk gate'):
        node = world.node_tree.nodes.get(gate)
        assert node is None and gate == 'SUI sun disk gate' or node.inputs[1].default_value == 1.0, gate
    directions = probe(world, direction) * 2 - 1
    lengths = np.linalg.norm(directions, axis=2)
    assert np.abs(lengths - 1).max() < 1e-4, 'Generated is not a unit direction'
    # Rows run from +Z down: the top row looks up.
    assert directions[0, :, 2].min() > 0.999 and directions[-1, :, 2].max() < -0.999
    sky = render(world, f'{key}-sky')
    cells = probe(world, voronoi)
    clouds = probe(world, noise)[:, :, 0]
    rng = np.random.default_rng(7)
    # Uniform over the sphere: rows by the sine of their polar angle.
    height = WIDTH // 2
    theta = (np.arange(height) + 0.5) / height * math.pi
    rows = rng.choice(height, RANDOM_POINTS, p=np.sin(theta) / np.sin(theta).sum())
    columns = rng.integers(0, WIDTH, RANDOM_POINTS)
    pixels = list(zip(rows.tolist(), columns.tolist()))
    sun = next(o for o in bpy.data.scenes[scene_name].objects if o.type == 'LIGHT' and o.data.type == 'SUN')
    assert sun.parent is None
    sun_dir = np.array(sun.matrix_basis.to_3x3().col[2].normalized())  # matrix_world is identity off the active scene
    ring = np.argwhere(np.arccos(np.clip(directions @ sun_dir, -1, 1)) < 0.07)
    pixels += [tuple(p) for p in ring.tolist()]
    pixels = sorted(set(pixels))
    at = lambda image: [image[r, c].round(7).tolist() if image.ndim == 3 else round(float(image[r, c]), 7) for r, c in pixels]
    record['scenes'][key] = dict(scene=scene_name, directions=at(directions), radiance=at(sky), voronoi=at(cells), noise=at(clouds))
    print('SKY_REFERENCE', key, len(pixels), 'points', flush=True)

out = ROOT / 'e2e/fixtures/blender-sky.json'
out.write_text(json.dumps(record) + '\n')
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
print('SKY_REFERENCE_DONE', out, source_hash, flush=True)
