"""Run with Blender -b --factory-startup --python scripts/blender_noise_reference.py.
Evaluates Blender's Noise Texture (FBM, 3D, normalized) with Geometry Nodes, which shares the
shader-node implementation used by Cycles, and writes reference values for the browser port.
"""
import bpy
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
random.seed(7)
points = [(.3, .7, .1), (-3.2, 5.5, -.2), (12.25, -7.75, .4), (0, 0, 0), (-17.3, -11.9, 1.7), (40.1, -30.2, 2.2)]
points += [(random.uniform(-45, 45), random.uniform(-35, 35), random.uniform(-.4, 2.4)) for _ in range(26)]
# Raw Perlin, the V9 ground moss and the V3 fern/forest-floor settings in the source blend.
configs = [dict(scale=1.0, detail=0.0, roughness=.5), dict(scale=1.05, detail=3.5, roughness=.72),
           dict(scale=18.0, detail=4.0, roughness=.5)]
mesh = bpy.data.meshes.new('points')
mesh.from_pydata(points, [], [])
obj = bpy.data.objects.new('points', mesh)
bpy.context.scene.collection.objects.link(obj)
tree = bpy.data.node_groups.new('reference', 'GeometryNodeTree')
tree.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
tree.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
nodes, links = tree.nodes, tree.links
position = nodes.new('GeometryNodeInputPosition')
geometry = nodes.new('NodeGroupInput').outputs[0]
for index, config in enumerate(configs):
    noise = nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions, noise.noise_type, noise.normalize = '3D', 'FBM', True
    noise.inputs['Scale'].default_value = config['scale']
    noise.inputs['Detail'].default_value = config['detail']
    noise.inputs['Roughness'].default_value = config['roughness']
    links.new(position.outputs[0], noise.inputs['Vector'])
    store = nodes.new('GeometryNodeStoreNamedAttribute')
    store.data_type = 'FLOAT'
    store.inputs['Name'].default_value = f'noise{index}'
    links.new(geometry, store.inputs['Geometry'])
    links.new(noise.outputs['Fac'], store.inputs['Value'])
    geometry = store.outputs[0]
links.new(geometry, nodes.new('NodeGroupOutput').inputs[0])
obj.modifiers.new('reference', 'NODES').node_group = tree
evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
result = {'blender': bpy.app.version_string, 'lacunarity': 2.0, 'points': points,
          'configs': [{**config, 'values': [evaluated.attributes[f'noise{index}'].data[i].value for i in range(len(points))]}
                      for index, config in enumerate(configs)]}
(ROOT / 'e2e/fixtures/blender-noise.json').write_text(json.dumps(result, indent=1) + '\n')
