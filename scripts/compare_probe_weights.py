"""python3 scripts/compare_probe_weights.py <depth.json> [--visibility <visibility.json>] [--out <ratios.json>]

Compares candidate corner weights for the diffuse probes against the near-surface cosine
integrals of docs/3d-qa/probe-sampling/surface-sampling.json (Rec.709 luminance ratios).
CPU only; the depth moments come from diagnose_probe_depth.py and the binary line-of-sight
flags from diagnose_probe_visibility.py. Diagnostic; irradiance.ts is not changed.
"""
import argparse
import json
from pathlib import Path

import numpy as np

from probe_sampling import backface, chebyshev, reweight

ROOT = Path(__file__).resolve().parents[1]
LUMA = np.array([.2126, .7152, .0722])
REGULARIZATION = (0., .05, .1, .2)


def ddgi(weight):
    """DDGI's floor and crush of weights below 0.2 (they stay tiny instead of blending in)."""
    weight = max(weight, 1e-6)
    return weight * weight * weight / .04 if weight < .2 else weight


def candidates(rows, point, normal, target, visible):
    for r in rows:
        d = r['depth'][target]
        r['cheb'] = ddgi(chebyshev(d['distance_m'], d['mean_m'], d['mean_square_m2']))
        r['back'] = backface(r['position'], point, normal)
        r['ddgi'] = ddgi(chebyshev(d['distance_m'], d['mean_m'], d['mean_square_m2']) * r['back'])
        r['one'] = 1.
    out = {'current': reweight(rows, 'one'), 'backface': reweight(rows, 'back')}
    for eps in REGULARIZATION:
        out[f'chebyshev eps={eps}'] = reweight(rows, 'cheb', eps)
        out[f'ddgi eps={eps}'] = reweight(rows, 'ddgi', eps)
    if visible is not None:
        for r, flag in zip(rows, visible):
            r['binary'] = float(flag)
        for eps in REGULARIZATION:
            out[f'binary eps={eps}'] = reweight(rows, 'binary', eps)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('depth', type=Path)
    parser.add_argument('--visibility', type=Path, default=ROOT / 'docs/3d-qa/probe-visibility/visibility.json')
    parser.add_argument('--measured', type=Path, default=ROOT / 'docs/3d-qa/probe-sampling/surface-sampling.json')
    parser.add_argument('--out', type=Path)
    args = parser.parse_args()
    depth = json.loads(args.depth.read_text())
    visibility = json.loads(args.visibility.read_text())
    measured = json.loads(args.measured.read_text())
    if not depth['input_sha256'] == visibility['input_sha256'] == measured['input_sha256']:
        raise ValueError('depth, visibility and measurements must come from the same blend')
    rows_out = []
    for scene, results in depth['scenes'].items():
        reference = {s['label']: s for s in measured['scenes'][scene]['samples']}
        lines = {(v['label'], v['ray_origin_offset_m']): v for v in visibility['scenes'][scene]}
        for result in results:
            sample = reference[result['label']]
            p, n = np.array(sample['position']), np.array(sample['normal'])
            for m in sample['measured']:
                offset = m['offset_m']
                truth = float(LUMA @ m['cosine_rgb'])
                line = lines[(result['label'], offset)]
                flags = [c['blocker'] is None for c in line['contributors']]
                if [c['index'] for c in line['contributors']] != [c['index'] for c in result['contributors']]:
                    raise ValueError('contributor order differs between diagnostics')
                for target in (f'{offset:.2f}', 'half'):
                    values = candidates(result['contributors'], p, n, target, flags)
                    rows_out.append(dict(scene=scene, label=result['label'], offset_m=offset, target=target,
                        ratios={k: None if v is None else float(LUMA @ v) / truth for k, v in values.items()}))
    summary = {}
    for target in ('near', 'half'):
        subset = [r for r in rows_out if (r['target'] == 'half') == (target == 'half')]
        for name in subset[0]['ratios']:
            ratios = np.array([r['ratios'][name] for r in subset if r['ratios'][name] is not None])
            logs = np.abs(np.log2(ratios))
            summary.setdefault(target, {})[name] = dict(
                cases=len(ratios), undefined=len(subset) - len(ratios), mean_abs_log2=float(logs.mean()),
                max_abs_log2=float(logs.max()), min_ratio=float(ratios.min()), max_ratio=float(ratios.max()))
    report = dict(input_sha256=depth['input_sha256'], lobe=depth['lobe'], regularization=REGULARIZATION,
                  summary=summary, cases=rows_out)
    if args.out:
        args.out.write_text(json.dumps(report, indent=2) + '\n')
    for target, table in summary.items():
        print(f'# depth target: {target}')
        for name, s in table.items():
            print(f"{name:22s} n={s['cases']:2d} undef={s['undefined']} mean|log2|={s['mean_abs_log2']:.3f} "
                  f"max={s['max_abs_log2']:.3f} ratio {s['min_ratio']:.3f}..{s['max_ratio']:.3f}")


if __name__ == '__main__':
    main()
