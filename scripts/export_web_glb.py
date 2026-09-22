"""Run with Blender -b blender/scene/SUI_Retreat.blend --python scripts/export_web_glb.py.
Never saves the input blend. Export policies are intentionally explicit and recorded.
"""
import bpy
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
                     'geometry': 'visible meshes; small garden detail omitted; bevel segments capped at 1; meshes over 500 polygons reduced toward 350'},
          'materials': [], 'excluded': []}
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

selected=[]
for o in list(bpy.context.scene.objects):
    # Courtyard and sauna only; retain larger silhouettes beyond the glazing.
    corners=[o.matrix_world @ Vector(v) for v in o.bound_box] if o.type=='MESH' else []
    size=max(o.dimensions) if corners else 0
    exclude=(o.type!='MESH' or o.hide_render or 'steam' in o.name.lower()
             or 'droplet' in o.name.lower()
             or (o.location.y < 0 and size < .35)
             or o.location.y < -13 or abs(o.location.x)>15)
    if exclude:
        report['excluded'].append(o.name)
        bpy.data.objects.remove(o, do_unlink=True)
        continue
    for mod in list(o.modifiers):
        if mod.type=='BEVEL': mod.segments=1
        if mod.type=='SUBSURF': o.modifiers.remove(mod)
    o.hide_set(False)
    o.hide_viewport=False
    if len(o.data.polygons) > 500:
        mod=o.modifiers.new('Web reduction','DECIMATE'); mod.ratio=min(1, 350/len(o.data.polygons))
    selected.append(o)
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active=selected[0]
bpy.ops.object.convert(target='MESH')
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
