"""Bakes the far forest's crown impostors (src/components/3d/farForest.ts) into one atlas.

Not from the source blend: the woodland's trees there are sparse cards on bare branches, the lace the
far forest has to close. Builds dense crowns of small leaves in an empty scene, five broadleaf and three
evergreen, and renders each with Cycles from the front (orthographic) into a tile of the atlas:

  R, G  the crown's shading normal across and up (0.5 + 0.5 n), toward the camera from the rest
  B     the light of an overcast sky, brightest at the zenith (radiance ∝ cos^1.5 of the zenith
        angle), on the leaves: their self-shadowing and interreflection over the light on an open,
        upward leaf, as its square root. A uniform sky gave only each leaf's speckle, not the lobes lit on top and
        shaded beneath that make a crown read as leafy masses
  A     the coverage

The leaves' normals lean outward from their crown (as crownNormals.ts does for the woodland's cards),
so a crown shades as a leafy mass rather than a speckle of single leaves. Edges are un-premultiplied
and the colors spread into the clear texels, so the mips do not darken the outline. Deterministic.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
    --python-exit-code 1 --python scripts/bake_forest_impostors.py [-- --out <webp>] [--preview]

Writes public/models/forest-impostors.webp (lossless, by cwebp with -exact so the spread colors under
the clear texels stay; the tile layout is in farForest.ts IMPOSTOR_*).
"""
import math
import subprocess
import random
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = Path(args[args.index('--out') + 1]) if '--out' in args else ROOT / 'public/models/forest-impostors.webp'

# farForest.ts IMPOSTOR_COLUMNS, IMPOSTOR_ROWS, IMPOSTOR_KINDS: the first five tiles broadleaf.
TILE_W, TILE_H = 160, 320
COLUMNS, ROWS = 4, 2
KINDS = ['broadleaf'] * 5 + ['evergreen'] * 3
# The tile spans this many meters across (twice as many up); the tree stands on its bottom edge.
SPAN = 6.4
SAMPLES = 256
# The leaves' share of their own normal; the rest leans out from the crown and its lobe.
LEAF_OWN = 0.3
ALBEDO = 0.6
# The sky's radiance cos^p of the zenith angle: an open upward leaf receives 2π / (p + 2) of it.
SKY_POWER = 1.5
OPEN_LEAF = ALBEDO * 2 / (SKY_POWER + 2)
# Leaves per cubic meter of a broadleaf lobe (biased to its surface; about 7 m² of leaf per m³ there)
# and needle tufts per meter of an evergreen branch. Denser, even the outer leaves lay in shade.
LEAF_DENSITY = 700
NEEDLE_DENSITY = 90


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 4
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = TILE_W, TILE_H
    scene.render.resolution_percentage = 100
    scene.render.filter_size = 1.2
    # Linear and premultiplied, as rendered (a PNG would take the view transform and unpremultiply).
    scene.render.image_settings.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '32'
    world = bpy.data.worlds.new('Zenith sky')
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    direction = nodes.new('ShaderNodeTexCoord')
    split = nodes.new('ShaderNodeSeparateXYZ')
    up = nodes.new('ShaderNodeMath')
    up.operation = 'MAXIMUM'
    up.inputs[1].default_value = 0
    power = nodes.new('ShaderNodeMath')
    power.operation = 'POWER'
    power.inputs[1].default_value = SKY_POWER
    links.new(direction.outputs['Generated'], split.inputs[0])
    links.new(split.outputs['Z'], up.inputs[0])
    links.new(up.outputs[0], power.inputs[0])
    links.new(power.outputs[0], nodes['Background'].inputs['Strength'])
    nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    scene.world = world
    camera = bpy.data.cameras.new('Front')
    camera.type = 'ORTHO'
    camera.ortho_scale = 2 * SPAN
    obj = bpy.data.objects.new('Front', camera)
    # From −Y toward +Y; the tile's bottom edge at z = 0.
    obj.location = (0, -40, SPAN)
    obj.rotation_euler = (math.pi / 2, 0, 0)
    scene.collection.objects.link(obj)
    scene.camera = obj
    return scene


