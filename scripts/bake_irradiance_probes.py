"""Run: Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py [-- --quick]

Bakes the diffuse irradiance that the browser does not light directly into L2 spherical-harmonic
probe grids, for the Daylight ('day'), Blue hour ('evening') and Night ('night') scenes. At every probe Cycles
renders a small equirectangular panorama with the scene's own world, materials, bounces and
clamping; it is projected to SH in glTF axes (three's basis, see src/components/3d/irradiance.ts).

Every source light is invisible to camera rays, so a panorama holds the sky and all light
reflected by surfaces (every bounce of every light) but no direct light. The lights the browser
does not draw (Sky softbox, Sunlit courtyard, lanterns and the other area lights) are made
visible to camera rays for the bake so that their direct light is part of the probes; the sun,
V9, the six sauna-room lights and the five blue-hour accents are drawn by the browser and stay
invisible (their bounce light stays in the probes).

Probes inside closed geometry see back faces. Every material gets an AOV output of the
Geometry node's Backfacing (shading is unchanged), which the compositor writes into the alpha of
the same panorama; probes that mostly see back faces are filled from valid neighbors. (A view
layer material override made Cycles rebuild the scene for every probe.) 'V10 woodland floor
extension' faces down, so probes under it looked valid and black and seeded the fill above it:
large meshes whose area-weighted normal points down are flipped for the bake (Cycles shades both
sides alike, so the panoramas do not change), and a valid probe that sees no light fails the bake. Courtyard and outer probes inside
the sauna room are also filled from outside so that the room's light does not leak through the
walls; the room has its own grid.

The plunge water is a closed transmissive mesh, so its back faces are not an enclosure: the water
material writes no back-face AOV. The water has its own grid inside the water volume (the browser
uses it only below the surface): from there Cycles sees the courtyard through the water surface,
only with the lights that are visible to transmission rays, and the sun does not reach the tiles.
Courtyard and outer probes inside the water are filled from outside as before (their dark values
would otherwise leak onto the deck around the plunge).

The water grid's irradiance is not a panorama: light reaches the tiles only along refracted
(caustic) paths, which the source's indirect clamp (10) and Filter Glossy (1.0) change on a
surface's diffuse bounce but not on a camera ray, so a panorama saw V9 through the surface about
1.4x brighter than the tiles receive it (docs/3d-qa/water-floor-irradiance). Each water probe is a
small diffuse sphere with the tiles' albedo seen by six orthographic cameras (the water hidden
from them), fitted with L2 SH per normal. The final image sees the tiles through the water, two
bounces into the path, and Russian roulette with the clamp then cuts about another 11% of V9 than
on a camera ray that reaches the tiles first (docs/3d-qa/water-receiver-shell). So each sphere sits
in a camera-only shell (IOR 1 refraction, the tiles' 0.925 transmittance straight down through the
water) that moves it one bounce in; the sphere is visible to the transmission rays past the shell,
its irradiance is Combined / (0.925 x albedo) x pi, and its normals come from the camera geometry
(the shell takes the Normal and Position passes). The lower layer lies in the 1.3 cm air gap between the tiles and the water's
bottom face, so the floor reads the light that crossed that face (the browser samples this grid
without the normal offset). The reflection bake keeps panoramas on the same layout.

With --grids NAME[,NAME] only those grids are baked; the other grids are copied from the shipped
file, which must come from the same input blend and have the same layout. With --scenes KEY[,KEY]
only those scenes are baked and the others are copied the same way; the shipped file may also come
from the parent blend that lacks a scene added since (blend_lineage.py ADDED_SCENE), provided that
scene is baked now. With --quick nothing is copied and the output holds only the baked scenes.

Writes public/models/irradiance.bin (float16) and irradiance.json (grid layout, input hash) and
docs/3d-export/irradiance-report.json. Never saves the input blend.

With --surface-samples <JSON> --out <diagnostic-dir> it measures incident diffuse light at
supplied glTF surface positions/normals, compares full cosine integration with local L2 SH and
shipped grid interpolation, and writes only surface-sampling.json. It never writes probe assets.

With --reflection it bakes what glossy rays see instead (src/components/3d/reflection.ts), into
reflection.bin / reflection.json / reflection-report.json with the same layout: every light is
visible to the panorama camera exactly when it is visible to glossy rays in the source, except the
lights whose highlights the browser draws itself (V9 and the five blue-hour accents); the sun,
Sky softbox, Sunlit courtyard, the lanterns and the six sauna-room lights are invisible to glossy
rays in the source. The world keeps its own glossy visibility. Inside the water the panoramas see
lights by their transmission visibility instead, so the lights left out (V9, the blue-hour
accents) are hidden from transmission rays too while the water grid renders.

The worlds show a sky only on paths without a diffuse bounce (scripts/build_sky_world.py). The
irradiance panoramas stand for rays after one, so they see the flat colour everywhere ('SUI sky
gate' 0); the reflection panoramas stand for glossy rays and see the sky without the sun's disk
('SUI sun disk gate' 0).
"""
import bpy
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import OpenImageIO as oiio

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blend_lineage import ADDED_SCENE, WORLD_ONLY, same_geometry
from probe_sampling import fill_invalid  # shared with refill_enclosed_probes.py

