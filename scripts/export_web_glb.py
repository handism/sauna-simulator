"""Run with Blender -b blender/scene/SUI_Retreat.blend --python scripts/export_web_glb.py.
Never saves the input blend. Export policies are intentionally explicit and recorded.
"""
import bpy
import bmesh
import random
import hashlib
import math
import json
import struct
from pathlib import Path
from datetime import datetime, timezone
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models'
OUT.mkdir(parents=True, exist_ok=True)
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
report = {'input': source.relative_to(ROOT).as_posix(), 'input_sha256': source_hash,
          'input_modified_utc': datetime.fromtimestamp(source.stat().st_mtime, timezone.utc).isoformat(),
          'blender': bpy.app.version_string, 'source_objects': len(bpy.context.scene.objects),
          'policy': {'compression': 'none', 'texture_size': 1024, 'scope': 'sauna, courtyard and woodland horizon',
                     'materials': 'simplified PBR; image diffuse/normal; no procedural baking; world-space FBM base-color ramps (ground moss, ferns) and image-luminance ramps with per-object random tints (stone, linen, timber) recorded in material extras for the browser shader',
                     'geometry': 'visible meshes; small garden detail omitted; bevel segments capped at 1; solid meshes over 500 polygons reduced toward 350; seeded leaf sampling; near V7/V11 maple leaves keep every source leaf and lobed outline, V6 woodland leaves become alpha-tested cards, one per 20 source leaves with the same total leaf area; other leaves become two-triangle silhouettes (V5/V6 source leaves are already diamonds); render-visible woodland beyond the courtyard is kept (the Cycles views frame it); tree-bark curves meshed with bevel resolution capped at 1; render-hidden V5 overhead bough restored; limestone pavers lifted 3 mm above coplanar deck planks'},
          'materials': [], 'excluded': [], 'foliage_sampling': [], 'objects_beyond_courtyard': 0,
          'pillow_topology': [], 'lifted_pavers': 0}
PAVER_LIFT = .003
# Scene-linear luminance weights that Blender's RGB to BW node uses (OCIO config 'luma').
LUMA = [float(v) for v in next(line for line in (Path(bpy.utils.resource_path('LOCAL')) / 'datafiles/colormanagement/config.ocio').read_text().splitlines()
                               if line.startswith('luma:')).split('[')[1].rstrip(']').split(',')]
RANDOM_ATTRIBUTE = 'SuiObjectRandom'
report['paver_lift_m'] = PAVER_LIFT
report['procedural_color'] = []
noise_color = {}
report['image_ramp'] = []
image_ramp = {}

def base_color_noise(m, principled):
    """Describe a Base Color driven by world-space FBM noise through a linear ramp, or None."""
    link = principled.inputs['Base Color'].links[0] if principled and principled.inputs['Base Color'].is_linked else None
    ramp = link and link.from_node
    if not ramp or ramp.type != 'VALTORGB' or not ramp.inputs['Fac'].is_linked:
        return None
    noise = ramp.inputs['Fac'].links[0].from_node
    if noise.type != 'TEX_NOISE' or not noise.inputs['Vector'].is_linked:
        return None
    source = noise.inputs['Vector'].links[0]
    world = source.from_node.type == 'NEW_GEOMETRY' and source.from_socket.name == 'Position'
    # Object coordinates equal world coordinates only on untransformed users.
    local = source.from_node.type == 'TEX_COORD' and source.from_socket.name == 'Object' and all(
        o.matrix_world == o.matrix_world.Identity(4) for o in bpy.data.objects
        if o.type == 'MESH' and m.name in [x.name for x in o.data.materials if x])
    value = lambda name: noise.inputs[name].default_value
    assert not any(noise.inputs[name].is_linked for name in ('Scale', 'Detail', 'Roughness', 'Lacunarity', 'Distortion')), m.name
    if not (world or local) or noise.noise_dimensions != '3D' or noise.noise_type != 'FBM' or not noise.normalize or value('Distortion') != 0:
        return None
    assert ramp.color_ramp.interpolation == 'LINEAR' and ramp.color_ramp.color_mode == 'RGB', m.name
    return {'space': 'blender_world', 'scale': value('Scale'), 'detail': value('Detail'),
            'roughness': value('Roughness'), 'lacunarity': value('Lacunarity'),
            'stops': [[e.position, *e.color[:3]] for e in ramp.color_ramp.elements]}

