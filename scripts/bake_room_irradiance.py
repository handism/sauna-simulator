"""Local diffuse irradiance on the sauna floor and rear cedar wall.

Called by bake_irradiance_probes.py --room-surface --out <dir>. The source
blend is read only. Browser-drawn direct lights are excluded, as in the probes.
"""
import hashlib
import json
from pathlib import Path

import numpy as np

# Coordinates are glTF axes. Each layer is x-fastest then the second plane axis.
SURFACES = [
    dict(name='floor', min=[-6.025, -4.48], max=[-.65, -2.48], level=.1,
         normal=[0, 1, 0], width=44, height=17),
    dict(name='rear-wall', min=[-6.025, .1], max=[-.65, 2.6], level=-4.5125,
         normal=[0, 0, 1], width=44, height=21),
]


def bake(c):
    out = c['OUT']
    out.mkdir(parents=True, exist_ok=True)
    width, height = 44, 21
    data = np.zeros((6, height, width, 4), dtype='<f2')
    invalid = []
    for si, (key, name) in enumerate(c['ALL_SCENES']):
        scene = c['bpy'].data.scenes[name]
        visible = {o.name: o.visible_camera for o in scene.objects if o.type == 'LIGHT'}
        for obj in scene.objects:
            if obj.type == 'LIGHT' and not obj.hide_render:
                obj.visible_camera = c['in_panorama'](obj, key)
        gates = c['set_sky_gates'](scene.world, False, False)
        c['configure'](scene, 64, backface=True)
        c['composite_backface'](scene)
        for pi, plane in enumerate(SURFACES):
            n = np.array(plane['normal'])
            cosine = np.maximum(c['directions'] @ n, 0) * c['weights']
            for j, t in enumerate(np.linspace(plane['min'][1], plane['max'][1], plane['height'])):
                for i, x in enumerate(np.linspace(plane['min'][0], plane['max'][0], plane['width'])):
                    p = np.array([x, plane['level'], t] if pi == 0 else [x, t, plane['level']])
                    rgba = c['render'](scene, p + .02 * n)
                    rgb = cosine @ rgba[:, :3]
                    backface = float(cosine @ rgba[:, 3] / cosine.sum())
                    assert np.isfinite(rgb).all() and (rgb >= 0).all()
                    # A sample inside a bearer/joinery piece cannot light an exposed face.
                    valid = backface < .25
                    data[si * 2 + pi, j, i] = [*rgb, float(valid)]
                    if not valid:
                        invalid.append([key, plane['name'], i, j, backface])
                print('ROOM_SURFACE', key, plane['name'], j + 1, '/', plane['height'], flush=True)
            # Pad the smaller plane; its shader samples only the declared dimensions.
            data[si * 2 + pi, plane['height']:] = data[si * 2 + pi, plane['height'] - 1]
        for obj in scene.objects:
            if obj.name in visible:
                obj.visible_camera = visible[obj.name]
        c['restore_sky_gates'](scene.world, gates)
    # Premultiply RGB by validity so invalid samples fade to the coarse probes.
    data[..., :3] *= data[..., 3:4]
    binary = data.tobytes()
    assert hashlib.sha256(c['source'].read_bytes()).hexdigest() == c['source_hash']
    header = dict(version=1, width=width, height=height, scenes=['day', 'evening', 'night'],
                  surfaces=SURFACES, offset=.02, samples=64, panorama=[c['WIDTH'], c['HEIGHT']],
                  input_sha256=c['source_hash'], bin_sha256=hashlib.sha256(binary).hexdigest(),
                  scripts_sha256={name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                                  for name in ('bake_room_irradiance.py', 'bake_irradiance_probes.py')},
                  invalid_samples=invalid,
                  method='premultiplied cosine irradiance; replaces coarse room diffuse only')
    (out / 'room-irradiance.bin').write_bytes(binary)
    (out / 'room-irradiance.json').write_text(json.dumps(header, indent=2) + '\n')
    print('ROOM_SURFACE_DONE', len(binary), flush=True)
