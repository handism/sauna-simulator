"""Blender -b <blend> --python-exit-code 1 --python scripts/diagnose_probe_visibility.py -- --out <dir>

Trace shipped interpolation corners and test geometric line of sight from surface samples.
This is an offline diagnostic, not a renderer visibility model: transparent surfaces and
foliage count as blockers, filled probes have unknown provenance, and no assets are changed.
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
sys.path.insert(0, str(ROOT / 'scripts'))
from probe_sampling import ProbeSampler


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def blender_vector(p):
    return Vector((float(p[0]), float(-p[2]), float(p[1])))


def obstruction(scene, depsgraph, origin, target):
    start, end = blender_vector(origin), blender_vector(target)
    direction = end - start
    if direction.length < 1e-5:
        return None
    direction.normalize()
    for _ in range(128):
        remaining = (end - start).dot(direction) - 1e-5
        if remaining <= 0:
            return None
        hit, location, _, face, obj, _ = scene.ray_cast(depsgraph, start, direction, distance=remaining)
        if not hit:
            return None
        if not obj.hide_render and obj.visible_camera:
            return dict(object=obj.name, face=int(face), distance_m=float((location - blender_vector(origin)).length))
        start = location + direction * 1e-4
    raise RuntimeError('too many excluded intersections')


def reweighted(rows):
    result = np.zeros(3)
    for grid in sorted({r['grid'] for r in rows}):
        subset = [r for r in rows if r['grid'] == grid]
        visible = [r for r in subset if r['blocker'] is None]
        mass = sum(r['weight'] for r in visible)
        if mass < 1e-8:
            return None  # Do not invent a fallback for a fully occluded stencil.
        value = sum(r['weight'] * np.array(r['signed_rgb']) for r in visible) / mass
        result += subset[0]['grid_weight'] * np.maximum(value, 0)
    return result.tolist()


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
    report = dict(blender=bpy.app.version_string, input_sha256=source_hash,
                  fixture_sha256=sha(args.samples), probe_bin_sha256=sampler.header['bin_sha256'],
                  limitations='Viewport evaluated geometry; render-hidden and camera-invisible objects skipped. Geometric visibility only; glass and leaves block. Filled probe provenance is unavailable. No runtime candidate adopted.', scenes={})
    for key, name in [('day', 'SUI • Daylight'), ('evening', 'SUI • Blue hour')]:
        scene = bpy.data.scenes[name]
        bpy.context.window.scene = scene
        depsgraph = bpy.context.evaluated_depsgraph_get()
        results = []
        for sample in fixture['samples']:
            p, n = np.array(sample['position']), np.array(sample['normal'])
            if p.shape != (3,) or n.shape != (3,) or not np.isfinite([p, n]).all() or abs(np.linalg.norm(n) - 1) > 1e-4:
                raise ValueError('finite position and unit normal required')
            for offset in (.02, .05):
                rows = sampler.contributors(key, p, n)
                for row in rows:
                    row['blocker'] = obstruction(scene, depsgraph, p + offset * n, row['position'])
                results.append(dict(label=sample['label'], ray_origin_offset_m=offset,
                    current_rgb=sampler.sample(key, p, n).tolist(),
                    blocked_weight=sum(r['grid_weight'] * r['weight'] for r in rows if r['blocker']),
                    visible_weight=sum(r['grid_weight'] * r['weight'] for r in rows if r['blocker'] is None),
                    visible_renormalized_rgb=reweighted(rows), contributors=rows))
        report['scenes'][key] = results
    assert sha(source) == source_hash
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'visibility.json').write_text(json.dumps(report, indent=2) + '\n')
    print('PROBE_VISIBILITY_DONE', flush=True)


if __name__ == '__main__':
    main()
