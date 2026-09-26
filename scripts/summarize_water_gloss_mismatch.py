"""Compare the Cycles glossy pass per scene change with the traced water exit (python3, NumPy).

python3 scripts/summarize_water_gloss_mismatch.py GLOSS_DIR SHADING_DIR CAPTURE_DIR --out docs/3d-qa/water-gloss-mismatch

GLOSS_DIR is the output of diagnose_water_gloss_mismatch.py (gloss.json),
SHADING_DIR that of diagnose_water_shading_normals.py (shading.json.gz) and
CAPTURE_DIR that of diagnose_water_capture_radiance.py (terminals.json.gz and
the panoramas). The exit estimated from the capture uses the terminals' own
directions corrected by the nested boxes (nested_coping), the ideal use of the
capture; with face normals it is checked against the rendered truth of
water-capture-radiance. Ratios above 1 mean that the traced exit alone is
brighter than the whole Cycles glossy pass.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from water_capture_parallax import nested_box_lookup  # noqa: E402
from water_capture_radiance import lookup  # noqa: E402


def exit_estimate(terminals, samples, image, probe, boxes):
    """(1/N) sum(weight * L) over the exit terminals, L looked up in the capture."""
    if not terminals:
        return np.zeros(3)
    directions = np.array([nested_box_lookup(t['origin'], t['direction'], probe, boxes) or t['direction']
                           for t in terminals])
    weights = np.array([t['weight'] for t in terminals])
    return (weights[:, None] * lookup(image, directions)).sum(axis=0) / samples


def rounded(value, digits=6):
    return None if value is None else round(float(value), digits)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('gloss', type=Path)
    parser.add_argument('shading', type=Path)
    parser.add_argument('capture', type=Path)
    parser.add_argument('--capture-summary', type=Path, default=Path('docs/3d-qa/water-capture-radiance/summary.json'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    gloss = json.loads((args.gloss / 'gloss.json').read_text())
    with gzip.open(args.shading / 'shading.json.gz', 'rt') as stream:
        shading = json.load(stream)
    with gzip.open(args.capture / 'terminals.json.gz', 'rt') as stream:
        capture = json.load(stream)
    capture_summary = json.loads(args.capture_summary.read_text())
    if not (gloss['input_sha256'] == shading['input_sha256'] == capture['input_sha256']):
        raise RuntimeError('Inputs belong to different blends')
    if [e['pixel'] for e in gloss['endpoints']] != [e['pixel'] for e in shading['endpoints']]:
        raise RuntimeError('Endpoint order differs between the renders and the trace')
    by_radiance = {e['radiance_index']: e for e in capture['endpoints'] if e['radiance_index'] is not None}
    for e in shading['endpoints']:
        if by_radiance[e['index']]['pixel'] != e['pixel']:
            raise RuntimeError('Endpoint order differs from the capture diagnosis')
        # Face normals with the capture's 64 samples and seeds must give the capture's lobe.
        run = next(r for r in e['runs'] if r['mode'] == 'geometric' and r['samples'] == capture['lobe_samples'])
        if abs(run['lobe_total'] - by_radiance[e['index']]['lobe_total']) > 1e-9:
            raise RuntimeError(f'Lobe of endpoint {e["index"]} is not reproduced')
    probe = capture['probe']
    boxes = capture['proxies']['nested_coping']
    variants = list(gloss['variants'])
    largest = max(shading['samples'])
    summary = {'source': {'gloss_sha256': sha(args.gloss / 'gloss.json'),
                          'shading_sha256': sha(args.shading / 'shading.json.gz'),
                          'terminals_sha256': sha(args.capture / 'terminals.json.gz'),
                          'capture_summary_sha256': sha(args.capture_summary),
                          'script_sha256': sha(Path(__file__)), 'input_sha256': gloss['input_sha256'],
                          'gloss_script_sha256': gloss['script_sha256'],
                          'shading_script_sha256': shading['script_sha256']},
               'variants': gloss['variants'], 'cycles_samples': gloss['samples_per_pixel'] * gloss['pixels'],
               'seeds': gloss['seeds'], 'trace_samples': shading['samples'],
               'shading_deviation_deg': shading['shading_deviation_deg'], 'scenes': {}}
    for label in gloss['scenes']:
        captures = [np.load(args.capture / f'capture-{label}-{c["seed"]}.npy').astype(np.float64)
                    for c in capture['scenes'][label]['captures']]
        image = sum(captures) / len(captures)
        truth = {r['radiance_index']: np.array(r['exit_true'])
                 for r in capture_summary['scenes'][label]['radiance_points']['rows']}
        rows = []
        for e in shading['endpoints']:
            i = e['index']
            glossy = {}
            for v in variants:
                values = [np.sum(r['colors']['glossy']) for r in gloss['renders']
                          if r['scene'] == label and r['variant'] == v and r['index'] == i]
                glossy[v] = {'mean': float(np.mean(values)),
                             'seed_spread': float(np.ptp(values) / np.mean(values)) if np.mean(values) > 0 else None}
            runs = {(r['mode'], r['samples']): r for r in e['runs']}
            estimate = {f'{mode}_{count}': float(exit_estimate(run['exit_terminals'], count, image, probe, boxes).sum())
                        for (mode, count), run in runs.items()}
            exit_weight = {f'{mode}_{count}': (run['category_weight'].get('above_water', 0) +
                                               run['category_weight'].get('sky', 0)) / count
                           for (mode, count), run in runs.items()}
            true = float(truth[i].sum())
            base = glossy['base']['mean']
            rows.append({'index': i, 'group': e['group'], 'material': e['material'], 'pixel': e['pixel'],
                         'glossy': {v: {k: rounded(x) for k, x in g.items()} for v, g in glossy.items()},
                         'exit_true_face_normals': rounded(true),
                         'exit_estimate': {k: rounded(x) for k, x in estimate.items()},
                         'exit_weight': {k: rounded(x) for k, x in exit_weight.items()},
                         'true_over_glossy': {v: rounded(true / g['mean'], 4) for v, g in glossy.items()},
                         'shading_over_base_glossy': rounded(estimate[f'shading_{largest}'] / base, 4),
                         'face_over_base_glossy': rounded(estimate[f'geometric_{largest}'] / base, 4)})
        calibration = [abs(r['exit_estimate'][f'geometric_{capture["lobe_samples"]}'] - r['exit_true_face_normals'])
                       / r['exit_true_face_normals'] for r in rows if r['exit_true_face_normals'] > 0]
        summary['scenes'][label] = {
            'rows': rows,
            'capture_vs_truth_face_normals': {'p50': rounded(np.median(calibration), 4),
                                              'max': rounded(np.max(calibration), 4), 'count': len(calibration)},
            'points_true_over_glossy_above_1': {v: [r['index'] for r in rows if r['true_over_glossy'][v] > 1]
                                                for v in variants},
            'points_face_estimate_above_base_glossy': [r['index'] for r in rows if r['face_over_base_glossy'] > 1],
            'points_shading_estimate_above_base_glossy': [r['index'] for r in rows
                                                          if r['shading_over_base_glossy'] > 1]}
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    for label, entry in summary['scenes'].items():
        print(label, 'capture vs truth (face normals)', entry['capture_vs_truth_face_normals'])
        print(label, 'true/glossy > 1', entry['points_true_over_glossy_above_1'])
        print(label, 'face estimate > base glossy', entry['points_face_estimate_above_base_glossy'],
              'shading estimate > base glossy', entry['points_shading_estimate_above_base_glossy'])
        for r in entry['rows']:
            print(f"{r['index']:2d} {r['group']:18s} base {r['glossy']['base']['mean'] * 1000:7.2f} "
                  f"flat {r['glossy']['flat']['mean'] * 1000:7.2f} true {r['exit_true_face_normals'] * 1000:7.2f} "
                  f"face {r['exit_estimate'][f'geometric_{largest}'] * 1000:7.2f} "
                  f"shading {r['exit_estimate'][f'shading_{largest}'] * 1000:7.2f} "
                  f"shading/base {r['shading_over_base_glossy']:.2f}")


if __name__ == '__main__':
    main()