def linked(socket):
    return socket.links[0].from_node if socket.is_linked else None

def linear_ramp(node):
    assert node.color_ramp.interpolation == 'LINEAR' and node.color_ramp.color_mode == 'RGB', node.name
    return [[e.position, *e.color[:3]] for e in node.color_ramp.elements]

def base_color_image_ramp(m, principled):
    """Describe Base Color = [mix to constant] of [wet multiply] of ramp(BW(diffuse)) * ramp(object random), or None."""
    node = principled and linked(principled.inputs['Base Color'])
    mix = wet = None
    # Outer blend toward a flat color (plunge basalt, pool coping).
    if node and node.type == 'MIX_RGB' and node.blend_type == 'MIX' and not node.inputs['Fac'].is_linked and not node.inputs[2].is_linked:
        mix = {'factor': node.inputs['Fac'].default_value, 'color': list(node.inputs[2].default_value[:3])}
        node = linked(node.inputs[1])
    # Noise-masked darkening (wet patches) is omitted: its mask needs object coordinates of joined meshes.
    if node and node.type == 'MIX_RGB' and node.blend_type == 'MULTIPLY' and node.inputs['Fac'].is_linked and not node.inputs[2].is_linked:
        wet = {'color': list(node.inputs[2].default_value[:3])}
        node = linked(node.inputs[1])
    if not node or node.type != 'MIX_RGB' or node.blend_type != 'MULTIPLY' or node.inputs['Fac'].is_linked or node.inputs['Fac'].default_value != 1:
        return None
    ramp, tint = linked(node.inputs[1]), linked(node.inputs[2])
    if not ramp or not tint or ramp.type != 'VALTORGB' or tint.type != 'VALTORGB':
        return None
    bw, info = linked(ramp.inputs['Fac']), linked(tint.inputs['Fac'])
    image = bw and bw.type == 'RGBTOBW' and linked(bw.inputs['Color'])
    if not image or image.type != 'TEX_IMAGE' or not info or info.type != 'OBJECT_INFO' or tint.inputs['Fac'].links[0].from_socket.name != 'Random':
        return None
    uv = image.inputs['Vector'].links[0] if image.inputs['Vector'].is_linked else None
    assert not node.use_clamp and (uv is None or (uv.from_node.type == 'TEX_COORD' and uv.from_socket.name == 'UV')), m.name
    assert 'Diffuse' in image.image.name, m.name
    return {'image': image.image.name, 'luminance': LUMA, 'stops': linear_ramp(ramp), 'random': linear_ramp(tint),
            'mix': mix}, wet

