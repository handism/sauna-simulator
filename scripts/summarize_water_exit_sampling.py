"""How many lobe samples a shader needs for the light that leaves the water (python3, NumPy; no Blender).

python3 scripts/summarize_water_exit_sampling.py blender/diagnostics/water-capture-radiance --out docs/3d-qa/water-exit-sampling

DIR is the output of diagnose_water_capture_radiance.py. Its terminals give the
true glossy radiance that each endpoint's 64-sample lobe brings from above the
water, traced through the source water shape and rendered by Cycles. Here the
same lobes are integrated as a shader could: N GGX samples (a Hammersley set
with a random rotation per trial), refracted through the flat water plane
(optionally with the static wave normal), box-projected into the capture
(tub box topped at the coping, inside the courtyard box) and looked up. The
error of this estimate against the truth is split into the model bias (4096
samples) and the sampling noise of N samples. The lobe samples of the
diagnosis are reproduced exactly (same seeds), which is checked.
"""
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import random
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from diagnose_water_reflection_targets import glb_materials, stratified  # noqa: E402
from water_capture_radiance import downsample, lookup, relative_error  # noqa: E402
from water_exit_sampling import exit_samples, flat_normal, hammersley, wave_normal  # noqa: E402
from water_reflection_trace import dot, normalize, sample_ggx_reflection, schlick  # noqa: E402

COUNTS = (1, 2, 4, 8, 16, 32, 64)
TRIALS = 32
CONVERGED = 4096
WIDTHS = (2048, 128)
PROXY = 'nested_coping'


def quantiles(values):
    values = [v for v in values if v is not None and math.isfinite(v)]
    if not values:
        return None
    return {'p50': round(float(np.quantile(values, 0.5)), 5), 'p90': round(float(np.quantile(values, 0.9)), 5),
            'mean': round(float(np.mean(values)), 5), 'count': len(values)}


def material_group(name):
    return 'bronze' if 'bronze' in name else 'tile' if 'tile' in name else 'stone' if 'honed' in name else 'other'