ROOT = Path(__file__).resolve().parents[1]
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
REFLECTION = '--reflection' in ARGS
SURFACE_SAMPLES = Path(ARGS[ARGS.index('--surface-samples') + 1]) if '--surface-samples' in ARGS else None
if SURFACE_SAMPLES and ('--out' not in ARGS or any(flag in ARGS for flag in ('--reflection', '--quick', '--probe-test'))):
    raise ValueError('--surface-samples requires --out and cannot combine with other bake modes')
NAME = 'reflection' if REFLECTION else 'irradiance'
# Renders the first N courtyard probes of the Daylight scene, prints timing and exits.
PROBE_TEST = int(ARGS[ARGS.index('--probe-test') + 1]) if '--probe-test' in ARGS else 0
# --probe-grid NAME --probe-start I: which probes --probe-test renders (default courtyard from 0).
PROBE_GRID = ARGS[ARGS.index('--probe-grid') + 1] if '--probe-grid' in ARGS else 'courtyard'
PROBE_START = int(ARGS[ARGS.index('--probe-start') + 1]) if '--probe-start' in ARGS else 0
ONLY_GRIDS = ARGS[ARGS.index('--grids') + 1].split(',') if '--grids' in ARGS else None
if ONLY_GRIDS and (SURFACE_SAMPLES or PROBE_TEST or QUICK):
    raise ValueError('--grids cannot combine with other bake modes')
ONLY_SCENES = ARGS[ARGS.index('--scenes') + 1].split(',') if '--scenes' in ARGS else None
OUT = Path(sys.argv[sys.argv.index('--out') + 1]) if '--out' in sys.argv else ROOT / 'public/models'
REPORT = OUT if '--out' in sys.argv else ROOT / 'docs/3d-export'
ALL_SCENES = (('day', 'SUI • Daylight'), ('evening', 'SUI • Blue hour'), ('night', 'SUI • Night'))
assert not ONLY_SCENES or set(ONLY_SCENES) <= {key for key, _ in ALL_SCENES}, ONLY_SCENES
# The scenes rendered now, and the scenes written (copied scenes keep their shipped values).
SCENES = tuple((key, name) for key, name in ALL_SCENES if not ONLY_SCENES or key in ONLY_SCENES)
OUT_SCENES = SCENES if QUICK or SURFACE_SAMPLES or PROBE_TEST else ALL_SCENES
COPY = bool(ONLY_GRIDS) or OUT_SCENES != SCENES
WIDTH, HEIGHT, SAMPLES = (128, 64, 128) if SURFACE_SAMPLES else (64, 32, 64)
# The room's inner volume (src/components/3d/interiorLights.ts INTERIOR_BOX), glTF axes.
ROOM = ((-6.15, 0.0, -4.59), (-0.5, 3.36, -0.25))
# glTF-axis bounds of the probe positions and the target spacing in meters. The room grid is
# inset half a spacing from the walls, floor and ceiling so that no probe sits on a surface.
GRIDS = (
    ('room', (-5.9, 0.25, -4.34), (-0.75, 3.11, -0.5), 0.5),
    ('courtyard', (-9.0, 0.25, -8.0), (9.0, 4.25, 16.0), 1.0),
    ('outer', (-30.0, 0.25, -30.0), (30.0, 9.25, 30.0), 3.0),
    # The lower layer is in the air gap between the tiles (0.202) and the water's bottom (0.215).
    ('water', (0.05, 0.2085, -3.9), (2.31, 0.66, -1.1), 0.5),
)
# Water receivers: radius and camera distance fit in the air gap; the albedo is the mean DiffCol
# of the tiles in the water stage's downward view (the clamp acts on albedo x radiance).
RECEIVER_RADIUS, RECEIVER_DISTANCE, RECEIVER_RES, RECEIVER_SAMPLES = 0.004, 0.005, 32, 256
RECEIVER_ALBEDO = (0.109, 0.290, 0.254)
# The camera-only shell around each receiver: radius inside the camera distance, and the
# transmittance of the camera path through the water to the tiles straight down in Cycles (it sets
# how much the clamp cuts; the value is divided out again).
RECEIVER_SHELL_RADIUS, RECEIVER_SHELL = 0.0044, 0.925
WATER_OBJECT = 'V4 rippled spring water volume'
# The plunge water volume ('V4 rippled spring water volume'), glTF axes, and its material. The
# browser's WATER_BOX (interiorLights.ts) extends it down and out to the tiles.
WATER = ((-0.155, 0.215, -4.095), (2.515, 0.771, -0.905))
WATER_MATERIALS = {'V4 | clear spring water'}
# Lights the browser draws itself (lighting.ts, interiorLights.ts), by base name and scene.
DRAWN = {
    'Late afternoon sunlight', 'V9 lounge patch of sunlight', 'Warm under-bench wash',
    'Sauna ceiling soft amber', 'Sauna wall wash', 'Steam soft backlight', 'V7 concealed backrest wash',
}
# Drawn in the Blue hour and Night scenes (their Daylight copies are left in the probes).
DRAWN_EVENING = {
    'V10 lounge dusk fill', 'V10 path grazing light 1', 'V10 path grazing light 4',
    'V10 path grazing light 7', 'V10 specimen uplight',
}
# Drawn lights whose highlights the browser draws too (three spot lights). The sun and the six
# sauna-room lights are diffuse only in the browser, as they are invisible to glossy rays.
DRAWN_SPECULAR = {'V9 lounge patch of sunlight'}


