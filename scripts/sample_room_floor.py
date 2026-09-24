"""Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/sample_room_floor.py -- --out <fixture.json> [--spacing 0.25]

Writes a surface-sample fixture covering the sauna room floor on a regular xz grid, for
bake_irradiance_probes.py --surface-samples. Rays go straight down from just above the floor
(below the lowest bench) and keep hits on 'Sauna floor' only, in glTF axes. Diagnostic only:
nothing in the blend or the shipped assets changes.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
from mathutils import Vector
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
# The room's inner volume in glTF axes (bake_irradiance_probes.py ROOM).
ROOM = ((-6.15, 0.0, -4.59), (-0.5, 3.36, -0.25))
FLOOR = 'Sauna floor'
CAST_FROM = 0.35  # glTF y: above the floor (0.1), below every bench and bearer.

args = argparse.ArgumentParser()
args.add_argument('--out', type=Path, required=True)
args.add_argument('--spacing', type=float, default=0.25)
args = args.parse_args(sys.argv[sys.argv.index('--') + 1:])

source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
scene = bpy.data.scenes['SUI • Daylight']
bpy.context.window.scene = scene
depsgraph = bpy.context.evaluated_depsgraph_get()

lo, hi = np.array(ROOM[0]), np.array(ROOM[1])
# Cell centers, so no row sits on a wall.
xs = np.arange(lo[0] + args.spacing / 2, hi[0], args.spacing)
zs = np.arange(lo[2] + args.spacing / 2, hi[2], args.spacing)
samples, missed = [], []
for j, z in enumerate(zs):
    for i, x in enumerate(xs):
        hit, location, normal, _, obj, _ = scene.ray_cast(
            depsgraph, Vector((x, -z, CAST_FROM)), Vector((0, 0, -1)), distance=1.0)
        if not hit or obj.name != FLOOR or normal.z < 0.999:
            missed.append(dict(x=round(float(x), 4), z=round(float(z), 4), object=obj.name if hit else None))
            continue
        samples.append(dict(label=f'floor-{i:02d}-{j:02d}', cell=[i, j],
                            position=[location.x, location.z, -location.y], normal=[0.0, 1.0, 0.0]))

fixture = dict(input_sha256=source_hash, spacing_m=args.spacing,
               source=f"Downward ray casts from glTF y={CAST_FROM} onto '{FLOOR}' at cell centers of the room "
                      'volume; glTF axes. Regular grid for a floor map, not a quality score.',
               missed=missed, samples=samples)
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(fixture, indent=1) + '\n')
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
print('FLOOR_SAMPLES', len(samples), 'missed', len(missed), flush=True)
