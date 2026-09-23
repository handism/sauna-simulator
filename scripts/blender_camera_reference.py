"""Run with Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/blender_camera_reference.py.
Writes the Cycles review cameras as web scene views so the browser can be captured from the same
position, direction and vertical field of view. Never saves the input blend.
"""
import bpy
import hashlib
import json
import math
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
web = lambda v: [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]
cameras = []
# blender/scripts/render_v11.py renders 01-05 and 07 in daylight from the matching camera and
# 06 from camera 01 in the blue-hour scene.
for number in ('01', '02', '03', '04', '05', '06', '07'):
    scene = bpy.data.scenes['SUI • Blue hour' if number == '06' else 'SUI • Daylight']
    camera = next(o for o in scene.objects if o.type == 'CAMERA' and o.name.startswith('01' if number == '06' else number))
    data = camera.data
    assert data.type == 'PERSP' and data.shift_x == data.shift_y == 0, camera.name
    width, height = scene.render.resolution_x, scene.render.resolution_y
    assert data.sensor_fit == 'AUTO' and width >= height, camera.name
    rotation = camera.matrix_world.to_quaternion()
    forward = rotation @ Vector((0, 0, -1))
    up = rotation @ Vector((0, 1, 0))
    # The seated web camera has no roll; reject a Cycles view that would need one.
    assert abs(up.dot(forward.cross(Vector((0, 0, 1))).normalized())) < 1e-3, camera.name
    position = camera.matrix_world.translation
    cameras.append({'render': f'{number}.png', 'camera': camera.name, 'scene': scene.name,
                    'lighting': 'evening' if number == '06' else 'day', 'resolution': [width, height],
                    'position': web(position), 'target': web(position + forward * 10),
                    # AUTO fit spans the sensor width across the wider (horizontal) side.
                    'fov': round(math.degrees(2 * math.atan(data.sensor_width / 2 / data.lens * height / width)), 4)})
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
out = ROOT / 'e2e/fixtures/cycles-cameras.json'
out.write_text(json.dumps({'input_sha256': source_hash, 'blender': bpy.app.version_string, 'cameras': cameras}, ensure_ascii=False, indent=2) + '\n')
print('CAMERA_REFERENCE', len(cameras), flush=True)