def median_of(summaries, key):
    return round(float(np.median([s[key] for s in summaries])), 5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dir', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--trace', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--glb', type=Path, default=Path('public/models/sauna.glb'))
    parser.add_argument('--scene-definition', type=Path, default=Path('public/models/sauna.scene.json'))
    parser.add_argument('--radiance', type=Path, default=Path('docs/3d-qa/water-radiance/radiance.json'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    with gzip.open(args.dir / 'terminals.json.gz', 'rt') as stream:
        report = json.load(stream)
    if sha(args.glb) != report['glb_sha256'] or sha(args.trace / 'trace-rays.json.gz') != report['trace_sha256']:
        raise RuntimeError('GLB or trace differ from the capture radiance diagnosis')
    radiance = json.loads(args.radiance.read_text())
    if radiance['input_sha256'] != report['input_sha256']:
        raise RuntimeError('radiance.json belongs to a different blend')
    level = json.loads(args.scene_definition.read_text())['water']['center'][1]
    if abs(level - json.loads((args.trace / 'trace-summary.json').read_text())['flat_level']) > 1e-9:
        raise RuntimeError('Flat water level differs from the path diagnosis')
    with gzip.open(args.trace / 'trace-rays.json.gz', 'rt') as stream:
        reached = [r for r in json.load(stream)['original'] if r.get('hit') and r['events']]
    materials = glb_materials(args.glb)
    # The source water's sides and bottom, topped by the runtime's flat level.
    (x0, y0, z0), (x1, y1, _) = report['water_bounds']
    lower, upper = (x0, y0, z0), (x1, y1, level)
    probe = tuple(report['probe'])
    boxes = [[tuple(v) for v in box] for box in report['proxies'][PROXY]]
    endpoints, terminals = report['endpoints'], report['terminals']
    samples = report['lobe_samples']

    # Estimates are sums of weight x lookup over sample groups: (endpoint, variant, count, trial).
    groups, group_sizes, rows, weights, directions = {}, [], [], [], []

    def add(key, size, found):
        index = groups.setdefault(key, len(groups))
        if index == len(group_sizes):
            group_sizes.append(size)
        for weight, direction in found:
            rows.append(index)
            weights.append(weight)
            directions.append(direction)

    above_level = 0
    for e_index, e in enumerate(endpoints):
        record = reached[e['reached_index']]
        hit = record['hit']
        point = tuple(hit['position'])
        view = normalize(tuple(a - b for a, b in zip(record['events'][-1]['position'], point)))
        normal = normalize(hit['normal'])
        if dot(view, normal) < 0:
            normal = tuple(-n for n in normal)
        params = materials.get(hit['material'], {'roughness': 0.5, 'f0': 0.04})
        alpha = max(params['roughness'], 1e-3) ** 2
        above_level += point[2] >= upper[2]
        grid = stratified(samples, random.Random(e['reached_index']))
        total = 0.0
        for u1, u2 in grid:
            sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
            if sample is not None:
                total += sample[1] * schlick(params['f0'], sample[2])
        if abs(total - e['lobe_total']) > 1e-9:
            raise RuntimeError(f'Lobe samples of endpoint {e_index} are not reproduced')
        for variant, surface in (('flat', flat_normal), ('wave', wave_normal)):
            common = (point, view, normal, alpha, params['f0'])
            tail = (lower, upper, probe, boxes, surface)
            add((e_index, variant, 'same_grid', 0), samples, exit_samples(*common, grid, *tail))
            add((e_index, variant, CONVERGED, 0), CONVERGED, exit_samples(*common, hammersley(CONVERGED), *tail))
            for count in COUNTS:
                for trial in range(TRIALS):
                    rng = random.Random(f'{e_index}/{count}/{trial}')
                    uvs = hammersley(count, (rng.random(), rng.random()))
                    add((e_index, variant, count, trial), count, exit_samples(*common, uvs, *tail))
    rows, weights, directions = np.array(rows), np.array(weights), np.array(directions)
    group_sizes = np.array(group_sizes, dtype=np.float64)

    def estimates(image):
        total = np.zeros((len(groups), 3))
        np.add.at(total, rows, weights[:, None] * lookup(image, directions))
        return total / group_sizes[:, None]

    exit_weight = np.zeros(len(groups))
    np.add.at(exit_weight, rows, weights)
    exit_weight /= group_sizes

    def endpoint_sums(values):
        total = np.zeros((len(endpoints), 3))
        np.add.at(total, [t['endpoint'] for t in terminals], np.array([t['weight'] for t in terminals])[:, None] * values)
        return total / samples

    # A truth render whose Position pass missed the hit by more than 0.1 mm (see
    # summarize_water_capture_radiance.py) is replaced by the capture's lookup for that terminal.
    missed = np.array([t['hit'] is not None and any(v['position_error_m'] > 1e-4 for v in t['truth'].values())
                       for t in terminals])
    terminal_directions = np.array([t['lookups'][PROXY] or t['direction'] for t in terminals])
    true_exit_weight = endpoint_sums(np.ones((len(terminals), 3)))[:, 0]

    summary = {'source': {'terminals_sha256': sha(args.dir / 'terminals.json.gz'), 'script_sha256': sha(Path(__file__)),
                          'helper_sha256': {name: sha(Path(__file__).with_name(name)) for name in
                                            ('water_exit_sampling.py', 'water_capture_radiance.py',
                                             'water_capture_parallax.py', 'water_reflection_trace.py')},
                          'glb_sha256': report['glb_sha256'], 'trace_sha256': report['trace_sha256'],
                          'scene_definition_sha256': sha(args.scene_definition), 'radiance_sha256': sha(args.radiance),
                          'input_sha256': report['input_sha256']},
               'coordinates': 'Blender Z-up, meters', 'level': level, 'water_box': [lower, upper], 'probe': probe,
               'boxes': boxes, 'endpoints': len(endpoints), 'endpoints_above_level': int(above_level),
               'lobe_samples': samples, 'counts': COUNTS, 'trials': TRIALS, 'converged_samples': CONVERGED,
               'truth_filled_terminals': int(missed.sum()),
               'truth_filled_weight_share': float(np.array([t['weight'] for t in terminals])[missed].sum() /
                                                  sum(t['weight'] for t in terminals)),
               'scenes': {}}

    # Exit weight (no radiance): how much of the lobe the plane model lets out, against the trace.
    valid_weight = true_exit_weight > 0
    summary['exit_weight_ratio'] = {
        variant: {key: quantiles((exit_weight[[groups[(i, variant, key, 0)] for i in range(len(endpoints))]]
                                  [valid_weight] / true_exit_weight[valid_weight]).tolist())
                  for key in ('same_grid', CONVERGED)} for variant in ('flat', 'wave')}

    for label, scene in report['scenes'].items():
        seeds = [c['seed'] for c in scene['captures']]
        full = sum(np.load(args.dir / f'capture-{label}-{s}.npy').astype(np.float64) for s in seeds) / len(seeds)
        truth_rgb = np.array([t['truth'][label]['rgb'] for t in terminals])
        truth_rgb[missed] = lookup(full, terminal_directions[missed])
        truth = endpoint_sums(truth_rgb)
        valid = [i for i in range(len(endpoints)) if truth[i].sum() > 0]
        combined = {}
        for render in radiance['renders']:
            if render.get('mode') == 'path' and render.get('scene') == label and 'passes' in render:
                combined.setdefault(render['index'], []).append(np.array(render['colors']['combined']))
        points = [(i, np.mean(combined[e['radiance_index']], axis=0)) for i, e in enumerate(endpoints)
                  if e['radiance_index'] in combined and truth[i].sum() > 0]
        entry = {'widths': {}}
        for width in WIDTHS:
            image = downsample(full, full.shape[1] // width)
            estimate = estimates(image)

            def errors(variant, key, trial=0):
                return [relative_error(estimate[groups[(i, variant, key, trial)]], truth[i]) for i in valid]

            def of_combined(variant, key, trial=0):
                return [float(np.abs(estimate[groups[(i, variant, key, trial)]] - truth[i]).sum() / c.sum())
                        for i, c in points]

            result = {'terminals_mc': quantiles([relative_error(e, truth[i]) for i, e in
                                                 enumerate(endpoint_sums(lookup(image, terminal_directions)))
                                                 if i in valid])}
            for variant in ('flat', 'wave'):
                converged = estimate[[groups[(i, variant, CONVERGED, 0)] for i in valid]]
                model_weight = exit_weight[[groups[(i, variant, CONVERGED, 0)] for i in valid]]
                # Oracle occlusion: the converged estimate rescaled to the traced exit weight, leaving
                # only the colour and direction error of the plane-and-box walk.
                scaled = [relative_error(c * true_exit_weight[i] / w, truth[i])
                          for i, c, w in zip(valid, converged, model_weight) if w > 0]
                by_group = {}
                for i, error in zip(valid, errors(variant, CONVERGED)):
                    by_group.setdefault(material_group(endpoints[i]['material']), []).append(error)
                result[variant] = {'same_grid': quantiles(errors(variant, 'same_grid')),
                                   'converged': quantiles(errors(variant, CONVERGED)),
                                   'converged_by_material': {k: quantiles(v) for k, v in sorted(by_group.items())},
                                   'converged_oracle_exit_weight': quantiles(scaled),
                                   'converged_of_combined': quantiles(of_combined(variant, CONVERGED)),
                                   'converged_of_combined_by_material': {
                                       name: quantiles([x for (i, _), x in zip(points, of_combined(variant, CONVERGED))
                                                        if material_group(endpoints[i]['material']) == name])
                                       for name in sorted({material_group(endpoints[i]['material'])
                                                           for i, _ in points})},
                                   'counts': {}}
                for count in COUNTS:
                    per_trial = [quantiles(errors(variant, count, trial)) for trial in range(TRIALS)]
                    combined_trial = [quantiles(of_combined(variant, count, trial)) for trial in range(TRIALS)]
                    # Sampling noise alone: the N-sample estimate against the converged model.
                    noise = [quantiles([relative_error(estimate[groups[(i, variant, count, trial)]], c)
                                        for i, c in zip(valid, converged) if c.sum() > 0]) for trial in range(TRIALS)]
                    groups_trial = {}
                    for trial in range(TRIALS):
                        split = {}
                        for i, error in zip(valid, errors(variant, count, trial)):
                            split.setdefault(material_group(endpoints[i]['material']), []).append(error)
                        for name, values in split.items():
                            groups_trial.setdefault(name, []).append(quantiles(values))
                    result[variant]['counts'][str(count)] = {
                        'vs_truth': {k: median_of(per_trial, k) for k in ('p50', 'p90', 'mean')},
                        'vs_truth_by_material': {name: {k: median_of(v, k) for k in ('p50', 'p90', 'mean')}
                                                 for name, v in sorted(groups_trial.items())},
                        'vs_converged': {k: median_of(noise, k) for k in ('p50', 'p90', 'mean')},
                        'of_combined': {k: median_of(combined_trial, k) for k in ('p50', 'p90', 'mean')},
                        'pooled_vs_truth': quantiles([x for t in range(TRIALS) for x in errors(variant, count, t)])}
            entry['widths'][str(width)] = result
        small = estimates(downsample(full, full.shape[1] // 128))
        entry['endpoint_rows'] = [{'index': i, 'material': endpoints[i]['material'],
                                   'radiance_index': endpoints[i]['radiance_index'],
                                   'position': endpoints[i]['position'],
                                   'true': truth[i].tolist(),
                                   'flat_converged_128': small[groups[(i, 'flat', CONVERGED, 0)]].tolist(),
                                   'true_exit_weight': float(true_exit_weight[i]),
                                   'flat_exit_weight': float(exit_weight[groups[(i, 'flat', CONVERGED, 0)]])}
                                  for i in range(len(endpoints))]
        summary['scenes'][label] = entry

    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: v for k, v in summary.items() if k not in ('scenes', 'source')}, indent=1))
    for label, entry in summary['scenes'].items():
        for width, result in entry['widths'].items():
            print(label, width, 'terminals', result['terminals_mc'])
            for variant in ('flat', 'wave'):
                r = result[variant]
                print(f'  {variant} same_grid', r['same_grid'], 'converged', r['converged'],
                      'of_combined', r['converged_of_combined'])
                print('    oracle', r['converged_oracle_exit_weight'], 'by material', r['converged_by_material'])
                for count, c in r['counts'].items():
                    print(f'    N={count:>2} truth', c['vs_truth'], 'noise', c['vs_converged'], 'comb', c['of_combined'])


if __name__ == '__main__':
    main()
