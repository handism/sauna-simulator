"""Compare the above-water capture colours with the true lobe radiance (python3, NumPy, PIL).

python3 scripts/summarize_water_capture_radiance.py DIR --out docs/3d-qa/water-capture-radiance

DIR is the output of diagnose_water_capture_radiance.py (terminals.json.gz and
the panoramas as .npy). For every endpoint, the glossy radiance carried by the
terminals that left the water, (1/N) sum(weight * L), is estimated from the
capture in two ways: Monte Carlo over the same terminals with each terminal's
lookup direction (the ideal use of the capture), and one lookup of a von
Mises-Fisher prefiltered panorama along the mean lookup direction (what a
prefiltered environment map does). Errors use the true value as denominator.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))

from water_capture_radiance import (downsample, equirect_directions, lookup, relative_error, vmf_kappa,  # noqa: E402
                                    vmf_prefilter)

METHODS = ('direction', 'nested_measured', 'nested_coping')
# vMF concentrations of the prefiltered levels and the panorama width each is computed at.
LEVELS = ((math.inf, None), (4096, 512), (1024, 256), (256, 128), (64, 128), (16, 64), (4, 64), (1, 64))
QUANTILES = (0.5, 0.9)


def quantiles(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    if not values:
        return None
    return {f'p{int(q * 100)}': round(float(np.quantile(values, q)), 5) for q in QUANTILES} | \
        {'mean': round(float(np.mean(values)), 5), 'count': len(values)}


def endpoint_sums(terminals, values, samples):
    """(1/N) sum(weight * value) per endpoint; values is (terminals, 3)."""
    count = max(t['endpoint'] for t in terminals) + 1
    total = np.zeros((count, 3))
    np.add.at(total, [t['endpoint'] for t in terminals], np.array([t['weight'] for t in terminals])[:, None] * values)
    return total / samples


def preview(image, path, exposure=1.0):
    """Fixed tone curve x/(1+x) of the exposed radiance, then the sRGB transfer; no per-image normalisation."""
    x = image * exposure
    x = x / (1 + x)
    srgb = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 0), 1 / 2.4) - 0.055)
    Image.fromarray((np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dir', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--radiance', type=Path, default=Path('docs/3d-qa/water-radiance/radiance.json'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    with gzip.open(args.dir / 'terminals.json.gz', 'rt') as stream:
        report = json.load(stream)
    endpoints = report['endpoints']
    # As in summarize_water_radiance.py: a truth render whose Position pass is more than 0.1 mm
    # from the hit (edges, crevices of the coping and the spout ribbon) is left out of the colour
    # comparison for both the truth and the capture.
    missed = [t['hit'] is not None and any(v['position_error_m'] > 1e-4 for v in t['truth'].values())
              for t in report['terminals']]
    terminals = [t for t, m in zip(report['terminals'], missed) if not m]
    missed_weight = sum(t['weight'] for t, m in zip(report['terminals'], missed) if m)
    samples = report['lobe_samples']
    probe = np.array(report['probe'])
    radiance = json.loads(args.radiance.read_text())
    if radiance['input_sha256'] != report['input_sha256']:
        raise RuntimeError('radiance.json belongs to a different blend')
    weights = np.array([t['weight'] for t in terminals])
    directions = {m: np.array([t['lookups'][m] or t['direction'] for t in terminals]) for m in METHODS}
    fallback = {m: float(weights[[t['lookups'][m] is None for t in terminals]].sum() / weights.sum()) for m in METHODS}
    surface = np.array([t['hit'] is not None for t in terminals])
    truth_positions = np.array([t['hit']['position'] if t['hit'] else [np.nan] * 3 for t in terminals])
    summary = {'source': {'terminals_sha256': sha(args.dir / 'terminals.json.gz'), 'script_sha256': sha(Path(__file__)),
                          'helper_sha256': sha(Path(__file__).with_name('water_capture_radiance.py')),
                          'radiance_sha256': sha(args.radiance), 'input_sha256': report['input_sha256'],
                          'diagnosis_script_sha256': report['script_sha256']},
               'probe': report['probe'], 'panorama': report['panorama'], 'capture_samples': report['capture_samples'],
               'truth_samples': report['truth_samples_per_pixel'] * report['truth_pixels'],
               'endpoints': len(endpoints), 'terminals': len(terminals), 'lobe_samples': samples,
               'excluded_terminals': sum(missed),
               'excluded_weight_share': missed_weight / sum(t['weight'] for t in report['terminals']),
               'lookup_fallback_share': fallback, 'scenes': {}}
    height, width = report['panorama'][1], report['panorama'][0]
    texel_directions = equirect_directions(height, width)
    widths = [w for w in (2048, 1024, 512, 256, 128, 64, 32) if w <= width and width % w == 0]
    lobe_totals = np.array([e['lobe_total'] for e in endpoints]) / samples
    exit_share = np.array([(e['category_weight'].get('above_water', 0) + e['category_weight'].get('sky', 0)) /
                           e['lobe_total'] for e in endpoints])
    summary['exit_share_of_lobe'] = quantiles(exit_share.tolist())

    for label, scene in report['scenes'].items():
        seeds = [c['seed'] for c in scene['captures']]
        captures = [np.load(args.dir / f'capture-{label}-{s}.npy').astype(np.float64) for s in seeds]
        position = np.load(args.dir / f'position-{label}-{seeds[0]}.npy').astype(np.float64)
        mean = sum(captures) / len(captures)
        entry = {'capture_seconds': [round(c['seconds'], 1) for c in scene['captures']],
                 'truth_seconds': round(scene['truth_seconds'], 1)}

        # Direction mapping: texels that hit a surface must look along position - probe.
        hit = np.linalg.norm(position, axis=-1) > 1e-6
        seen = position[hit] - probe
        seen /= np.linalg.norm(seen, axis=-1, keepdims=True)
        angle = np.degrees(np.arccos(np.clip((seen * texel_directions[hit]).sum(-1), -1, 1)))
        entry['mapping_error_texels'] = {'p50': float(np.median(angle) / (360 / width)),
                                         'p99': float(np.quantile(angle, 0.99) / (360 / width))}
        if entry['mapping_error_texels']['p50'] > 0.5:
            raise RuntimeError(f'{label}: panorama direction mapping is off')

        # Geometry through the rendered capture (camera rays with transmission visibility), nearest texel.
        entry['geometry_match_0.1m'] = {}
        for method in METHODS:
            found = lookup(position, directions[method], bilinear=False)
            ok = surface & (np.linalg.norm(found - truth_positions, axis=-1) <= 0.1)
            entry['geometry_match_0.1m'][method] = float(weights[ok].sum() / weights[surface].sum())

        truth = np.array([t['truth'][label]['rgb'] for t in terminals])
        halves = np.array([t['truth'][label]['halves'] for t in terminals])
        true_sum = endpoint_sums(terminals, truth, samples)
        half_sums = [endpoint_sums(terminals, halves[:, i], samples) for i in range(2)]

        # Endpoints whose lobe never leaves the water have no exit radiance to compare.
        def per_endpoint(estimate):
            return [relative_error(e, t) for e, t in zip(estimate, true_sum) if t.sum() > 0]

        def split(a, b):
            return [float(np.abs(x - y).sum() / (x + y).sum()) for x, y in zip(a, b) if (x + y).sum() > 0]

        # Noise: split-half truth (about the error of the mean) and the capture seeds.
        entry['noise'] = {
            'truth_split_half': quantiles(split(*half_sums)),
            'capture_seeds': quantiles(split(
                *[endpoint_sums(terminals, lookup(c, directions['nested_coping']), samples) for c in captures])),
        }
        entry['monte_carlo'] = {}
        estimates = {}
        for method in METHODS:
            entry['monte_carlo'][method] = {}
            for w in widths:
                image = downsample(mean, width // w)
                estimate = endpoint_sums(terminals, lookup(image, directions[method]), samples)
                estimates[(method, w)] = estimate
                entry['monte_carlo'][method][str(w)] = quantiles(per_endpoint(estimate))
        # Per terminal (not integrated): how far one lookup is from one true radiance.
        best = lookup(mean, directions['nested_coping'])
        entry['per_terminal_relative_error'] = {
            category: quantiles([relative_error(best[i], truth[i]) for i, t in enumerate(terminals)
                                 if t['category'] == category and truth[i].sum() > 0])
            for category in ('above_water', 'sky')}

        # Prefiltered single lookup along the weighted mean lookup direction.
        levels = []
        for kappa, level_width in LEVELS:
            if level_width is None:
                levels.append(mean)
            else:
                levels.append(vmf_prefilter(downsample(mean, width // min(level_width, width)), [kappa])[0])
        log_kappas = np.array([math.log(k) if math.isfinite(k) else math.log(65536) for k, _ in LEVELS])
        prefiltered, kappas = [], []
        for index in range(len(endpoints)):
            mask = np.array([t['endpoint'] == index for t in terminals])
            if not mask.any():
                prefiltered.append(np.zeros(3))
                kappas.append(None)
                continue
            direction, kappa = vmf_kappa(directions['nested_coping'][mask], weights[mask])
            kappas.append(kappa)
            k = min(max(math.log(kappa) if math.isfinite(kappa) else log_kappas[0], log_kappas[-1]), log_kappas[0])
            upper = int(np.searchsorted(-log_kappas, -k))
            lower = max(upper - 1, 0)
            upper = min(upper, len(levels) - 1)
            t = 0 if upper == lower else (log_kappas[lower] - k) / (log_kappas[lower] - log_kappas[upper])
            color = (1 - t) * lookup(levels[lower], direction) + t * lookup(levels[upper], direction)
            prefiltered.append(weights[mask].sum() / samples * color)
        prefiltered = np.array(prefiltered)
        valid = [i for i in range(len(endpoints)) if kappas[i] is not None and true_sum[i].sum() > 0]
        entry['prefiltered'] = {
            'vs_truth': quantiles([relative_error(prefiltered[i], true_sum[i]) for i in valid]),
            'vs_monte_carlo': quantiles([relative_error(prefiltered[i], estimates[('nested_coping', width)][i])
                                         for i in valid]),
            'kappa': quantiles([kappas[i] for i in valid]),
        }

        # Against the source Combined of the 19 radiance points (same scene, path direction, seed mean).
        combined = {}
        for render in radiance['renders']:
            if render.get('mode') == 'path' and render.get('scene') == label and 'passes' in render:
                combined.setdefault(render['index'], []).append(render)
        rows = []
        for index, e in enumerate(endpoints):
            if e['radiance_index'] is None or e['radiance_index'] not in combined:
                continue
            renders = combined[e['radiance_index']]
            c = np.mean([r['colors']['combined'] for r in renders], axis=0)
            glossy = np.mean([r['colors']['glossy'] for r in renders], axis=0)
            rows.append({'radiance_index': e['radiance_index'], 'group': radiance['selected'][e['radiance_index']]['group'],
                         'combined': c.tolist(), 'glossy': glossy.tolist(), 'exit_true': true_sum[index].tolist(),
                         'exit_share_of_glossy': float(true_sum[index].sum() / glossy.sum()) if glossy.sum() > 0 else None,
                         'omitted_of_combined': float(true_sum[index].sum() / c.sum()),
                         'capture_mc_error_of_combined': float(
                             np.abs(estimates[('nested_coping', width)][index] - true_sum[index]).sum() / c.sum()),
                         'prefiltered_error_of_combined': float(np.abs(prefiltered[index] - true_sum[index]).sum() / c.sum())})
        entry['radiance_points'] = {
            'rows': rows,
            **{key: quantiles([r[key] for r in rows]) for key in
               ('exit_share_of_glossy', 'omitted_of_combined', 'capture_mc_error_of_combined',
                'prefiltered_error_of_combined')}}
        entry['endpoint_rows'] = [{'pixel': e['pixel'], 'first_exit': e['first_exit'], 'material': e['material'],
                                   'exit_share': float(exit_share[i]), 'lobe_mean_weight': float(lobe_totals[i]),
                                   'true': true_sum[i].tolist(),
                                   'capture_mc': estimates[('nested_coping', width)][i].tolist(),
                                   'prefiltered': prefiltered[i].tolist(), 'kappa': kappas[i]}
                                  for i, e in enumerate(endpoints)]
        summary['scenes'][label] = entry
        preview(downsample(mean, width // min(width, 1024)), args.out / f'capture-{label}.png',
                exposure=1.0 if label == 'day' else 4.0)

    # Storage of one capture as float16 RGBA (half floats, as a WebGL HDR texture), with a full mip chain.
    summary['storage_bytes_per_scene'] = {
        f'equirect_{w}x{w // 2}': int(w * (w // 2) * 8 * 4 / 3) for w in widths} | {
        f'cube_{w // 4}': int(6 * (w // 4) ** 2 * 8 * 4 / 3) for w in widths if w >= 128}
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: v for k, v in summary.items() if k != 'scenes'}, indent=1))
    for label, entry in summary['scenes'].items():
        print(label, json.dumps({k: v for k, v in entry.items() if k not in ('endpoint_rows', 'radiance_points')},
                                indent=1))
        print(label, 'radiance points', json.dumps({k: v for k, v in entry['radiance_points'].items() if k != 'rows'}))


if __name__ == '__main__':
    main()
