"""Locate deck-light receivers without modifying the input blend."""
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

source = Path(bpy.data.filepath)
digest = hashlib.sha256(source.read_bytes()).hexdigest()
scene = bpy.context.scene
deps = bpy.context.evaluated_depsgraph_get()
materials = {'V2 | mineral charcoal stone', 'V2 | pale mineral paving',
             'V9 | layered living moss', 'V3 | moss and woodland earth'}
receivers = []
for obj in scene.objects:
    if obj.type != 'MESH' or obj.hide_render or not any(m and m.name in materials for m in obj.data.materials):
        continue
    evaluated = obj.evaluated_get(deps)
    mesh = evaluated.to_mesh()
    vertices = [evaluated.matrix_world @ v.co for v in mesh.vertices]
    tree = BVHTree.FromPolygons(vertices, [list(p.vertices) for p in mesh.polygons])
    receivers.append((obj.name, tree))
    evaluated.to_mesh_clear()
samples = []
for x in (-4.4, 0, 4.4):
    for z in (3.9, 4.2, 4.5, 4.8, 5.2):
        hits = []
        for name, tree in receivers:
            p, n, _, distance = tree.ray_cast(Vector((x, -z, 1)), Vector((0, 0, -1)), 3)
            if p is not None:
                hits.append((distance, name, p, n))
        if not hits:
            continue
        _, name, p, n = min(hits, key=lambda h: h[0])
        if n.z < 0:
            n = -n
        samples.append(dict(name=name, position=[p.x, p.z, -p.y], normal=[n.x, n.z, -n.y]))
lights = []
for obj in scene.objects:
    if obj.type == 'LIGHT' and obj.name.startswith('V10 concealed deck edge'):
        evaluated = obj.evaluated_get(deps)
        lights.append(dict(name=obj.name, position=list(evaluated.matrix_world.translation),
                           direction=list(evaluated.matrix_world.to_3x3() @ Vector((0, 0, -1))),
                           power=obj.data.energy, size=obj.data.size))
assert digest == hashlib.sha256(source.read_bytes()).hexdigest()
Path(sys.argv[sys.argv.index('--') + 1]).write_text(json.dumps(dict(input_sha256=digest, samples=samples, lights=lights), indent=2)+'\n')
