"""Read-only Cycles reference for the rear-facing room-light review camera.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1
 --python scripts/blender_room_light_reference.py -- <output-directory>
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

out = Path(sys.argv[sys.argv.index('--') + 1])
out.mkdir(parents=True, exist_ok=True)
source = Path(bpy.data.filepath)
digest = hashlib.sha256(source.read_bytes()).hexdigest()
position = Vector((-3.2, 2.78, 1.65))
target = Vector((-3.6, 4.5, .65))
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
for device in prefs.devices:
    device.use = device.type == 'METAL'
records = []
for key, name in [('day', 'SUI • Daylight'), ('evening', 'SUI • Blue hour'), ('night', 'SUI • Night')]:
    scene = bpy.data.scenes[name]
    camera = bpy.data.objects.new('room-light reference', bpy.data.cameras.new('room-light reference'))
    scene.collection.objects.link(camera)
    camera.location = position
    camera.rotation_euler = (target - position).to_track_quat('-Z', 'Y').to_euler()
    camera.data.sensor_fit = 'VERTICAL'
    camera.data.lens = camera.data.sensor_height / (2 * math.tan(math.radians(58) / 2))
    camera.data.clip_start, camera.data.clip_end = .05, 250
    scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y = 640, 400
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.device = 'GPU'
    scene.render.filepath = str(out / f'rear-{key}.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    records.append(dict(lighting=key, file=f'rear-{key}.png', sha256=hashlib.sha256((out / f'rear-{key}.png').read_bytes()).hexdigest()))
assert hashlib.sha256(source.read_bytes()).hexdigest() == digest
(out / 'references.json').write_text(json.dumps(dict(input_sha256=digest, blender=bpy.app.version_string,
    camera=dict(position=[-3.2,1.65,-2.78], target=[-3.6,.65,-4.5], fov=58),
    samples=128, size=[640,400], captures=records), indent=2)+'\n')