def in_panorama(o, key):
    """Whether a light is visible to the probe camera in this bake."""
    name = base_name(o.name)
    evening = key in ('evening', 'night') and name in DRAWN_EVENING
    if REFLECTION:
        return o.visible_glossy and name not in DRAWN_SPECULAR and not evening
    return name not in DRAWN and not evening


def base_name(name):
    name = name.split(' / ')[0]
    return name[:-4] if len(name) > 4 and name[-4] == '.' and name[-3:].isdigit() else name


def grid_layout(lo, hi, spacing):
    scale = 2.0 if QUICK else 1.0
    return [max(2, round((b - a) / (spacing * scale)) + 1) for a, b in zip(lo, hi)]


def probe_positions(lo, hi, res):
    axes = [np.linspace(a, b, n) for a, b, n in zip(lo, hi, res)]
    # x fastest, then y, then z (the order of irradiance.bin).
    z, y, x = np.meshgrid(axes[2], axes[1], axes[0], indexing='ij')
    return np.stack([x.ravel(), y.ravel(), z.ravel()], axis=1)


def sh_basis(d):
    x, y, z = d[:, 0], d[:, 1], d[:, 2]
    return np.stack([
        np.full_like(x, 0.282095), 0.488603 * y, 0.488603 * z, 0.488603 * x,
        1.092548 * x * y, 1.092548 * y * z, 0.315392 * (3 * z * z - 1), 1.092548 * x * z,
        0.546274 * (x * x - y * y),
    ], axis=1)


def read_exr(path):
    # Read without an image datablock: adding and removing one per probe made Cycles discard its
    # persistent scene data (about 9 s instead of 0.3 s per probe).
    image = oiio.ImageInput.open(str(path))
    pixels = image.read_image(0, 0, 0, 4, 'float')
    image.close()
    # Bottom row first, like Blender's image pixels.
    return np.asarray(pixels, dtype=np.float64)[::-1].reshape(-1, 4)


source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
tmp = Path(bpy.app.tempdir)
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
use_gpu = any(device.type == 'METAL' for device in prefs.devices)
# GPU only: with the CPU device enabled too, the CPU share of these tiny renders dominated (4 s/probe).
for device in prefs.devices:
    device.use = device.type == 'METAL'

cam_data = bpy.data.cameras.new('SUI irradiance probe')
cam_data.type = 'PANO'
cam_data.panorama_type = 'EQUIRECTANGULAR'
camera = bpy.data.objects.new('SUI irradiance probe', cam_data)
camera.rotation_euler = (math.pi / 2, 0, 0)


AOV = 'sui_backface'


def configure(scene, samples, backface=False):
    if camera.name not in scene.collection.objects:
        scene.collection.objects.link(camera)
    scene.camera = camera
    scene.cycles.device = 'GPU' if use_gpu else 'CPU'
    scene.render.use_persistent_data = True
    scene.render.resolution_x, scene.render.resolution_y = WIDTH, HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.use_border = False
    scene.render.film_transparent = False
    scene.render.use_motion_blur = False
    scene.render.use_compositing = backface
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.use_sequencer = False
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '32'
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = False
    scene.cycles.use_denoising = False
    scene.cycles.pixel_filter_type = 'BOX'
    for layer in scene.view_layers:
        layer.use = layer == scene.view_layers[0]


def render(scene, position):
    x, y, z = position
    camera.location = (x, -z, y)
    path = tmp / 'probe.exr'
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True, scene=scene.name)
    return read_exr(path)


def render_all(scene, points, label):
    rows = []
    for i, p in enumerate(points):
        rows.append(render(scene, p))
        if i % 100 == 99:
            print('IRRADIANCE progress', label, i + 1, len(points), flush=True)
    return np.array(rows)


