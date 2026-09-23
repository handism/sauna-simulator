"""Run with Blender -b blender/scene/SUI_Retreat.blend --python scripts/export_web_glb.py.
Never saves the input blend. Export policies are intentionally explicit and recorded.
"""
import bpy
import bmesh
import random
import hashlib
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
          'policy': {'compression': 'none', 'texture_size': 1024, 'scope': 'sauna and courtyard',
                     'materials': 'simplified PBR; image diffuse/normal; no procedural baking',
                     'geometry': 'visible meshes; small garden detail omitted; bevel segments capped at 1; solid meshes over 500 polygons reduced toward 350; seeded leaf sampling with two-triangle silhouettes; V11 bank restored at abs(x)<=23m and -20m<=y<-13m; tree-bark curves meshed with bevel resolution capped at 1; render-hidden V5 overhead bough restored; limestone pavers lifted 3 mm above coplanar deck planks'},
          'materials': [], 'excluded': [], 'foliage_sampling': [], 'restored_bank_objects': 0,
          'pillow_topology': [], 'lifted_pavers': 0}
PAVER_LIFT = .003
report['paver_lift_m'] = PAVER_LIFT
# Rebuild materials into the subset glTF can represent. Keep source UVs and packed images.
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nodes = m.node_tree.nodes
    p = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
    color = tuple(p.inputs['Base Color'].default_value) if p else (.2,.25,.15,1)
    if 'moss' in m.name.lower(): color=(.055,.095,.025,1)
    if 'fern' in m.name.lower(): color=(.075,.14,.035,1)
    roughness = p.inputs['Roughness'].default_value if p else .85
    metallic = p.inputs['Metallic'].default_value if p else 0
    imgs = [n.image for n in nodes if n.type == 'TEX_IMAGE' and n.image]
    diffuse = next((i for i in imgs if 'Diffuse' in i.name), None)
    normal = next((i for i in imgs if 'nor_gl' in i.name), None)
    report['materials'].append({'name':m.name,'images':[i.name for i in imgs], 'procedural_nodes':sum(n.type in {'TEX_NOISE','VALTORGB','MIX_RGB','BUMP'} for n in nodes)})
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

def sample_whole_leaves(obj, budget):
    """Sample disconnected leaves and preserve their footprint with planar silhouettes."""
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
    vertices, faces, material_indices = [], [], []
    # Each complete leaf becomes a broad two-triangle diamond in its own plane.
    # This preserves its size and orientation while allowing more leaves per budget.
    for group in groups[:budget // 2]:
        points = [mesh.vertices[i].co.copy() for i in sorted({v for f in group for v in mesh.polygons[f].vertices})]
        center = sum(points, Vector()) / len(points)
        normal = mesh.polygons[group[0]].normal.normalized()
        major = max((point - center for point in points), key=lambda v: v.length_squared)
        major = (major - normal * major.dot(normal)).normalized()
        minor = normal.cross(major).normalized()
        if major.length < .5 or minor.length < .5:
            continue
        u = [(point-center).dot(major) for point in points]
        v = [(point-center).dot(minor) for point in points]
        start = len(vertices)
        vertices.extend([center+major*max(u), center+minor*max(v), center+major*min(u), center+minor*min(v)])
        faces.append((start, start+1, start+2, start+3))
        material_indices.append(mesh.polygons[group[0]].material_index)
    if not faces:
        return False
    simplified = bpy.data.meshes.new(obj.name + ' web leaves')
    simplified.from_pydata(vertices, [], faces)
    for material in mesh.materials: simplified.materials.append(material)
    for polygon, material_index in zip(simplified.polygons, material_indices): polygon.material_index = material_index
    simplified.update()
    obj.data = simplified
    report['foliage_sampling'].append({'object': obj.name, 'input_faces': len(mesh.polygons),
                                      'output_faces': len(obj.data.polygons), 'islands': len(islands),
                                      'method': 'seeded whole-leaf selection; two-triangle planar silhouettes'})
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
    # Courtyard and sauna only; retain larger silhouettes beyond the glazing.
    corners=[o.matrix_world @ Vector(v) for v in o.bound_box] if o.type=='MESH' else []
    size=max(o.dimensions) if corners else 0
    bank = o.name.startswith('V11 bank leaf group') and -20 <= o.location.y < -13 and abs(o.location.x) <= 23
    exclude=(o.type!='MESH' or o.hide_render or 'steam' in o.name.lower()
             or 'droplet' in o.name.lower()
             or (o.location.y < 0 and size < .35)
             or (not bank and (o.location.y < -13 or abs(o.location.x)>15)))
    if exclude:
        report['excluded'].append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    if bank: report['restored_bank_objects'] += 1
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
    budget = 2 * len(o.data.polygons) if o.name == 'V5 light filtering canopy' else 700 if ('V11 maple' in o.name and not bank) or o.name == 'V7 lobed maple leaves' else 350
    sampled = foliage and len(o.data.polygons) > 500 and sample_whole_leaves(o, budget)
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
              export_draco_mesh_compression_enable=False)
bpy.ops.export_scene.gltf(filepath=str(OUT/'sauna.glb'),**settings)
# Restore tints that procedural color mixing previously supplied.
path=OUT/'sauna.glb'
data=path.read_bytes()
json_size=struct.unpack_from('<I',data,12)[0]
model=json.loads(data[20:20+json_size])
for material in model.get('materials',[]):
    name=material['name'].lower()
    factor=None
    if 'charcoal' in name or 'basalt' in name or 'quiet honed stone' in name: factor=[.15,.18,.17,1]
    elif 'outdoor ash' in name or 'damp ash' in name: factor=[.48,.38,.27,1]
    if factor: material['pbrMetallicRoughness']['baseColorFactor']=factor
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
