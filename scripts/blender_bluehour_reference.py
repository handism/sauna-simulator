"""Run with Blender -b blender/scene/SUI_Retreat.blend -S "SUI • Blue hour" --python-exit-code 1 --python scripts/blender_bluehour_reference.py
Renders the daylight review cameras 02-05 and 07 in the blue-hour scene, which the source renders
only show from camera 01 (06.png), to blender/renders/web-bluehour/NN.png. Half resolution and
128 denoised samples: dusk references for scripts/cycles_tone_stats.py, not final renders.
Never saves the input blend.
"""
import bpy
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
scene = bpy.context.scene
assert scene.name == 'SUI • Blue hour', scene.name
scene.render.resolution_percentage = 50
scene.render.image_settings.file_format = 'PNG'
scene.cycles.samples = 128
scene.cycles.use_denoising = True
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'METAL'
prefs.get_devices()
if any(device.type == 'METAL' for device in prefs.devices):
    for device in prefs.devices:
        device.use = True
    scene.cycles.device = 'GPU'
out = ROOT / 'blender/renders/web-bluehour'
out.mkdir(parents=True, exist_ok=True)
for number in ('02', '03', '04', '05', '07'):
    scene.camera = next(o for o in scene.objects if o.type == 'CAMERA' and o.name.startswith(number))
    scene.render.filepath = str(out / f'{number}.png')
    bpy.ops.render.render(write_still=True)
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
print('BLUEHOUR_REFERENCE', source_hash, flush=True)