def receiver_sh(scene, points, shell=True):
    """L2 SH (probes, 27) of the irradiance on a diffuse receiver sphere at each point, and a
    validity mask (the six views see only the shell, or the sphere without it). Restores the
    scene's render settings."""
    material = bpy.data.materials.new('SUI irradiance receiver')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    bsdf = nodes.new('ShaderNodeBsdfDiffuse')
    bsdf.inputs['Color'].default_value = (*RECEIVER_ALBEDO, 1)
    material.node_tree.links.new(bsdf.outputs[0], nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    import bmesh
    mesh = bpy.data.meshes.new('SUI irradiance receiver')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=RECEIVER_RADIUS)
    bm.to_mesh(mesh)
    bm.free()
    mesh.shade_smooth()
    mesh.materials.append(material)
    # One sphere per probe, placed once: moving an object between renders made Cycles rebuild the
    # scene (about 12 s per render); the camera's short clip range sees only its own sphere.
    shell_material = bpy.data.materials.new('SUI irradiance receiver shell')
    shell_material.use_nodes = True
    nodes = shell_material.node_tree.nodes
    nodes.clear()
    refraction = nodes.new('ShaderNodeBsdfRefraction')
    refraction.inputs['Color'].default_value = (RECEIVER_SHELL, RECEIVER_SHELL, RECEIVER_SHELL, 1)
    refraction.inputs['IOR'].default_value = 1.0
    refraction.inputs['Roughness'].default_value = 0.0
    shell_material.node_tree.links.new(refraction.outputs[0], nodes.new('ShaderNodeOutputMaterial').inputs['Surface'])
    shell_mesh = bpy.data.meshes.new('SUI irradiance receiver shell')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=RECEIVER_SHELL_RADIUS)
    bm.to_mesh(shell_mesh)
    bm.free()
    shell_mesh.materials.append(shell_material)
    spheres = []
    for p in points:
        sphere = bpy.data.objects.new('SUI irradiance receiver', mesh)
        sphere.location = (p[0], -p[2], p[1])
        for flag in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
            setattr(sphere, flag, shell and flag == 'visible_transmission')
        scene.collection.objects.link(sphere)
        spheres.append(sphere)
        if shell:
            cover = bpy.data.objects.new('SUI irradiance receiver shell', shell_mesh)
            cover.location = sphere.location
            for flag in ('visible_diffuse', 'visible_glossy', 'visible_transmission', 'visible_volume_scatter', 'visible_shadow'):
                setattr(cover, flag, False)
            scene.collection.objects.link(cover)
            spheres.append(cover)
    ortho = bpy.data.cameras.new('SUI irradiance receiver')
    ortho.type = 'ORTHO'
    ortho.ortho_scale = 2.2 * RECEIVER_RADIUS
    ortho.clip_start, ortho.clip_end = 0.0005, 0.01
    viewer = bpy.data.objects.new('SUI irradiance receiver camera', ortho)
    scene.collection.objects.link(viewer)
    water = scene.objects[WATER_OBJECT]
    water_camera = water.visible_camera
    water.visible_camera = False
    layer = scene.view_layers[0]
    passes = ('use_pass_position',)
    saved_passes = {k: getattr(layer, k) for k in passes}
    for k in passes:
        setattr(layer, k, True)
    render_settings = scene.render
    saved = (scene.camera, render_settings.resolution_x, render_settings.resolution_y, render_settings.film_transparent,
             render_settings.use_compositing, render_settings.image_settings.file_format, scene.cycles.samples)
    scene.camera = viewer
    render_settings.resolution_x = render_settings.resolution_y = RECEIVER_RES
    render_settings.film_transparent = True
    render_settings.use_compositing = False
    render_settings.image_settings.file_format = 'OPEN_EXR_MULTILAYER'
    scene.cycles.samples = RECEIVER_SAMPLES
    from mathutils import Vector
    saved_seed = scene.cycles.seed
    bands = np.array([math.pi, *[2 * math.pi / 3] * 3, *[math.pi / 4] * 5])
    # Pixel centers in the camera plane (top row first, like the EXR) and where they hit the sphere.
    u = ((np.arange(RECEIVER_RES) + 0.5) / RECEIVER_RES - 0.5) * ortho.ortho_scale
    px_x, px_y = np.meshgrid(u, -u)
    px_x, px_y = px_x.reshape(-1), px_y.reshape(-1)
    px_z = np.sqrt(np.maximum(RECEIVER_RADIUS ** 2 - px_x ** 2 - px_y ** 2, 0))
    # Pixels facing the camera (grazing silhouette pixels mix normals).
    facing = px_z > 0.3 * RECEIVER_RADIUS
    first_radius = RECEIVER_SHELL_RADIUS if shell else RECEIVER_RADIUS
    first_z = np.sqrt(np.maximum(first_radius ** 2 - px_x ** 2 - px_y ** 2, 0))
    scale = np.array(RECEIVER_ALBEDO) * (RECEIVER_SHELL if shell else 1.0)
    rows, valid, residuals = [], [], []
    for i, p in enumerate(points):
        center = Vector((p[0], -p[2], p[1]))
        normals, values, on_sphere = [], [], []
        for axis in ((0, 0, -1), (0, 0, 1), (1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0)):
            d = Vector(axis)
            viewer.location = center - d * RECEIVER_DISTANCE
            viewer.rotation_euler = d.to_track_quat('-Z', 'Y' if abs(d.y) < 0.9 else 'Z').to_euler()
            # A new seed per render: with one seed the noise (clamped V9 paths through the surface,
            # about 10% at 64 samples) repeated at every probe and biased the whole grid. With
            # persistent data a new seed takes effect only with a new output path.
            scene.cycles.seed = len(rows) * 6 + len(normals)
            path = tmp / f'receiver-{scene.cycles.seed}.exr'
            render_settings.filepath = str(path)
            bpy.ops.render.render(write_still=True, scene=scene.name)
            image = oiio.ImageInput.open(str(path))
            spec = image.spec()
            px = np.asarray(image.read_image(0, 0, 0, spec.nchannels, 'float'), dtype=np.float64).reshape(-1, spec.nchannels)
            image.close()
            path.unlink()
            channel = {'.'.join(n.split('.')[-2:]): j for j, n in enumerate(spec.channelnames)}
            pick = lambda name, keys: px[:, [channel[f'{name}.{k}'] for k in keys]]
            # The camera's first hit must be the shell (or the sphere) at every facing pixel.
            rotation = np.array(viewer.rotation_euler.to_matrix())
            first = np.array(center) + np.stack([px_x, px_y, first_z], axis=1) @ rotation.T
            on_sphere.append(np.linalg.norm(pick('Position', 'XYZ')[facing] - first[facing], axis=1) < 2e-4)
            # The camera looks down its -Z axis: the sphere's normal toward it, in world axes.
            normals.append((np.stack([px_x, px_y, px_z], axis=1)[facing] / RECEIVER_RADIUS) @ rotation.T)
            values.append(pick('Combined', 'RGB')[facing] / scale * math.pi)
        n = np.concatenate(normals)
        n = np.stack([n[:, 0], n[:, 2], -n[:, 1]], axis=1)
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        e = np.concatenate(values)
        fit, *_ = np.linalg.lstsq(sh_basis(n), e, rcond=None)
        rows.append((fit / bands[:, None]).reshape(-1))
        valid.append(bool(np.concatenate(on_sphere).mean() > 0.99))
        residuals.append(float(np.abs(sh_basis(n) @ fit - e).mean() / max(np.abs(e).mean(), 1e-9)))
        if i % 20 == 19:
            print('IRRADIANCE receivers', i + 1, len(points), round(time.time() - started, 1), flush=True)
    (scene.camera, render_settings.resolution_x, render_settings.resolution_y, render_settings.film_transparent,
     render_settings.use_compositing, render_settings.image_settings.file_format, scene.cycles.samples) = saved
    scene.cycles.seed = saved_seed
    for k, v in saved_passes.items():
        setattr(layer, k, v)
    water.visible_camera = water_camera
    for sphere in spheres:
        bpy.data.objects.remove(sphere)
    bpy.data.objects.remove(viewer)
    bpy.data.meshes.remove(mesh)
    bpy.data.meshes.remove(shell_mesh)
    bpy.data.materials.remove(material)
    bpy.data.materials.remove(shell_material)
    bpy.data.cameras.remove(ortho)
    return np.array(rows), np.array(valid), residuals


