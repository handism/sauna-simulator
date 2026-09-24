"""Run with Blender -b blender/scene/SUI_Retreat.blend --python scripts/blender_caustic_reference.py.
Evaluates the emission strength of the plunge's "V10 | submerged light" materials (the source's
fake caustics) with Geometry Nodes, which share the shader-node implementation used by Cycles:
the material's own nodes are copied into a node tree, with the Geometry position as input.
Writes e2e/fixtures/blender-caustic.json for src/components/3d/caustics.ts. The blend is not saved.
"""
import bpy
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {'OUTPUT_MATERIAL', 'BSDF_PRINCIPLED'}
BASE = {p.identifier for p in bpy.types.Node.bl_rna.properties}


def strength_tree(material):
    source = material.node_tree
    bsdf = next(n for n in source.nodes if n.type == 'BSDF_PRINCIPLED')
    target = bsdf.inputs['Emission Strength'].links[0].from_socket
    tree = bpy.data.node_groups.new('caustic ' + material.name, 'GeometryNodeTree')
    tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    # Only the nodes upstream of the emission strength.
    upstream, stack = set(), [target.node]
    while stack:
        node = stack.pop()
        if node.name not in upstream:
            upstream.add(node.name)
            stack += [link.from_node for socket in node.inputs for link in socket.links]
    copies = {}
    for node in source.nodes:
        if node.type in SKIP or node.name not in upstream:
            continue
        if node.type == 'NEW_GEOMETRY':
            copies[node.name] = tree.nodes.new('GeometryNodeInputPosition')
            continue
        copy = tree.nodes.new(node.bl_idname)
        for prop in node.bl_rna.properties:
            if prop.identifier not in BASE and not prop.is_readonly:
                setattr(copy, prop.identifier, getattr(node, prop.identifier))
        for a, b in zip(node.inputs, copy.inputs):
            if hasattr(a, 'default_value'):
                b.default_value = a.default_value
        copies[node.name] = copy
    for link in source.links:
        if link.from_node.name not in copies or link.to_node.name not in copies:
            continue
        output = 'Position' if link.from_node.type == 'NEW_GEOMETRY' else link.from_socket.identifier
        assert link.from_node.type != 'NEW_GEOMETRY' or link.from_socket.name == 'Position'
        tree.links.new(copies[link.from_node.name].outputs[output],
                       copies[link.to_node.name].inputs[list(link.to_node.inputs).index(link.to_socket)])
    # The strength and, to locate a mismatch, each texture's scalar output.
    outputs = [('strength', copies[target.node.name].outputs[target.identifier])]
    for node in source.nodes:
        if node.name in copies and node.type in ('TEX_NOISE', 'TEX_VORONOI'):
            outputs.append((f"{node.type.lower()}_{node.inputs['Scale'].default_value:g}", copies[node.name].outputs['Fac' if node.type == 'TEX_NOISE' else 'Distance']))
    outputs.sort(key=lambda o: o[0])
    geometry = tree.nodes.new('NodeGroupInput').outputs[0]
    names = [name for name, _ in outputs]
    assert len(set(names)) == len(names)
    for name, socket in outputs:
        store = tree.nodes.new('GeometryNodeStoreNamedAttribute')
        store.data_type = 'FLOAT'
        store.inputs['Name'].default_value = name
        tree.links.new(geometry, store.inputs['Geometry'])
        tree.links.new(socket, store.inputs['Value'])
        geometry = store.outputs[0]
    tree.links.new(geometry, tree.nodes.new('NodeGroupOutput').inputs[0])
    return tree, names


random.seed(11)
# Blender axes (z up): the tile floor and the four inner walls, then points through the volume
# and a few outside the lit box.
points = [(random.uniform(-0.15, 2.5), random.uniform(0.9, 4.1), 0.2025) for _ in range(40)]
points += [(-0.16, random.uniform(0.9, 4.1), random.uniform(0.21, 0.77)) for _ in range(12)]
points += [(2.52, random.uniform(0.9, 4.1), random.uniform(0.21, 0.77)) for _ in range(12)]
points += [(random.uniform(-0.15, 2.5), 0.905, random.uniform(0.21, 0.77)) for _ in range(12)]
points += [(random.uniform(-0.15, 2.5), 4.095, random.uniform(0.21, 0.77)) for _ in range(12)]
points += [(random.uniform(-0.3, 2.7), random.uniform(0.8, 4.2), random.uniform(0.15, 0.85)) for _ in range(40)]
mesh = bpy.data.meshes.new('points')
mesh.from_pydata(points, [], [])
obj = bpy.data.objects.new('points', mesh)
bpy.context.scene.collection.objects.link(obj)
materials = {}
for material in bpy.data.materials:
    if not material.name.startswith('V10 | submerged light'):
        continue
    modifier = obj.modifiers.new('reference', 'NODES')
    modifier.node_group, names = strength_tree(material)
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
    materials[material.name] = {name: [evaluated.attributes[name].data[i].value for i in range(len(points))] for name in names}
    bsdf = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    materials[material.name + ' color'] = list(bsdf.inputs['Emission Color'].default_value[:3])
    obj.modifiers.remove(modifier)
values = [v for k, v in materials.items() if not k.endswith(' color')]
assert len(values) == 2 and values[0] == values[1], 'the submerged materials no longer share one emission'
result = {'blender': bpy.app.version_string, 'axes': 'blender', 'points': points,
          'materials': sorted(k for k in materials if not k.endswith(' color')),
          'color': materials[next(k for k in materials if k.endswith(' color'))], **values[0]}
(ROOT / 'e2e/fixtures/blender-caustic.json').write_text(json.dumps(result, indent=1) + '\n')
print('wrote', len(points), 'points', sorted(values[0]), 'max strength', max(values[0]['strength']))
