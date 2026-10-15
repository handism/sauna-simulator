"""Fine surface irradiance for the existing approach-stone tops, not an additive lamp.

Invoke bake_irradiance_probes.py -- --deck-surface --out <directory>.
Reuses its camera, sky gates and exclusion of browser-drawn direct lights.
The blend is never saved. The coarse shipped probes are not modified.
"""
import hashlib
import json
import math
from pathlib import Path

import numpy as np


def bake(context):
    c = context
    out = c['OUT']
    out.mkdir(parents=True, exist_ok=True)
    width, height = 89, 9
    lower, upper = [-5.5, 3.65], [5.5, 4.55]
    level, offset = .065, .02
    values = []
    scenes = []
    cosine = np.maximum(c['directions'][:, 1], 0) * c['weights']
    for key, name in c['ALL_SCENES'][1:]:
        scene = c['bpy'].data.scenes[name]
        visible = {o.name: o.visible_camera for o in scene.objects if o.type == 'LIGHT'}
        for obj in scene.objects:
            if obj.type == 'LIGHT' and not obj.hide_render:
                obj.visible_camera = c['in_panorama'](obj, key)
        gates = c['set_sky_gates'](scene.world, False, False)
        c['configure'](scene, 128, backface=True)
        c['composite_backface'](scene)
        rows = []
        for z in np.linspace(lower[1], upper[1], height):
            for x in np.linspace(lower[0], upper[0], width):
                rgba = c['render'](scene, (x, level + offset, z))
                rgb = cosine @ rgba[:, :3]
                assert np.isfinite(rgb).all() and (rgb >= 0).all()
                rows.append(rgb)
            print('DECK_SURFACE', key, len(rows), '/', width * height, flush=True)
        values.extend(rows)
        scenes.append(key)
        for obj in scene.objects:
            if obj.name in visible:
                obj.visible_camera = visible[obj.name]
        c['restore_sky_gates'](scene.world, gates)
    # RGBA half floats, two independent layers; alpha is reserved.
    data = np.ones((len(values), 4), dtype='<f2')
    data[:, :3] = values
    binary = data.tobytes()
    source_hash = hashlib.sha256(c['source'].read_bytes()).hexdigest()
    assert source_hash == c['source_hash']
    header = dict(version=1, width=width, height=height, min=lower, max=upper,
                  level=level, offset=offset, scenes=scenes, input_sha256=source_hash,
                  bin_sha256=hashlib.sha256(binary).hexdigest(),
                  scripts_sha256={name: hashlib.sha256((Path(__file__).parent / name).read_bytes()).hexdigest()
                                  for name in ('bake_deck_irradiance.py', 'bake_irradiance_probes.py')},
                  panorama=[c['WIDTH'], c['HEIGHT']], samples=128,
                  method='cosine integral; replaces probe irradiance on approach-stone tops')
    (out / 'deck-irradiance.bin').write_bytes(binary)
    (out / 'deck-irradiance.json').write_text(json.dumps(header, indent=2) + '\n')
    print('DECK_SURFACE complete', len(binary), source_hash, flush=True)