def calibrate():
    """Per-pixel world direction (glTF axes) of the probe camera, rendered by Cycles itself."""
    scene = bpy.data.scenes.new('SUI irradiance calibration')
    world = bpy.data.worlds.new('SUI irradiance calibration')
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    nodes.clear()
    background = nodes.new('ShaderNodeBackground')
    links.new(background.outputs['Background'], nodes.new('ShaderNodeOutputWorld').inputs['Surface'])
    coords = nodes.new('ShaderNodeTexCoord')
    scale = nodes.new('ShaderNodeVectorMath')
    scale.operation = 'MULTIPLY_ADD'
    scale.inputs[1].default_value = (0.5, 0.5, 0.5)
    scale.inputs[2].default_value = (0.5, 0.5, 0.5)
    links.new(coords.outputs['Generated'], scale.inputs[0])
    links.new(scale.outputs['Vector'], background.inputs['Color'])
    scene.world = world
    scene.render.engine = 'CYCLES'
    configure(scene, 16)
    scene.view_settings.view_transform = 'Standard'
    rgb = render(scene, (0, 0, 0))[:, :3] * 2 - 1
    bpy.data.scenes.remove(scene)
    lengths = np.linalg.norm(rgb, axis=1)
    assert np.abs(lengths - 1).max() < 0.05, lengths.min()
    blender = rgb / lengths[:, None]
    # Rows run bottom to top; the top row must look up.
    assert blender[-WIDTH:, 2].mean() > 0.99 and blender[:WIDTH, 2].mean() < -0.99
    gltf = np.stack([blender[:, 0], blender[:, 2], -blender[:, 1]], axis=1)
    # Equirectangular solid angle: cos(latitude) per pixel, normalized to the sphere.
    weights = np.sqrt(np.maximum(0, 1 - blender[:, 2] ** 2))
    weights *= 4 * math.pi / weights.sum()
    return gltf, weights


def add_backface_aov():
    """Adds a Backfacing AOV to every node material; returns materials without nodes."""
    plain = []
    for material in bpy.data.materials:
        if not material.use_nodes or material.node_tree is None:
            plain.append(material.name)
            continue
        nodes, links = material.node_tree.nodes, material.node_tree.links
        aov = nodes.new('ShaderNodeOutputAOV')
        aov.aov_name = AOV
        if material.name in WATER_MATERIALS:
            aov.inputs['Value'].default_value = 0.0
        else:
            links.new(nodes.new('ShaderNodeNewGeometry').outputs['Backfacing'], aov.inputs['Value'])
    return plain


def flip_downward_meshes(scene):
    """Flips large meshes (terrain) whose area-weighted world normal points down."""
    flipped = []
    for o in scene.objects:
        if o.type != 'MESH' or o.hide_render or o.data.users > 1 or len(o.data.polygons) == 0:
            continue
        mesh = o.data
        normals = np.empty(len(mesh.polygons) * 3)
        areas = np.empty(len(mesh.polygons))
        mesh.polygons.foreach_get('normal', normals)
        mesh.polygons.foreach_get('area', areas)
        world = normals.reshape(-1, 3) @ np.array(o.matrix_world.to_3x3().inverted().transposed()).T
        world /= np.linalg.norm(world, axis=1, keepdims=True) + 1e-12
        scale = o.matrix_world.to_scale()
        if areas.sum() * abs(scale.x * scale.y) > 100 and (world[:, 2] * areas).sum() / areas.sum() < -0.5:
            mesh.flip_normals()
            flipped.append(o.name)
    return flipped


def composite_backface(scene):
    """Combined RGB with the back-face AOV as alpha."""
    layer = scene.view_layers[0]
    if AOV not in layer.aovs:
        aov = layer.aovs.add()
        aov.name = AOV
        aov.type = 'VALUE'
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    layers = tree.nodes.new('CompositorNodeRLayers')
    layers.scene = scene
    layers.layer = layer.name
    alpha = tree.nodes.new('CompositorNodeSetAlpha')
    alpha.mode = 'REPLACE_ALPHA'
    tree.links.new(layers.outputs['Image'], alpha.inputs['Image'])
    tree.links.new(layers.outputs[AOV], alpha.inputs['Alpha'])
    tree.links.new(alpha.outputs['Image'], tree.nodes.new('CompositorNodeComposite').inputs['Image'])


