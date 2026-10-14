"""Read the static canopy bounds used by waterLightOcclusion.ts; never save the blend.

Blender -b blender/scene/SUI_Retreat.blend -S 'SUI • Blue hour' --python-exit-code 1
  --python scripts/inspect_water_light_canopy.py -- <output.json>
"""
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

source = Path(bpy.data.filepath)
before = hashlib.sha256(source.read_bytes()).hexdigest()
deps = bpy.context.evaluated_depsgraph_get()
objects = []
for obj in bpy.context.scene.objects:
    if not obj.name.startswith(('V8 canopy timber beam', 'V8 slender shade louver')):
        continue
    evaluated = obj.evaluated_get(deps)
    points = [evaluated.matrix_world @ Vector(v) for v in evaluated.bound_box]
    points = [(v.x, v.z, -v.y) for v in points]
    objects.append({
        'name': obj.name,
        'min': [round(min(v[k] for v in points), 7) for k in range(3)],
        'max': [round(max(v[k] for v in points), 7) for k in range(3)],
    })
assert len(objects) == 19, len(objects)
assert before == hashlib.sha256(source.read_bytes()).hexdigest()
report = {
    'blendSha256': before, 'sourceUnchanged': True, 'blender': bpy.app.version_string,
    'scene': bpy.context.scene.name,
    'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'objects': objects,
}
Path(sys.argv[sys.argv.index('--') + 1]).write_text(json.dumps(report, indent=2) + '\n')
