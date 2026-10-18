"""Add static, occluded direct irradiance of the six room lights to a local bake.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1
 --python scripts/bake_room_direct.py -- <indirect-bake-dir> <output-dir>
Uses source area-light geometry and deterministic area quadrature. Never saves the blend.
"""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

src, out = map(Path, sys.argv[sys.argv.index('--') + 1:])
out.mkdir(parents=True, exist_ok=True)
source = Path(bpy.data.filepath)
digest = hashlib.sha256(source.read_bytes()).hexdigest()
header = json.loads((src / 'room-irradiance.json').read_text())
assert header['input_sha256'] == digest
binary = (src / 'room-irradiance.bin').read_bytes()
assert hashlib.sha256(binary).hexdigest() == header['bin_sha256']
old = np.frombuffer(binary, dtype='<f2').reshape(6, header['height'], header['width'], 4)
for scene in (1, 2):
    assert np.array_equal(old[:2, ..., 3], old[scene*2:scene*2+2, ..., 3])
scene = bpy.data.scenes['SUI • Daylight']
bpy.context.window.scene = scene
deps = bpy.context.evaluated_depsgraph_get()
verts, faces = [], []
for obj in scene.objects:
    if obj.type != 'MESH' or obj.hide_render or not obj.visible_shadow:
        continue
    # All six lamps and receiver planes are inside this room. Skip unrelated garden geometry.
    corners = [obj.matrix_world @ Vector(p) for p in obj.bound_box]
    if max(p.x for p in corners) < -6.4 or min(p.x for p in corners) > -.4 or max(p.y for p in corners) < .2 or min(p.y for p in corners) > 4.85:
        continue
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    first = len(verts)
    verts.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
    faces.extend([first+i for i in p.vertices] for p in mesh.polygons)
    evaluated.to_mesh_clear()
tree = BVHTree.FromPolygons(verts, faces)
names = ['Warm under-bench wash', 'Warm under-bench wash.001', 'Sauna ceiling soft amber',
         'Sauna wall wash', 'Steam soft backlight', 'V7 concealed backrest wash']
count = 256
lamps = []
for name in names:
    obj = scene.objects[name]
    light = obj.data
    assert obj.parent is None
    assert light.type == 'AREA' and light.shape in ('RECTANGLE', 'SQUARE', 'DISK')
    assert abs(light.spread - math.pi) < 1e-5, 'quadrature assumes full-hemisphere area emission'
    for other_name in ('SUI • Blue hour', 'SUI • Night'):
        matches = [o for o in bpy.data.scenes[other_name].objects if o.type == 'LIGHT'
                   and o.data.type == 'AREA' and np.allclose(list(o.location), list(obj.location), atol=1e-6)
                   and abs(o.data.energy - light.energy) < 1e-6 and np.allclose(list(o.data.color), list(light.color), atol=1e-6)]
        assert len(matches) == 1, (other_name, name, 'expected matching source area light')
        other = matches[0]
        assert abs(other.data.energy - light.energy) < 1e-6
        assert np.allclose(list(other.data.color), list(light.color), atol=1e-6)
        # Inactive, viewport-hidden scene copies can retain a zero matrix_world
        # until Cycles evaluates them. These lights are unparented; verify the
        # transform properties instead of treating that unevaluated cache as a pose.
        assert other.parent is None
        assert np.allclose(list(other.rotation_euler), list(obj.rotation_euler), atol=1e-6)
        assert np.allclose(list(other.scale), list(obj.scale), atol=1e-6)
        assert other.data.shape == light.shape
        assert abs(other.data.size - light.size) < 1e-6 and abs(other.data.size_y - light.size_y) < 1e-6
        assert abs(other.data.spread - light.spread) < 1e-6
    samples = []
    def reverse_bits(k):
        value, f = 0., .5
        while k:
            value += (k & 1) * f
            k >>= 1
            f *= .5
        return value
    for i in range(count):
        u, v = (i + .5) / count, reverse_bits(i)
        if light.shape == 'DISK':
            r, a = math.sqrt(u) * light.size / 2, 2 * math.pi * v
            x, y = r * math.cos(a), r * math.sin(a)
        else:
            x = (u - .5) * light.size
            y = (v - .5) * (light.size_y if light.shape == 'RECTANGLE' else light.size)
        samples.append(obj.matrix_world @ Vector((x, y, 0)))
    # L * area / sampleCount = P/(pi*sampleCount), for disk and rectangle alike.
    lamps.append((samples, (obj.matrix_world.to_3x3() @ Vector((0,0,-1))).normalized(),
                  np.array(light.color) * light.energy / (math.pi * count)))
result = np.zeros((8, header['height'], header['width'], 4), dtype='<f2')
result[:6] = old
for pi, plane in enumerate(header['surfaces']):
    ng = plane['normal']
    normal = Vector((ng[0], -ng[2], ng[1]))
    for j, t in enumerate(np.linspace(plane['min'][1], plane['max'][1], plane['height'])):
        for i, x in enumerate(np.linspace(plane['min'][0], plane['max'][0], plane['width'])):
            valid = float(old[pi,j,i,3])
            if not valid:
                continue
            p = Vector((x, -t, plane['level'])) if pi == 0 else Vector((x, -plane['level'], t))
            start = p + .002 * normal
            rgb = np.zeros(3)
            for samples, light_normal, energy in lamps:
                factor = 0.
                for q in samples:
                    delta = q - start
                    distance = delta.length
                    direction = delta / distance
                    cosine = normal.dot(direction) * max(0., -light_normal.dot(direction))
                    if cosine <= 0:
                        continue
                    hit = tree.ray_cast(start, direction, distance - .0005)
                    if hit[0] is None:
                        factor += cosine / (distance * distance)
                rgb += energy * factor
            result[6+pi,j,i] = [*rgb, valid]
        print('ROOM_DIRECT', plane['name'], j+1, '/', plane['height'], flush=True)
    result[6+pi,plane['height']:] = result[6+pi,plane['height']-1]
binary = result.tobytes()
assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
header.update(version=2, bin_sha256=hashlib.sha256(binary).hexdigest(), direct_samples=count,
              direct_lights=names, direct_method='source area quadrature with static opaque shadow visibility; 2mm normal offset',
              indirect_bin_sha256=hashlib.sha256((src / 'room-irradiance.bin').read_bytes()).hexdigest())
header['scripts_sha256']['bake_room_direct.py'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
(out / 'room-irradiance.bin').write_bytes(binary)
(out / 'room-irradiance.json').write_text(json.dumps(header, indent=2)+'\n')
print('ROOM_DIRECT_DONE', len(binary), flush=True)