# Rebuild materials into the subset glTF can represent. Keep source UVs and packed images.
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nodes = m.node_tree.nodes
    p = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    color = tuple(p.inputs['Base Color'].default_value) if p else (.2,.25,.15,1)
    # Fallback tints for procedurally colored moss and ferns; flat source colors are kept.
    procedural = p is not None and p.inputs['Base Color'].is_linked
    if procedural and 'moss' in m.name.lower(): color=(.055,.095,.025,1)
    if procedural and 'fern' in m.name.lower(): color=(.075,.14,.035,1)
    roughness = p.inputs['Roughness'].default_value if p else .85
    metallic = p.inputs['Metallic'].default_value if p else 0
    imgs = [n.image for n in nodes if n.type == 'TEX_IMAGE' and n.image]
    diffuse = next((i for i in imgs if 'Diffuse' in i.name), None)
    normal = next((i for i in imgs if 'nor_gl' in i.name), None)
    report['materials'].append({'name':m.name,'images':[i.name for i in imgs], 'procedural_nodes':sum(n.type in {'TEX_NOISE','VALTORGB','MIX_RGB','BUMP'} for n in nodes)})
    # The browser evaluates the same noise per pixel; baking would need a huge texture for the terrain.
    ramped = base_color_image_ramp(m, p)
    if ramped:
        image_ramp[m.name] = ramped[0]
        report['image_ramp'].append({'material': m.name, **ramped[0], 'wet_mask_omitted': ramped[1]})
    noise = base_color_noise(m, p)
    if noise:
        noise_color[m.name] = noise
        report['procedural_color'].append({'material': m.name, **noise, 'bump_omitted': any(n.type == 'BUMP' for n in nodes)})
    nodes.clear()
    p = nodes.new('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = color
    p.inputs['Roughness'].default_value = max(.3,roughness)
    p.inputs['Metallic'].default_value = metallic
    output = nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(p.outputs['BSDF'], output.inputs['Surface'])
    for img, socket in [(diffuse,'Base Color'), (normal,'Normal')]:
        if img:
            if img.size[0] > 1024:
                img.scale(1024,1024)
            tex = nodes.new('ShaderNodeTexImage'); tex.image=img
            if socket == 'Normal':
                n = nodes.new('ShaderNodeNormalMap'); n.inputs['Strength'].default_value=.35
                m.node_tree.links.new(tex.outputs['Color'],n.inputs['Color'])
                m.node_tree.links.new(n.outputs['Normal'],p.inputs[socket])
            else:
                m.node_tree.links.new(tex.outputs['Color'],p.inputs[socket])
    if 'glass' in m.name.lower() or m.name == 'V4 | clear spring water':
        p.inputs['Base Color'].default_value=(.5,.7,.7,1)
        p.inputs['Alpha'].default_value=.12 if 'glass' in m.name.lower() else .55
        m.surface_render_method='DITHERED'
    if 'LED' in m.name:
        p.inputs['Emission Color'].default_value=(1,.45,.12,1)
        p.inputs['Emission Strength'].default_value=2

# Source leaves drawn on one alpha-tested woodland card; the browser generates the
# matching mask (src/components/3d/leafCluster.ts) from material extras.
CLUSTER_LEAVES = 20
report['leaf_cluster_leaves'] = CLUSTER_LEAVES
CARD_SUFFIX = ' card'

def card_material(material):
    """Cards need their own materials: V8 low grass shares the V6 leaf colors but has no card UVs."""
    name = material.name + CARD_SUFFIX
    if name not in bpy.data.materials:
        material.copy().name = name
    return bpy.data.materials[name]

def sample_whole_leaves(obj, leaves, style='diamond'):
    """Sample disconnected leaves. Keep each source outline ('outline'), reduce it to a planar
    silhouette ('diamond'), or replace CLUSTER_LEAVES leaves with one textured card ('cluster')."""
    mesh = obj.data
    parent = list(range(len(mesh.vertices)))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for edge in mesh.edges:
        a, b = edge.vertices
        parent[root(a)] = root(b)
    islands = {}
    for polygon in mesh.polygons:
        islands.setdefault(root(polygon.vertices[0]), []).append(polygon.index)
    # A connected solid is not a collection of leaves; retain the normal decimator.
    if len(islands) < 2:
        return False
    groups = list(islands.values())
    random.Random(obj.name).shuffle(groups)
    if style == 'cluster':
        leaves = math.ceil(len(groups) / CLUSTER_LEAVES)
    vertices, faces, material_indices, smooth, uvs = [], [], [], [], []
    # A card keeps the leaf area of the source leaves it replaces; its mask covers half the card,
    # as a diamond covers half of its bounding rectangle.
    grow = math.sqrt(len(groups) / min(leaves, len(groups))) if style == 'cluster' else 1
    turns = random.Random(obj.name + ' cards')
    for group in groups[:leaves]:
        if style == 'outline':
            # Lobed maple leaves lose their outline as diamonds; copy the source fan.
            remap = {}
            for f in group:
                polygon = mesh.polygons[f]
                for i in polygon.vertices:
                    if i not in remap:
                        remap[i] = len(vertices)
                        vertices.append(mesh.vertices[i].co.copy())
                faces.append(tuple(remap[i] for i in polygon.vertices))
                material_indices.append(polygon.material_index)
                smooth.append(polygon.use_smooth)
            continue
        # Each complete leaf becomes a broad two-triangle diamond (or card) in its own plane.
        # This preserves its size and orientation while allowing more leaves per budget.
        points = [mesh.vertices[i].co.copy() for i in sorted({v for f in group for v in mesh.polygons[f].vertices})]
        center = sum(points, Vector()) / len(points)
        normal = mesh.polygons[group[0]].normal.normalized()
        major = max((point - center for point in points), key=lambda v: v.length_squared)
        major = (major - normal * major.dot(normal)).normalized()
        minor = normal.cross(major).normalized()
        if major.length < .5 or minor.length < .5:
            continue
        u = [(point-center).dot(major) * grow for point in points]
        v = [(point-center).dot(minor) * grow for point in points]
        start = len(vertices)
        if style == 'cluster':
            vertices.extend([center+major*max(u)+minor*max(v), center+major*min(u)+minor*max(v),
                             center+major*min(u)+minor*min(v), center+major*max(u)+minor*min(v)])
            # Quarter turns keep neighbouring cards from repeating the same leaf pattern.
            turn = turns.randrange(4)
            corners = [(1, 1), (0, 1), (0, 0), (1, 0)]
            uvs.append(corners[turn:] + corners[:turn])
        else:
            vertices.extend([center+major*max(u), center+minor*max(v), center+major*min(u), center+minor*min(v)])
        faces.append((start, start+1, start+2, start+3))
        material_indices.append(mesh.polygons[group[0]].material_index)
        smooth.append(False)
    if not faces:
        return False
    simplified = bpy.data.meshes.new(obj.name + ' web leaves')
    simplified.from_pydata(vertices, [], faces)
    for material in mesh.materials: simplified.materials.append(card_material(material) if style == 'cluster' else material)
    if uvs:
        layer = simplified.uv_layers.new(name='UVMap')
        for polygon, corners in zip(simplified.polygons, uvs):
            for loop, uv in zip(polygon.loop_indices, corners):
                layer.data[loop].uv = uv
    # Source maple leaves are smooth-shaded, which also lets glTF share each fan's vertices.
    for polygon, material_index, use_smooth in zip(simplified.polygons, material_indices, smooth):
        polygon.material_index = material_index
        polygon.use_smooth = use_smooth
    simplified.update()
    obj.data = simplified
    report['foliage_sampling'].append({'object': obj.name, 'input_faces': len(mesh.polygons),
                                      'output_faces': len(obj.data.polygons), 'islands': len(islands),
                                      'output_leaves': min(leaves, len(groups)), 'card_scale': round(grow, 4),
                                      'method': 'seeded whole-leaf selection; ' + {'outline': 'source leaf outlines',
                                                'diamond': 'two-triangle planar silhouettes',
                                                'cluster': f'alpha-tested cards, one per {CLUSTER_LEAVES} source leaves'}[style]})
    return True

# Bark curves are the only support for several crowns. Mesh them before the
# mesh-only filter so the canopies do not float. The V6 pass hid the overhead
# bough, which Cycles cameras never framed; the web views look straight up.
report['bark_curves'] = []
depsgraph = bpy.context.evaluated_depsgraph_get()
for o in list(bpy.context.scene.objects):
    restored = o.name == 'V5 overhead canopy bough'
    if o.type != 'CURVE' or (o.hide_render and not restored) or 'Tree bark' not in [m.name for m in o.data.materials if m]:
        continue
    o.data.bevel_resolution = min(o.data.bevel_resolution, 1)
    o.hide_render = False
    o.update_tag()
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(o.evaluated_get(depsgraph))
    # Bark is untextured; curve UVs would add TEXCOORD_0 to every joined bark vertex.
    while mesh.uv_layers: mesh.uv_layers.remove(mesh.uv_layers[0])
    web = bpy.data.objects.new(o.name, mesh)
    web.matrix_world = o.matrix_world.copy()
    for collection in o.users_collection: collection.objects.link(web)
    report['bark_curves'].append({'object': o.name, 'triangles': sum(len(p.vertices) - 2 for p in mesh.polygons),
                                  'restored_hidden_render': restored})
    bpy.data.objects.remove(o, do_unlink=True)
    web.name = report['bark_curves'][-1]['object']

selected=[]
for o in list(bpy.context.scene.objects):
    # Omit small garden detail. Render-visible objects beyond the courtyard are
    # only woodland trees, which form the horizon in the Cycles views.
    size=max(o.dimensions) if o.type=='MESH' else 0
    exclude=(o.type!='MESH' or o.hide_render or 'steam' in o.name.lower()
             or 'droplet' in o.name.lower()
             or (o.location.y < 0 and size < .35))
    if exclude:
        report['excluded'].append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    if o.location.y < -13 or abs(o.location.x) > 15: report['objects_beyond_courtyard'] += 1
    if o.name.startswith('Limestone terrace paver'):
        # Pavers share the deck planks' 0.075 m top face; lift them so the rasterizer keeps stone on top.
        o.location.z += PAVER_LIFT
        report['lifted_pavers'] += 1
    if o.name.startswith('V6 compressed linen pillow'):
        # The parametric poles have coincident, disconnected vertices. Decimate
        # opens visible holes unless these are welded before simplification.
        mesh = bmesh.new()
        mesh.from_mesh(o.data)
        before = sum(edge.is_boundary for edge in mesh.edges)
        bmesh.ops.remove_doubles(mesh, verts=list(mesh.verts), dist=1e-6)
        assert all(edge.is_manifold for edge in mesh.edges), o.name
        mesh.to_mesh(o.data)
        mesh.free()
        report['pillow_topology'].append({'object': o.name, 'boundary_edges_before': before,
                                         'boundary_edges_after_weld': 0, 'weld_distance_m': 1e-6})
    for mod in list(o.modifiers):
        if mod.type=='BEVEL': mod.segments=1
        if mod.type=='SUBSURF': o.modifiers.remove(mod)
    o.hide_set(False)
    o.hide_viewport=False
    foliage = any(key in o.name.lower() for key in ('canopy', 'clustered tree leaves', 'clustered lobed foliage', 'lobed maple leaves'))
    # The overhead canopy already has one quad per leaf; sampling would only thin its twig clusters.
    near_maple = ('V11 maple' in o.name and not o.name.startswith('V11 bank leaf group')) or o.name == 'V7 lobed maple leaves'
    # Near maples keep every horizontal source leaf; their layered crowns thin out visibly when sampled.
    leaves = len(o.data.polygons) if o.name == 'V5 light filtering canopy' or near_maple else 175
    # V6 woodland crowns have about 4,000 leaves; 175 of them read as bare branches.
    style = 'outline' if near_maple else 'cluster' if 'V6 clustered tree leaves' in o.name else 'diamond'
    sampled = foliage and len(o.data.polygons) > 500 and sample_whole_leaves(o, leaves, style)
    if len(o.data.polygons) > 500 and not sampled:
        mod=o.modifiers.new('Web reduction','DECIMATE'); mod.ratio=min(1, 350/len(o.data.polygons))
    selected.append(o)
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active=selected[0]
bpy.ops.object.convert(target='MESH')
for entry in report['pillow_topology']:
    mesh = bmesh.new()
    mesh.from_mesh(bpy.data.objects[entry['object']].data)
    entry['non_manifold_edges_after_reduction'] = sum(not edge.is_manifold for edge in mesh.edges)
    entry['triangles_after_reduction'] = sum(len(face.verts) - 2 for face in mesh.faces)
    assert entry['non_manifold_edges_after_reduction'] == 0, entry
    mesh.free()
# Cycles' Object Info Random is lost when objects are joined. Carry one value per
# source object in a color attribute; the browser maps it through the tint ramp.
# The value is seeded by the object name and is not Cycles' own random number.
report['image_ramp_objects'] = 0
for o in bpy.context.selected_objects:
    slots = [m.name if m else '' for m in o.data.materials]
    if not any(name in image_ramp for name in slots):
        continue
    t = int(hashlib.sha256(o.name.encode()).hexdigest()[:8], 16) / 0xffffffff
    # Linked duplicates would otherwise overwrite each other's value.
    if o.data.users > 1: o.data = o.data.copy()
    attribute = o.data.color_attributes.new(RANDOM_ATTRIBUTE, 'FLOAT_COLOR', 'CORNER')
    # Faces of other materials keep a neutral vertex color.
    for poly in o.data.polygons:
        value = (t, t, t, 1) if slots and slots[poly.material_index] in image_ramp else (1, 1, 1, 1)
        for loop in poly.loop_indices: attribute.data[loop].color = value
    o.data.color_attributes.active_color = attribute
    o.data.color_attributes.render_color_index = o.data.color_attributes.active_color_index
    report['image_ramp_objects'] += 1
report['export_objects_before_join']=len(bpy.context.selected_objects)
report['triangles']=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in bpy.context.selected_objects)
# Join by material to make repeated boards and foliage inexpensive to submit.
groups={}
for o in list(bpy.context.selected_objects):
    key=tuple(m.name if m else '' for m in o.data.materials)
    groups.setdefault(key,[]).append(o)
