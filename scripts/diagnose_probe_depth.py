"""Blender -b <blend> --python-exit-code 1 --python scripts/diagnose_probe_depth.py -- --out <dir>

For each interpolation corner of the surface fixture, cast a cos^50 lobe of rays from the probe
toward the shaded point and record the first-hit distance moments that a DDGI-style probe depth
map would store for that direction. compare_probe_weights.py turns them into candidate weights.
Offline diagnostic only: geometric hits (glass and leaves block), viewport-evaluated geometry,
no assets are changed and nothing is baked for the browser.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from probe_sampling import ProbeSampler
from diagnose_probe_visibility import blender_vector

# DDGI filters probe depth with a cos^50 lobe; 64 fixed directions per query.
LOBE_POWER = 50
RAYS = 64
# Ray length, in cell diagonals; a miss counts as this distance.
MAX_CELLS = 2.


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def first_hit(scene, depsgraph, origin, direction, distance):
    """Distance to the first render-visible surface (m), or `distance` for a miss."""
    start = blender_vector(origin)
    ray = blender_vector(direction)
    travelled = 0.
    for _ in range(128):
        if travelled >= distance:
            return distance
        hit, location, _, _, obj, _ = scene.ray_cast(depsgraph, start, ray, distance=distance - travelled)
        if not hit:
            return distance
        travelled += (location - start).length
        if not obj.hide_render and obj.visible_camera:
            return travelled
        start = location + ray * 1e-4
        travelled += 1e-4
    raise RuntimeError('too many excluded intersections')


def lobe(axis, count=RAYS, power=LOBE_POWER):
    """Deterministic cos^power samples around a unit axis (Fibonacci azimuths)."""
    axis = np.asarray(axis, float)
    helper = np.array([1., 0, 0]) if abs(axis[0]) < .9 else np.array([0, 1., 0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    v = np.cross(axis, u)
    i = np.arange(count) + .5
    cos = (i / count) ** (1 / (power + 1))
    sin = np.sqrt(1 - cos * cos)
    phi = i * np.pi * (3 - np.sqrt(5))
    return (np.outer(cos, axis) + np.outer(sin * np.cos(phi), u) + np.outer(sin * np.sin(phi), v))


def moments(scene, depsgraph, probe, target, limit):
    offset = np.asarray(target) - probe
    distance = float(np.linalg.norm(offset))
    hits = np.array([first_hit(scene, depsgraph, probe, d, limit) for d in lobe(offset / distance)])
    return dict(distance_m=distance, mean_m=float(hits.mean()), mean_square_m2=float((hits * hits).mean()),
                min_m=float(hits.min()), miss_fraction=float((hits >= limit).mean()))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--samples', type=Path, default=ROOT / 'docs/3d-qa/probe-sampling/surface-points.json')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = Path(bpy.data.filepath)
    sampler = ProbeSampler(ROOT / 'public/models')
    fixture = json.loads(args.samples.read_text())
    source_hash = sha(source)
    if source_hash != fixture['input_sha256'] or source_hash != sampler.header['input_sha256']:
        raise ValueError('blend, fixture and probes must match')
    limits = {g['name']: MAX_CELLS * float(np.linalg.norm((np.array(g['max']) - g['min']) / (np.array(g['resolution']) - 1)))
              for g in sampler.header['grids']}
    report = dict(blender=bpy.app.version_string, input_sha256=source_hash,
                  fixture_sha256=sha(args.samples), probe_bin_sha256=sampler.header['bin_sha256'],
                  lobe=dict(power=LOBE_POWER, rays=RAYS, max_cells=MAX_CELLS, max_distance_m=limits),
                  limitations='Viewport evaluated geometry; render-hidden and camera-invisible objects skipped. Geometric first hits; glass and leaves block. Lobe-sampled moments stand in for a filtered octahedral depth map; no quantization. No runtime candidate adopted.',
                  scenes={})
    for key, name in [('day', 'SUI • Daylight'), ('evening', 'SUI • Blue hour')]:
        scene = bpy.data.scenes[name]
        bpy.context.window.scene = scene
        depsgraph = bpy.context.evaluated_depsgraph_get()
        results = []
        for sample in fixture['samples']:
            p, n = np.array(sample['position']), np.array(sample['normal'])
            if p.shape != (3,) or n.shape != (3,) or not np.isfinite([p, n]).all() or abs(np.linalg.norm(n) - 1) > 1e-4:
                raise ValueError('finite position and unit normal required')
            rows = sampler.contributors(key, p, n)
            for row in rows:
                grid = next(g for g in sampler.header['grids'] if g['name'] == row['grid'])
                half = .5 * (np.array(grid['max']) - grid['min']) / (np.array(grid['resolution']) - 1)
                # Targets: 2 cm and 5 cm off the surface, and the shipped half-spacing sampling point.
                targets = {'0.02': p + .02 * n, '0.05': p + .05 * n, 'half': p + n * half}
                row['depth'] = {k: moments(scene, depsgraph, np.array(row['position']), t, limits[row['grid']])
                                for k, t in targets.items()}
            results.append(dict(label=sample['label'], current_rgb=sampler.sample(key, p, n).tolist(), contributors=rows))
        report['scenes'][key] = results
        print('PROBE_DEPTH_SCENE', key, flush=True)
    assert sha(source) == source_hash
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'depth.json').write_text(json.dumps(report, indent=2) + '\n')
    print('PROBE_DEPTH_DONE', flush=True)


if __name__ == '__main__':
    main()