def leaf_quads(points):
    """Small leaves: (center, own normal, outward normal, size) → mesh with the blended normals."""
    vertices, faces, normals = [], [], []
    for center, own, outward, size in points:
        # Inside the tile: a crown cut by its edge showed a straight vertical side.
        if abs(center.x) > SPAN / 2 - 0.25 or center.z > 2 * SPAN - 0.1:
            continue
        n = (own * LEAF_OWN + outward * (1 - LEAF_OWN)).normalized()
        u = own.orthogonal().normalized()
        v = own.cross(u).normalized()
        base = len(vertices)
        # A diamond, longer than wide, counterclockwise about `own` (its face normal; the opposite
        # winding turned the face from its shading normal and Cycles drew it black).
        for du, dv in ((0, 0.7), (-0.38, 0), (0, -0.7), (0.38, 0)):
            vertices.append(center + (u * du + v * dv) * size)
            normals.append(n)
        faces.append((base, base + 1, base + 2, base + 3))
    return vertices, faces, normals


def add_mesh(name, vertices, faces, normals, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in vertices], [], faces)
    mesh.update()
    mesh.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    # The normal for the emission pass, as a color (the custom normals shade the sky pass).
    attribute = mesh.color_attributes.new('suiNormal', 'FLOAT_COLOR', 'POINT')
    for i, n in enumerate(normals):
        attribute.data[i].color = (0.5 + 0.5 * n.x, 0.5 + 0.5 * n.z, -n.y, 1)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def ellipsoid_point(rng, radii, shell):
    """A point in a unit-ball scaled by `radii`, biased to its surface (the radius' share ≥ shell)."""
    while True:
        d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1)))
        if d.length > 1e-6:
            break
    d.normalize()
    r = (shell + (1 - shell) * rng.random()) ** (1 / 3)
    return Vector((d.x * radii.x, d.y * radii.y, d.z * radii.z)) * r, d


def broadleaf(rng):
    # An egg of overlapping leafy lobes from below the understory's top to the tile's top, widest a
    # little above its middle: the far crowns stand on the ground, their foot hidden in the band.
    top = 2 * SPAN - 0.25
    bottom = rng.uniform(1.6, 2.6)
    half_width = rng.uniform(1.55, 1.9)
    half_height = (top - bottom) / 2
    center = Vector((rng.uniform(-0.1, 0.1), 0, bottom + half_height))
    lobes = []
    for k in range(rng.randint(26, 32)):
        # On the envelope's surface, more toward the front and the top.
        while True:
            d = Vector((rng.gauss(0, 1), rng.gauss(0, 1) * 0.8 - 0.3, rng.gauss(0, 1) + 0.25))
            if d.length > 1e-6:
                break
        d.normalize()
        up = d.z
        # Widest a little above the middle, narrowing to the foot.
        reach = half_width * (1.0 - 0.28 * max(0.0, -up) ** 1.5) * rng.uniform(0.62, 0.8)
        # A third fill the core, so the crown is not a hollow ring of lobes.
        if k % 3 == 0:
            reach *= 0.35
        offset = Vector((d.x * reach, d.y * reach, d.z * half_height * rng.uniform(0.6, 0.78)))
        r = rng.uniform(0.85, 1.2) * (0.8 if up < -0.4 else 1.0)
        lobes.append((center + offset, Vector((r, r * 0.9, r * 0.82))))
    span = Vector((half_width, half_width * 0.85, half_height))
    points = []
    for lobe_center, radii in lobes:
        volume = radii.x * radii.y * radii.z
        for _ in range(int(LEAF_DENSITY * volume)):
            p, d = ellipsoid_point(rng, radii, 0.3)
            p = lobe_center + p
            g = p - center
            crown_out = Vector((g.x / span.x ** 2, g.y / span.y ** 2, g.z / span.z ** 2)).normalized()
            lobe_out = Vector((d.x / radii.x, d.y / radii.y, d.z / radii.z)).normalized()
            outward = (crown_out * 0.5 + lobe_out * 0.5).normalized()
            own = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            if own.dot(outward) < 0:
                own.negate()
            points.append((p, own, outward, rng.uniform(0.16, 0.26)))
    return points