def inside(points, box):
    lo, hi = np.array(box[0]), np.array(box[1])
    return np.all((points > lo) & (points < hi), axis=1)


def diagnose_surfaces(scene, key, fixture, sampler):
    # Full cosine integration separates SH truncation from spatial interpolation. Compare two
    # small surface offsets to reveal near-surface sensitivity instead of assuming one is exact.
    rows = []
    from probe_sampling import evaluate
    for sample in fixture['samples']:
        p, n = np.array(sample['position']), np.array(sample['normal'])
        if p.shape != (3,) or n.shape != (3,) or not np.isfinite([p, n]).all() or abs(np.linalg.norm(n) - 1) > 1e-4:
            raise ValueError('surface sample needs a finite position and unit normal')
        measured = []
        for distance in (0.02, 0.05):
            rgba = render(scene, p + distance * n)
            sh = np.einsum('pk,pc->kc', basis, rgba[:, :3])
            cosine = np.maximum(directions @ n, 0) * weights
            measured.append(dict(offset_m=distance,
                cosine_rgb=(cosine @ rgba[:, :3]).tolist(), sh_rgb=evaluate(sh, n).tolist(),
                backface_sphere=float(rgba[:, 3] @ weights / (4 * math.pi)),
                backface_cosine=float(cosine @ rgba[:, 3] / cosine.sum())))
        rows.append(dict(**sample, measured=measured,
                         grid_half_spacing_rgb=sampler.sample(key, p, n, .5).tolist(),
                         grid_no_offset_rgb=sampler.sample(key, p, n, 0).tolist()))
    return rows


started = time.time()
directions, weights = calibrate()
basis = sh_basis(directions) * weights[:, None]
grids = []
for name, lo, hi, spacing in GRIDS:
    res = grid_layout(lo, hi, spacing)
    grids.append(dict(name=name, min=list(lo), max=list(hi), resolution=res, points=probe_positions(lo, hi, res)))

plain_materials = add_backface_aov()
flipped_meshes = flip_downward_meshes(bpy.data.scenes[SCENES[0][1]])
print('IRRADIANCE flipped', flipped_meshes, flush=True)


def set_sky_gates(world, sky, disk):
    """Sets the gates of scripts/build_sky_world.py and returns the old values. The panoramas
    stand for rays leaving a surface: after a diffuse bounce every ray sees the flat colour
    (irradiance: sky 0), and a glossy ray sees the sky without the sun's disk (reflection)."""
    old = {}
    for name, value in (('SUI sky gate', sky), ('SUI sun disk gate', disk)):
        node = world.node_tree.nodes.get(name)
        assert node or name == 'SUI sun disk gate', f'{world.name} has no {name}; run scripts/build_sky_world.py'
        if node:
            old[name] = node.inputs[1].default_value
            node.inputs[1].default_value = float(value)
    return old


def restore_sky_gates(world, old):
    for name, value in old.items():
        world.node_tree.nodes[name].inputs[1].default_value = value

report = dict(mode=NAME, plain_materials=plain_materials, flipped_meshes=flipped_meshes, input=source.name, input_sha256=source_hash, blender=bpy.app.version_string,
              panorama=[WIDTH, HEIGHT], samples=SAMPLES, quick=QUICK, grids=[], scenes={})
coefficients = {}
if SURFACE_SAMPLES:
    from probe_sampling import ProbeSampler
    sampler = ProbeSampler(ROOT / 'public/models')
    fixture = json.loads(SURFACE_SAMPLES.read_text())
    if fixture['input_sha256'] != source_hash or sampler.header['input_sha256'] != source_hash:
        raise ValueError('surface samples and shipped probes must match the input blend')
    report['probe_bin_sha256'] = hashlib.sha256((ROOT / 'public/models/irradiance.bin').read_bytes()).hexdigest()
    report['surface_samples_sha256'] = hashlib.sha256(SURFACE_SAMPLES.read_bytes()).hexdigest()