bpy.ops.object.select_all(action='DESELECT')
for objects in groups.values():
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1: bpy.ops.object.join()
    bpy.ops.object.select_all(action='DESELECT')
report['export_meshes']=len([o for o in bpy.context.scene.objects if o.type=='MESH'])
# Compression hook: keep export settings together; Draco can be enabled after profiling.
settings=dict(export_format='GLB',export_yup=True,export_cameras=False,export_lights=False,
              use_active_scene=True,export_animations=False,export_image_format='JPEG',export_jpeg_quality=82,
              export_vertex_color='ACTIVE',export_draco_mesh_compression_enable=False)
bpy.ops.export_scene.gltf(filepath=str(OUT/'sauna.glb'),**settings)
path=OUT/'sauna.glb'
data=path.read_bytes()
json_size=struct.unpack_from('<I',data,12)[0]
model=json.loads(data[20:20+json_size])
for material in model.get('materials',[]):
    if material['name'] in image_ramp:
        # The browser shader replaces the texture color; keep the factor neutral.
        material['pbrMetallicRoughness']['baseColorFactor']=[1,1,1,1]
        assert 'baseColorTexture' in material['pbrMetallicRoughness'], material['name']
        material['extras']={'suiImageRamp':{k:v for k,v in image_ramp[material['name']].items() if k!='image'}}
    if material['name'] in noise_color: material['extras']={'suiNoiseColor':noise_color[material['name']]}
    if material['name'].endswith(CARD_SUFFIX): material['extras']={'suiLeafCluster':{'leaves':CLUSTER_LEAVES}}