def evergreen(rng):
    # A spire of drooping tiers down to near the ground.
    height = rng.uniform(9.5, 11.5)
    top = 2 * SPAN - 0.2
    base = top - height
    reach = rng.uniform(1.6, 1.95)
    points = []
    tiers = int(height / 0.42)
    for t in range(tiers):
        f = t / (tiers - 1)  # 0 at the top
        y = top - f * height + rng.uniform(-0.1, 0.1)
        radius = reach * (0.08 + 0.92 * f ** 0.9) * rng.uniform(0.85, 1.1)
        branches = 3 + int(9 * f)
        for b in range(branches):
            a = (b + rng.random() * 0.6) / branches * 2 * math.pi
            length = radius * rng.uniform(0.7, 1.05)
            steps = max(8, int(length * NEEDLE_DENSITY))
            for s in range(steps):
                along = s / steps
                droop = 0.35 * along ** 2 * length
                core = Vector((math.cos(a) * along * length, math.sin(a) * along * length, y - droop))
                spread = 0.12 + 0.18 * along
                p = core + Vector((rng.gauss(0, spread), rng.gauss(0, spread), rng.gauss(0, spread * 0.6)))
                g = Vector((p.x, p.y, 0))
                outward = (g.normalized() if g.length > 1e-4 else Vector((0, 0, 1))) * 0.85 + Vector((0, 0, 0.45))
                own = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
                if own.dot(outward) < 0:
                    own.negate()
                points.append((p, own, outward.normalized(), rng.uniform(0.12, 0.18)))
    # The leader.
    for s in range(60):
        p = Vector((rng.gauss(0, 0.05), rng.gauss(0, 0.05), top - s / 60 * 0.9))
        points.append((p, Vector((0, -1, 0.3)).normalized(), Vector((0, -0.6, 1)).normalized(), 0.08))
    del base
    return points


def materials():
    sky = bpy.data.materials.new('Leaf sky')
    sky.use_nodes = True
    bsdf = sky.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (ALBEDO, ALBEDO, ALBEDO, 1)
    bsdf.inputs['Roughness'].default_value = 1
    normal = bpy.data.materials.new('Leaf normal')
    normal.use_nodes = True
    nodes, links = normal.node_tree.nodes, normal.node_tree.links
    nodes.remove(nodes['Principled BSDF'])
    attribute = nodes.new('ShaderNodeVertexColor')
    attribute.layer_name = 'suiNormal'
    emission = nodes.new('ShaderNodeEmission')
    links.new(attribute.outputs['Color'], emission.inputs['Color'])
    links.new(emission.outputs['Emission'], nodes['Material Output'].inputs['Surface'])
    return sky, normal