for key, scene_name in SCENES:
    scene = bpy.data.scenes[scene_name]
    visible = {o.name: o.visible_camera for o in scene.objects if o.type == 'LIGHT'}
    shown = []
    for o in scene.objects:
        if o.type != 'LIGHT' or o.hide_render:
            continue
        o.visible_camera = in_panorama(o, key)
        if o.visible_camera:
            shown.append(o.name)
    world_camera = scene.world.cycles_visibility.camera
    gates = set_sky_gates(scene.world, sky=REFLECTION, disk=False)
    if REFLECTION:
        scene.world.cycles_visibility.camera = scene.world.cycles_visibility.glossy
    configure(scene, SAMPLES, backface=True)
    composite_backface(scene)
    if SURFACE_SAMPLES:
        report['scenes'][key] = dict(scene=scene_name, lights_in_probes=sorted(shown),
                                    samples=diagnose_surfaces(scene, key, fixture, sampler))
        for o in scene.objects:
            if o.name in visible:
                o.visible_camera = visible[o.name]
        scene.world.cycles_visibility.camera = world_camera
        restore_sky_gates(scene.world, gates)
        continue
    if PROBE_TEST:
        t = time.time()
        points = next(g for g in grids if g['name'] == PROBE_GRID)['points'][PROBE_START:PROBE_START + PROBE_TEST]
        if PROBE_GRID == 'water' and not REFLECTION:
            # Receivers with and without the shell, and the upward irradiance of each.
            up = lambda sh: 0.886227 * sh[:, 0:3] + 1.023328 * sh[:, 3:6] - 0.247708 * sh[:, 18:21] - 0.429043 * sh[:, 24:27]
            bare, bare_valid, _ = receiver_sh(scene, points, shell=False)
            covered, covered_valid, _ = receiver_sh(scene, points)
            print('IRRADIANCE test seconds per probe', (time.time() - t) / PROBE_TEST, flush=True)
            for p, a, b, va, vb in zip(points, up(bare), up(covered), bare_valid, covered_valid):
                print('IRRADIANCE test', p, 'valid', va, vb, 'up bare', np.round(a, 4), 'shell', np.round(b, 4), 'ratio', np.round(b / a, 3), flush=True)
            sys.exit(0)
        rgba = render_all(scene, points, 'test')
        print('IRRADIANCE test seconds per probe', (time.time() - t) / PROBE_TEST, flush=True)
        for p, row in zip(points, rgba):
            e = np.einsum('pk,pc->kc', basis, row[:, :3])
            print('IRRADIANCE test', p, 'backface', round(float(row[:, 3] @ weights / (4 * math.pi)), 3),
                  'up', np.round(0.886227 * e[0] + 1.023328 * e[1] - 0.247708 * e[6] - 0.429043 * e[8], 3), flush=True)
        sys.exit(0)
    scene_report = dict(scene=scene_name, lights_in_probes=sorted(shown), world_in_probes=scene.world.cycles_visibility.camera, grids={})
    for grid in grids:
        if ONLY_GRIDS and grid['name'] not in ONLY_GRIDS:
            continue
        t = time.time()
        if grid['name'] == 'water' and not REFLECTION:
            sh, valid, residuals = receiver_sh(scene, grid['points'])
            dark = valid & (np.abs(sh).sum(axis=1) < 1e-3)
            assert not dark.any(), f'{key} water: {int(dark.sum())} receivers see no light'
            filled, rounds = fill_invalid(sh, valid, grid['resolution'])
            coefficients[(key, grid['name'])] = filled
            e_up = 0.886227 * filled[:, 0:3] + 1.023328 * filled[:, 3:6] - 0.247708 * filled[:, 18:21] - 0.429043 * filled[:, 24:27]
            scene_report['grids'][grid['name']] = dict(
                probes=len(grid['points']), invalid=int((~valid).sum()), fill_rounds=rounds, method='receiver',
                receiver=dict(radius=RECEIVER_RADIUS, albedo=RECEIVER_ALBEDO, resolution=RECEIVER_RES, samples=RECEIVER_SAMPLES,
                              shell=dict(radius=RECEIVER_SHELL_RADIUS, transmittance=RECEIVER_SHELL),
                              fit_residual_median=round(float(np.median(residuals)), 3), fit_residual_max=round(float(max(residuals)), 3)),
                seconds=round(time.time() - t, 1),
                upward_irradiance_mean=np.round(e_up.mean(axis=0), 4).tolist(),
            )
            print('IRRADIANCE', key, grid['name'], scene_report['grids'][grid['name']], flush=True)
            continue
        # Inside the water the panorama sees the lights through the surface by their transmission
        # visibility, so the lights left out of the reflection (V9, the blue-hour accents) came in
        # there and L2 spread their disks over every direction (docs/3d-qa/water-floor-gloss).
        hidden = [o for o in scene.objects if REFLECTION and grid['name'] == 'water' and o.type == 'LIGHT'
                  and not o.hide_render and o.visible_transmission and not in_panorama(o, key)]
        for o in hidden:
            o.visible_transmission = False
        rgba = render_all(scene, grid['points'], f'{key} {grid["name"]}')
        for o in hidden:
            o.visible_transmission = True
        # (probes, 9 coefficients, RGB) flattened to 27 per probe.
        sh = np.einsum('pk,npc->nkc', basis, rgba[:, :, :3]).reshape(len(grid['points']), -1)
        # Valid: mostly front faces; courtyard/outer probes in the room or the water are filled
        # from outside.
        backface = rgba[:, :, 3] @ weights / (4 * math.pi)
        valid = backface < 0.25
        if grid['name'] not in ('room', 'water'):
            valid &= ~inside(grid['points'], ROOM) & ~inside(grid['points'], WATER)
        assert grid['name'] != 'water' or valid.all(), f'{key} water: probes inside other geometry'
        # Every probe outside geometry sees the sky or a lit surface.
        dark = valid & (np.abs(sh).sum(axis=1) < 1e-3)
        assert not dark.any(), f'{key} {grid["name"]}: {int(dark.sum())} valid probes see no light'
        filled, rounds = fill_invalid(sh, valid, grid['resolution'])
        coefficients[(key, grid['name'])] = filled
        # Irradiance on an upward-facing surface (normal +Y).
        e_up = 0.886227 * filled[:, 0:3] + 1.023328 * filled[:, 3:6] - 0.247708 * filled[:, 18:21] - 0.429043 * filled[:, 24:27]
        scene_report['grids'][grid['name']] = dict(
            probes=len(grid['points']), invalid=int((~valid).sum()), fill_rounds=rounds,
            backface_share_max_valid=round(float(backface[valid].max()), 3),
            **(dict(hidden_from_transmission=sorted(o.name for o in hidden)) if hidden else {}),
            seconds=round(time.time() - t, 1),
            upward_irradiance_mean=np.round(e_up.mean(axis=0), 4).tolist(),
        )
        print('IRRADIANCE', key, grid['name'], scene_report['grids'][grid['name']], flush=True)
    for o in scene.objects:
        if o.name in visible:
            o.visible_camera = visible[o.name]
    scene.world.cycles_visibility.camera = world_camera
    restore_sky_gates(scene.world, gates)
    scene_report['sky_gates'] = dict(sky=int(REFLECTION), disk=0)
    report['scenes'][key] = scene_report