# Cluster masks are sampled with the card UVs; every card primitive must carry them.
clusters={i for i,m in enumerate(model.get('materials',[])) if 'suiLeafCluster' in m.get('extras',{})}
assert clusters and all('TEXCOORD_0' in p['attributes'] for mesh in model['meshes'] for p in mesh['primitives'] if p.get('material') in clusters)
# Only card meshes may use card materials; any other user would sample the mask at arbitrary UVs.
card_meshes={mesh['name'] for mesh in model['meshes'] if any(p.get('material') in clusters for p in mesh['primitives'])}
assert len(card_meshes)==1 and all(p.get('material') in clusters for mesh in model['meshes'] if mesh['name'] in card_meshes for p in mesh['primitives']), card_meshes
# Every ramp primitive needs the per-object value, and only ramp meshes may carry colors.
ramps={i for i,m in enumerate(model.get('materials',[])) if 'suiImageRamp' in m.get('extras',{})}
assert ramps and all('COLOR_0' in p['attributes'] for mesh in model['meshes'] for p in mesh['primitives'] if p.get('material') in ramps)
assert all(any(p.get('material') in ramps for p in mesh['primitives']) for mesh in model['meshes'] if any('COLOR_0' in p['attributes'] for p in mesh['primitives']))
report['image_ramp_meshes']=sum(any(p.get('material') in ramps for p in mesh['primitives']) for mesh in model['meshes'])
for entry in report['procedural_color'] + report['image_ramp']:
    entry['in_glb'] = any(m['name'] == entry['material'] for m in model.get('materials',[]))
encoded=json.dumps(model,separators=(',',':')).encode()
encoded+=b' '*((-len(encoded))%4)
tail=data[20+json_size:]
path.write_bytes(struct.pack('<III',0x46546C67,2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
report['export_settings']=settings
report['output_bytes']=(OUT/'sauna.glb').stat().st_size
report['output_sha256']=hashlib.sha256((OUT/'sauna.glb').read_bytes()).hexdigest()
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
(OUT/'export-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
import sys
sys.path.insert(0, str(ROOT / 'scripts'))
from web_scene import write_definition
write_definition(OUT)
print('WEB_EXPORT',report['output_bytes'],report['triangles'],report['export_meshes'],flush=True)
