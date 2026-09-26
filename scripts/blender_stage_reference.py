"""Run with Blender -b blender/scene/SUI_Retreat.blend [-S "SUI • Blue hour"] --python-exit-code 1 --python scripts/blender_stage_reference.py -- day|evening
Renders the water stage's seated view of public/models/sauna.scene.json in Cycles, turned as
e2e/scene-survey.visual.ts turns it (heading n is 0.8n rad right of the stage view; level is
-0.01 rad, down -0.85 rad; 1280x800, vertical FOV of the view), to
blender/renders/stage-water/<lighting>-<heading>-<pitch>.png. 128 denoised samples: references
for the survey captures (scripts/summarize_water_side_images.py), not final renders. The day
lighting is the default scene, the evening one the blue-hour scene. Never saves the input blend.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
VIEWS = [(0, 'level'), (2, 'level'), (4, 'level'), (1, 'down')]
PITCH = {'level': -0.01, 'down': -0.85}


def blender(v):
    """glTF (Y-up) to Blender (Z-up) axes."""
    return Vector((v[0], -v[2], v[1]))


def camera_matrix(position, yaw, pitch):
    """World matrix of a camera turned as three's YXZ rotation (yaw about Y, then pitch about X)."""
    forward = blender((-math.cos(pitch) * math.sin(yaw), math.sin(pitch), -math.cos(pitch) * math.cos(yaw))).normalized()
    up = blender((math.sin(pitch) * math.sin(yaw), math.cos(pitch), math.sin(pitch) * math.cos(yaw))).normalized()
    right = forward.cross(up)
    p = blender(position)
    return Matrix(((right.x, up.x, -forward.x, p.x), (right.y, up.y, -forward.y, p.y),
                   (right.z, up.z, -forward.z, p.z), (0, 0, 0, 1)))


def main():
    lighting = sys.argv[sys.argv.index('--') + 1]
    scene = bpy.context.scene
    assert (scene.name == 'SUI • Blue hour') == (lighting == 'evening'), scene.name
    source = Path(bpy.data.filepath)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    view = json.loads((ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
    position, target = view['position'], view['target']
    # three's lookAt: the stage view's yaw and pitch; the survey resets the pitch.
    d = [t - p for t, p in zip(target, position)]
    yaw0 = math.atan2(-d[0], -d[2])
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1280, 800, 100
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
    data = bpy.data.cameras.new('stage survey')
    data.sensor_fit = 'VERTICAL'
    data.angle_y = math.radians(view['fov'])
    data.clip_start, data.clip_end = 0.05, 250
    camera = bpy.data.objects.new('stage survey', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    out = ROOT / 'blender/renders/stage-water'
    out.mkdir(parents=True, exist_ok=True)
    for heading, pitch in VIEWS:
        camera.matrix_world = camera_matrix(position, yaw0 - 0.8 * heading, PITCH[pitch])
        scene.render.filepath = str(out / f'{lighting}-{heading}-{pitch}.png')
        bpy.ops.render.render(write_still=True)
    assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
    print('STAGE_REFERENCE', lighting, source_hash, flush=True)


if __name__ == '__main__':
    main()