if SURFACE_SAMPLES:
    OUT.mkdir(parents=True, exist_ok=True)
    report['seconds'] = round(time.time() - started, 1)
    (OUT / 'surface-sampling.json').write_text(json.dumps(report, indent=2) + '\n')
    assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
    print('SURFACE_SAMPLING_DONE', report['seconds'], flush=True)
    sys.exit(0)

OUT.mkdir(parents=True, exist_ok=True)
REPORT.mkdir(parents=True, exist_ok=True)
if COPY:
    # Copy the grids and scenes that were not baked from the shipped file of the same input and layout.
    shipped = ROOT / 'public/models'
    old = json.loads((shipped / f'{NAME}.json').read_text())
    old_data = np.frombuffer((shipped / f'{NAME}.bin').read_bytes(), dtype='<f2')
    baked = {key for key, _ in SCENES}
    copied_scenes = [key for key, _ in OUT_SCENES if key not in baked]
    # A parent that differs only in the water's shading flags (blend_lineage.py) keeps the dry grids
    # valid; one that differs only in the sky keeps every irradiance grid (diffuse bounces see the
    # parent's flat colour, build_sky_world.py) but no reflection grid; one that lacks a scene added
    # since keeps every grid of its other scenes (they are unchanged), and the new scene is baked now.
    added = ADDED_SCENE.get(source_hash)
    assert old['input_sha256'] == source_hash or (
        ONLY_GRIDS and 'water' in ONLY_GRIDS and same_geometry(old['input_sha256'], source_hash)
    ) or (not REFLECTION and WORLD_ONLY.get(source_hash) == old['input_sha256']) or (
        added and added[0] == old['input_sha256'] and added[1] in baked
    ), 'shipped probes come from another input blend'
    assert hashlib.sha256(old_data.tobytes()).hexdigest() == old['bin_sha256']
    old_report = json.loads((ROOT / f'docs/3d-export/{NAME}-report.json').read_text())
    for key in copied_scenes:
        report['scenes'][key] = dict(old_report['scenes'][key], grids={})
    for grid in grids:
        entry = next(g for g in old['grids'] if g['name'] == grid['name'])
        assert [entry[k] for k in ('min', 'max', 'resolution')] == [list(grid[k]) for k in ('min', 'max', 'resolution')]
        count = int(np.prod(grid['resolution'])) * 27
        for key, _ in OUT_SCENES:
            if key in baked and (not ONLY_GRIDS or grid['name'] in ONLY_GRIDS):
                continue
            start = entry['offset'][key]
            coefficients[(key, grid['name'])] = old_data[start:start + count].astype(np.float64).reshape(-1, 27)
            report['scenes'][key]['grids'][grid['name']] = old_report['scenes'][key]['grids'][grid['name']]
    for key, _ in OUT_SCENES:
        report['scenes'][key]['grids'] = {g['name']: report['scenes'][key]['grids'][g['name']] for g in grids}
    report['scenes'] = {key: report['scenes'][key] for key, _ in OUT_SCENES}
    report['copied_grids'] = dict(input_sha256=old['input_sha256'], bin_sha256=old['bin_sha256'], seconds=old_report['seconds'],
                                  grids=[g['name'] for g in grids if not ONLY_GRIDS or g['name'] not in ONLY_GRIDS],
                                  scenes=copied_scenes or [key for key, _ in OUT_SCENES])
# Grid by grid, scene by scene, probe (x fastest, then y, then z), 9 RGB coefficients.
chunks = []
layout = []
offset = 0
for grid in grids:
    entry = dict(name=grid['name'], min=grid['min'], max=grid['max'], resolution=grid['resolution'], offset={})
    for key, _ in OUT_SCENES:
        data = coefficients[(key, grid['name'])].reshape(-1, 9, 3).astype(np.float16)
        assert np.isfinite(data).all()
        entry['offset'][key] = offset
        offset += data.size
        chunks.append(data.ravel())
    layout.append(entry)
binary = np.concatenate(chunks).astype('<f2').tobytes()
(OUT / f'{NAME}.bin').write_bytes(binary)
header = dict(
    input_sha256=source_hash, format='float16 little-endian; per grid and scene, probes x-fastest then y then z, 9 SH L2 coefficients x RGB (three basis, glTF axes, linear radiance)',
    scenes=[key for key, _ in OUT_SCENES], grids=layout, bin_sha256=hashlib.sha256(binary).hexdigest(),
)
(OUT / f'{NAME}.json').write_text(json.dumps(header, indent=2) + '\n')
report['grids'] = [{k: v for k, v in g.items() if k != 'points'} for g in grids]
report['bin_bytes'] = len(binary)
report['bin_sha256'] = header['bin_sha256']
report['seconds'] = round(time.time() - started, 1)
(REPORT / f'{NAME}-report.json').write_text(json.dumps(report, indent=2) + '\n')
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
print('IRRADIANCE_DONE', report['seconds'], len(binary), source_hash, flush=True)
