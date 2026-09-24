"""Blender -b <blend> --python-exit-code 1 --python scripts/survey_probe_enclosure.py -- --out <dir>

Free distance around every shipped irradiance probe: 64 fixed directions over the sphere, the
first render-visible hit per direction (misses count as one probe spacing). Probes in narrow gaps
(under a lounger, between stones) see little light and, through trilinear interpolation, darken
the surfaces above them. Offline diagnostic; the bake and the shipped probes are unchanged.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from probe_sampling import ProbeSampler
from diagnose_probe_depth import first_hit

DIRECTIONS = 64


def sphere(count=DIRECTIONS):
    i = np.arange(count) + .5
    y = 1 - 2 * i / count
    r = np.sqrt(1 - y * y)
    phi = i * np.pi * (3 - np.sqrt(5))
    return np.stack([r * np.cos(phi), y, r * np.sin(phi)], axis=1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = Path(bpy.data.filepath)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    sampler = ProbeSampler(ROOT / 'public/models')
    if source_hash != sampler.header['input_sha256']:
        raise ValueError('blend and probes must match')
    scenes = {name: bpy.data.scenes[name] for name in ('SUI • Daylight', 'SUI • Blue hour')}
    visible = {name: sorted(o.name for o in s.objects if o.type == 'MESH' and not o.hide_render and o.visible_camera)
               for name, s in scenes.items()}
    if len(set(map(tuple, visible.values()))) != 1:
        raise ValueError('day and blue-hour geometry differ; survey both')
    scene = scenes['SUI • Daylight']
    bpy.context.window.scene = scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    directions = sphere()
    report = dict(blender=bpy.app.version_string, input_sha256=source_hash, probe_bin_sha256=sampler.header['bin_sha256'],
                  directions=DIRECTIONS, scene='SUI • Daylight (same render-visible meshes as Blue hour)',
                  limitations='Geometric first hits; glass and leaves block; viewport-evaluated geometry. Misses and hits beyond one spacing count as one spacing.',
                  grids={})
    start = time.time()
    for grid in sampler.header['grids']:
        lo, hi, res = (np.array(grid[k]) for k in ('min', 'max', 'resolution'))
        spacing = (hi - lo) / (res - 1)
        limit = float(spacing.min())
        free = []
        # x fastest, then y, then z: the order of irradiance.bin.
        for z in range(res[2]):
            for y in range(res[1]):
                for x in range(res[0]):
                    probe = lo + np.array([x, y, z]) * spacing
                    free.append([first_hit(scene, depsgraph, probe, d, limit) for d in directions])
            print('PROBE_ENCLOSURE', grid['name'], z + 1, '/', res[2], round(time.time() - start), 's', flush=True)
        free = np.array(free)
        report['grids'][grid['name']] = dict(limit_m=limit, mean_free_m=free.mean(axis=1).round(4).tolist(),
                                             min_free_m=free.min(axis=1).round(4).tolist(),
                                             open_fraction=(free >= limit).mean(axis=1).round(4).tolist())
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'enclosure.json').write_text(json.dumps(report) + '\n')
    print('PROBE_ENCLOSURE_DONE', round(time.time() - start), 's', flush=True)


if __name__ == '__main__':
    main()
