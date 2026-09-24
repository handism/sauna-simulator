"""Run Blender -b --factory-startup --python-exit-code 1 --python scripts/check_probe_visibility.py."""
from pathlib import Path
import runpy
import bpy
import numpy as np
assert not bpy.data.filepath, 'run with --factory-startup, without an input blend'
m=runpy.run_path(str(Path(__file__).with_name('diagnose_probe_visibility.py')))
scene=bpy.context.scene
for obj in list(scene.objects):
 bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.mesh.primitive_cube_add(location=(0,0,0))
cube=bpy.context.object
cube.name='test-blocker'
bpy.context.view_layer.update()
graph=bpy.context.evaluated_depsgraph_get()
cast=lambda a,b:m['obstruction'](scene,graph,np.array(a),np.array(b))
assert cast([-2,0,0],[2,0,0])['object']=='test-blocker'
assert cast([-2,0,0],[-1.5,0,0]) is None
assert cast([-2,2,0],[2,2,0]) is None
cube.hide_render=True
assert cast([-2,0,0],[2,0,0]) is None
cube.hide_render=False
cube.visible_camera=False
assert cast([-2,0,0],[2,0,0]) is None
assert cast([0,0,0],[0,0,0]) is None
d=runpy.run_path(str(Path(__file__).with_name('diagnose_probe_depth.py')))
hit=lambda a,b,l:d['first_hit'](scene,graph,np.array(a),np.array(b),l)
assert hit([-3,0,0],[1,0,0],5)==5
cube.visible_camera=True
assert abs(hit([-3,0,0],[1,0,0],5)-2)<1e-4
assert hit([-3,2,0],[1,0,0],5)==5
assert hit([-3,0,0],[1,0,0],1.5)==1.5
cube.hide_render=True
assert hit([-3,0,0],[1,0,0],5)==5
cube.hide_render=False
rays=d['lobe'](np.array([0,0,1.]))
assert np.allclose(np.linalg.norm(rays,axis=1),1) and rays[:,2].min()>.9
s=runpy.run_path(str(Path(__file__).with_name('survey_probe_enclosure.py')))['sphere']()
assert np.allclose(np.linalg.norm(s,axis=1),1) and np.abs(s.mean(axis=0)).max()<.02
rows=[dict(grid='room',grid_weight=1.,weight=.4,signed_rgb=[-1,2,3],blocker=None),dict(grid='room',grid_weight=1.,weight=.6,signed_rgb=[9,9,9],blocker={ 'object':'x'})]
np.testing.assert_allclose(m['reweighted'](rows),[0,2,3])
rows[0]['blocker']={'object':'x'}
assert m['reweighted'](rows) is None
print('PASS: six ray, two normalization, five first-hit and two direction-set cases')