def render(path):
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(path))
    image.colorspace_settings.name = 'Non-Color'
    image.alpha_mode = 'PREMUL'
    pixels = np.empty(TILE_W * TILE_H * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    # Bottom row first in Blender; the atlas has its top row first.
    return pixels.reshape(TILE_H, TILE_W, 4)[::-1]


def spread(values, alpha, steps=24):
    """Fills the clear texels with their covered neighbors' mean, ring by ring."""
    filled = alpha > 0.02
    out = values.copy()
    for _ in range(steps):
        total = np.zeros_like(out)
        count = np.zeros(filled.shape, np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            shifted = np.roll(np.roll(out * filled[..., None], dy, 0), dx, 1)
            total += shifted
            count += np.roll(np.roll(filled.astype(np.float32), dy, 0), dx, 1)
        grow = (~filled) & (count > 0)
        out[grow] = total[grow] / count[grow][:, None]
        filled = filled | grow
    out[~filled] = (0.5, 0.5, 0.6)
    return out


def bake_tile(index, kind, work):
    scene = reset()
    rng = random.Random(0x5a17 + index * 7919)
    points = broadleaf(rng) if kind == 'broadleaf' else evergreen(rng)
    sky, normal = materials()
    vertices, faces, normals = leaf_quads(points)
    obj = add_mesh(f'Crown {index}', vertices, faces, normals, sky)
    lit = render(work / f'tile-{index}-sky.exr')
    obj.data.materials[0] = normal
    scene.world.node_tree.links.clear()
    scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    scene.cycles.samples = 16
    scene.cycles.max_bounces = 0
    shading = render(work / f'tile-{index}-normal.exr')
    alpha = shading[..., 3]
    safe = np.maximum(alpha, 1e-4)[..., None]
    # Un-premultiplied: the edge texels hold the leaves' values, not a mix with the clear background.
    normal_xy = shading[..., :2] / safe
    # Its square root: most of a crown lies in the lower tenths, where 64 steps were coarse.
    light = np.sqrt(np.clip(lit[..., :1] / safe / OPEN_LEAF, 0, 1))
    channels = spread(np.concatenate([normal_xy, light], -1), alpha)
    print(f'tile {index} {kind}: {len(points)} leaves, coverage {float((alpha > 0.5).mean()):.3f}, '
          f'sky light {float((light[alpha > 0.5] ** 2).mean()):.3f}')
    # Coarser steps for the normal (32) and the light (64): the leaves' scatter is noise to a PNG,
    # and a crown is under 160 pixels across on screen.
    channels = np.clip(channels, 0, 1)
    channels[..., :2] = np.round(channels[..., :2] * 31) / 31
    channels[..., 2] = np.round(channels[..., 2] * 63) / 63
    return np.concatenate([channels, alpha[..., None]], -1)


def main():
    work = OUT.parent / '.forest-impostors'
    work.mkdir(parents=True, exist_ok=True)
    atlas = np.zeros((ROWS * TILE_H, COLUMNS * TILE_W, 4), np.float32)
    for index, kind in enumerate(KINDS):
        row, column = divmod(index, COLUMNS)
        atlas[row * TILE_H:(row + 1) * TILE_H, column * TILE_W:(column + 1) * TILE_W] = bake_tile(index, kind, work)
    image = bpy.data.images.new('Forest impostors', COLUMNS * TILE_W, ROWS * TILE_H, alpha=True, float_buffer=False)
    image.colorspace_settings.name = 'Non-Color'
    image.alpha_mode = 'STRAIGHT'
    image.pixels.foreach_set(atlas[::-1].ravel())
    png = work / 'atlas.png'
    image.filepath_raw = str(png)
    image.file_format = 'PNG'
    image.save()
    subprocess.run(['cwebp', '-quiet', '-lossless', '-z', '9', '-exact', str(png), '-o', str(OUT)], check=True)
    if '--preview' in args:
        # The tiles lit by a sun from the upper left over a green, as farForest.ts shades them.
        n = atlas[..., :2] * 2 - 1
        nz = np.sqrt(np.clip(1 - (n ** 2).sum(-1), 0, 1))
        sun = np.array([-0.5, 0.6, 0.62])
        sun /= np.linalg.norm(sun)
        lit = (0.55 + 0.7 * np.clip(n[..., 0] * sun[0] + n[..., 1] * sun[1] + nz * sun[2], 0, 1)) * atlas[..., 2]
        rgb = np.stack([lit * 0.3, lit * 0.45, lit * 0.25], -1)
        a = atlas[..., 3:]
        sky = np.array([0.62, 0.7, 0.8])
        preview = np.concatenate([rgb * a + sky * (1 - a), np.ones_like(a)], -1)
        out = bpy.data.images.new('Preview', COLUMNS * TILE_W, ROWS * TILE_H, alpha=True)
        out.pixels.foreach_set(preview[::-1].astype(np.float32).ravel())
        out.filepath_raw = str(OUT.with_name(OUT.stem + '-preview.png'))
        out.file_format = 'PNG'
        out.save()
    for file in work.iterdir():
        file.unlink()
    work.rmdir()
    print('wrote', OUT)


if __name__ == "__main__":
    main()
