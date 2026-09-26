"""Does a baked underwater occlusion table fix the box walk of the light that leaves the water? (python3, NumPy)

python3 scripts/summarize_water_exit_visibility.py blender/diagnostics/water-capture-radiance
    blender/diagnostics/water-exit-visibility --out docs/3d-qa/water-exit-visibility

The first directory is the output of diagnose_water_capture_radiance.py (truth
and capture), the second that of diagnose_water_exit_visibility.py (traced exit
weight per fixed direction at the endpoints and at the grid nodes around them).
The lobes are sampled and walked through the water box exactly as in
summarize_water_exit_sampling.py; each lobe sample is then scaled by the
direction-binned ratio of traced to box exit weight (water_exit_visibility.py),
taken at the endpoint itself or trilinearly from grids of several spacings, for
octahedral maps of 1 x 1 (a scalar) to 8 x 8 bins. The box walk's exit weight
at every baked position is computed here with the same fixed directions.
Two more candidates: a floor horizon map (at the endpoint or bilinear from 2D
floor grids, 8 or 16 azimuths) that drops samples below the horizon, and a
constant for the bronze plinth seen through the tile joints (zero, or the
traced / box exit weight of the other bronze endpoints). Errors are reported
per material against the truth and against the path's Combined (19 points).
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
from summarize_water_exit_sampling import PROXY, material_group, median_of, quantiles  # noqa: E402
from water_capture_radiance import downsample, lookup, relative_error  # noqa: E402
from water_exit_sampling import exit_samples, flat_normal, hammersley, water_exits, wave_normal  # noqa: E402
from water_exit_visibility import (Grid, corrected_ratio, fibonacci_sphere, horizon_visible,  # noqa: E402
                                   interpolate_horizon, octahedral_bins)
from water_reflection_trace import dot, normalize, sample_ggx_reflection, schlick  # noqa: E402

COUNTS = (8, 16)
TRIALS = 32
CONVERGED = 4096
WIDTH = 128
SIZES = (1, 2, 4, 8)
AZIMUTHS = (8, 16)
VARIANTS = {'flat': flat_normal, 'wave': wave_normal}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    parser.add_argument('visibility', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--trace', type=Path, default=Path('docs/3d-qa/water-side-continuation'))
    parser.add_argument('--glb', type=Path, default=Path('public/models/sauna.glb'))
    parser.add_argument('--scene-definition', type=Path, default=Path('public/models/sauna.scene.json'))
    parser.add_argument('--radiance', type=Path, default=Path('docs/3d-qa/water-radiance/radiance.json'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    terminals_path = args.capture / 'terminals.json.gz'
    with gzip.open(terminals_path, 'rt') as stream:
        report = json.load(stream)
    with gzip.open(args.visibility / 'visibility.json.gz', 'rt') as stream:
        baked = json.load(stream)
    if baked['terminals_sha256'] != sha(terminals_path) or baked['input_sha256'] != report['input_sha256']:
        raise RuntimeError('The visibility bake belongs to different terminals')
    if sha(args.glb) != report['glb_sha256'] or sha(args.trace / 'trace-rays.json.gz') != report['trace_sha256']:
        raise RuntimeError('GLB or trace differ from the capture radiance diagnosis')
    radiance = json.loads(args.radiance.read_text())
    if radiance['input_sha256'] != report['input_sha256']:
        raise RuntimeError('radiance.json belongs to a different blend')
    level = json.loads(args.scene_definition.read_text())['water']['center'][1]
    with gzip.open(args.trace / 'trace-rays.json.gz', 'rt') as stream:
        reached = [r for r in json.load(stream)['original'] if r.get('hit') and r['events']]
    materials = glb_materials(args.glb)
    (x0, y0, z0), (x1, y1, _) = report['water_bounds']
    lower, upper = (x0, y0, z0), (x1, y1, level)
    probe = tuple(report['probe'])
    boxes = [[tuple(v) for v in box] for box in report['proxies'][PROXY]]
    endpoints, terminals = report['endpoints'], report['terminals']
    samples = report['lobe_samples']

    # The baked table: traced (Blender) and box-walk exit weight per fixed direction, summed per bin.
    directions = fibonacci_sphere(baked['directions'])
    bins = {size: octahedral_bins(directions, size) for size in SIZES}

    def per_bin(values, size):
        return np.bincount(bins[size], weights=values, minlength=size * size)

    tables = {}  # (kind key, variant, size) -> (traced bins, box bins)
    for position in baked['positions']:
        point = tuple(position['position'])
        key = ('endpoint', position['endpoint']) if position['kind'] == 'endpoint' else \
            (position['spacing'], tuple(position['index']))
        traced = np.array(position['traced'])
        for variant, surface in VARIANTS.items():
            if point[2] >= upper[2]:
                box = np.ones(len(directions))
            else:
                box = np.array([sum(w for _, _, w in water_exits(point, d, lower, upper, surface)) for d in directions])
            for size in SIZES:
                tables[(key, variant, size)] = (per_bin(traced, size), per_bin(box, size))
    valid = {(('endpoint', p['endpoint']) if p['kind'] == 'endpoint' else (p['spacing'], tuple(p['index']))):
             p['kind'] == 'endpoint' or p['valid'] for p in baked['positions']}
    grids = {float(s): Grid(g['lower'], [lo + n * g['spacing'] for lo, n in zip(g['lower'], g['counts'])],
                            g['spacing']) for s, g in baked['grids'].items()}
    spacings = ['endpoint'] + sorted(grids)

    # Per endpoint, variant, spacing and size: the ratio of each bin.
    ratios, all_invalid = {}, {str(s): 0 for s in spacings}
    for e_index, e in enumerate(endpoints):
        for spacing in spacings:
            if spacing == 'endpoint':
                corners = [(('endpoint', e_index), 1.0)]
            else:
                corners = [((spacing, k), w) for k, w in grids[spacing].corners(e['position'])]
                all_invalid[str(spacing)] += not any(valid[c] for c, _ in corners)
            for variant in VARIANTS:
                for size in SIZES:
                    traced = {c: tables[(c, variant, size)][0] for c, _ in corners}
                    box = {c: tables[(c, variant, size)][1] for c, _ in corners}
                    ratios[(e_index, variant, spacing, size)] = np.array(
                        corrected_ratio(corners, traced, box, {c: valid[c] for c, _ in corners}))

    # Lobe samples through the box, as summarize_water_exit_sampling.py (same seeds, checked).
    groups, group_sizes, rows, weights, lookups, sample_dirs = {}, [], [], [], [], []

    def add(key, size, found):
        index = groups.setdefault(key, len(groups))
        if index == len(group_sizes):
            group_sizes.append(size)
        for weight, direction, sample in found:
            rows.append(index)
            weights.append(weight)
            lookups.append(direction)
            sample_dirs.append(sample)

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
        total = 0.0
        for u1, u2 in stratified(samples, random.Random(e['reached_index'])):
            sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
            if sample is not None:
                total += sample[1] * schlick(params['f0'], sample[2])
        if abs(total - e['lobe_total']) > 1e-9:
            raise RuntimeError(f'Lobe samples of endpoint {e_index} are not reproduced')
        for variant, surface in VARIANTS.items():
            common = (point, view, normal, alpha, params['f0'])
            tail = (lower, upper, probe, boxes, surface)
            add((e_index, variant, CONVERGED, 0), CONVERGED,
                exit_samples(*common, hammersley(CONVERGED), *tail, with_sample=True))
            for count in COUNTS:
                for trial in range(TRIALS):
                    rng = random.Random(f'{e_index}/{count}/{trial}')
                    uvs = hammersley(count, (rng.random(), rng.random()))
                    add((e_index, variant, count, trial), count, exit_samples(*common, uvs, *tail, with_sample=True))
    rows, weights = np.array(rows), np.array(weights)
    lookups, sample_dirs = np.array(lookups), np.array(sample_dirs)
    group_sizes = np.array(group_sizes, dtype=np.float64)
    keys = list(groups)
    row_endpoint = np.array([keys[g][0] for g in rows])
    row_variant = np.array([keys[g][1] for g in rows])
    sample_bins = {size: octahedral_bins(sample_dirs, size) for size in SIZES}

    def factors(spacing, size):
        table = np.zeros((len(endpoints), len(VARIANTS), size * size))
        for (e_index, variant, s, z), ratio in ratios.items():
            if s == spacing and z == size:
                table[e_index, list(VARIANTS).index(variant)] = ratio
        variant_index = np.array([list(VARIANTS).index(v) for v in row_variant])
        return table[row_endpoint, variant_index, sample_bins[size]]

    corrections = {'none': np.ones(len(rows))}
    for spacing in spacings:
        for size in SIZES:
            corrections[f'{spacing}/{size}'] = factors(spacing, size)

    # Floor horizon maps: a lobe sample below the (bilinearly mixed) horizon of a floor endpoint is dropped.
    horizon_data = baked['horizons']
    floor_grids = {}
    for s, g in horizon_data['grids'].items():
        upper_xy = [lo + n * g['spacing'] for lo, n in zip(g['lower'], g['counts'])]
        floor_grids[float(s)] = (Grid((*g['lower'], 0.0), (*upper_xy, g['spacing']), g['spacing']),
                                 {tuple(n['index']): n.get('horizon') for n in g['nodes']})
    floor_spacings = ['endpoint'] + sorted(floor_grids)
    for spacing in floor_spacings:
        for azimuths in AZIMUTHS:
            step = horizon_data['azimuths'] // azimuths
            table, floor_mask = np.zeros((len(endpoints), azimuths)), np.zeros(len(endpoints), dtype=bool)
            for key, value in horizon_data['endpoints'].items():
                if spacing == 'endpoint':
                    found = value['horizon']
                else:
                    grid, nodes = floor_grids[spacing]
                    x, y, _ = value['position']
                    found = interpolate_horizon(grid.corners((x, y, 0.0)), nodes)
                if found is not None:
                    table[int(key)], floor_mask[int(key)] = found[::step], True
            visible = horizon_visible(sample_dirs, table[row_endpoint])
            corrections[f'horizon/{spacing}/{azimuths}'] = np.where(floor_mask[row_endpoint], visible, 1.0)

    def endpoint_sums(values):
        total = np.zeros((len(endpoints), 3))
        np.add.at(total, [t['endpoint'] for t in terminals], np.array([t['weight'] for t in terminals])[:, None] * values)
        return total / samples

    missed = np.array([t['hit'] is not None and any(v['position_error_m'] > 1e-4 for v in t['truth'].values())
                       for t in terminals])
    terminal_directions = np.array([t['lookups'][PROXY] or t['direction'] for t in terminals])
    true_exit_weight = endpoint_sums(np.ones((len(terminals), 3)))[:, 0]
    group_of = [material_group(e['material']) for e in endpoints]
    names = sorted(set(group_of))

    def exit_weight(factor):
        total = np.zeros(len(groups))
        np.add.at(total, rows, weights * factor)
        return total / group_sizes

    # The bronze is the plinth seen through the tile joints (a few mm wide), below any texel. A constant
    # per material instead: no light from above the water, or the traced / box exit weight of the other
    # bronze endpoints (leave one out).
    bronze = np.array([g == 'bronze' for g in group_of])
    model_exit = exit_weight(np.ones(len(rows)))
    zero, loo = np.ones((len(endpoints), len(VARIANTS))), np.ones((len(endpoints), len(VARIANTS)))
    bronze_constants = {}
    for v, variant in enumerate(VARIANTS):
        model = np.array([model_exit[groups[(i, variant, CONVERGED, 0)]] for i in range(len(endpoints))])
        zero[bronze, v] = 0.0
        for i in np.flatnonzero(bronze):
            others = bronze & (np.arange(len(endpoints)) != i)
            loo[i, v] = true_exit_weight[others].sum() / model[others].sum()
        bronze_constants[variant] = float(true_exit_weight[bronze].sum() / model[bronze].sum())
    variant_index = np.array([list(VARIANTS).index(v) for v in row_variant])
    corrections['bronze_zero'] = zero[row_endpoint, variant_index]
    corrections['bronze_constant_loo'] = loo[row_endpoint, variant_index]

    summary = {'source': {'terminals_sha256': sha(terminals_path),
                          'visibility_sha256': sha(args.visibility / 'visibility.json.gz'),
                          'script_sha256': sha(Path(__file__)),
                          'helper_sha256': {name: sha(Path(__file__).with_name(name)) for name in
                                            ('water_exit_visibility.py', 'water_exit_sampling.py',
                                             'summarize_water_exit_sampling.py', 'water_capture_radiance.py')},
                          'glb_sha256': report['glb_sha256'], 'trace_sha256': report['trace_sha256'],
                          'scene_definition_sha256': sha(args.scene_definition), 'radiance_sha256': sha(args.radiance),
                          'input_sha256': report['input_sha256']},
               'coordinates': 'Blender Z-up, meters', 'level': level, 'water_box': [lower, upper],
               'bake_directions': baked['directions'], 'bake_domain': baked['domain'], 'sizes': SIZES,
               'counts': COUNTS, 'trials': TRIALS, 'converged_samples': CONVERGED, 'capture_width': WIDTH,
               'endpoints_by_material': {n: group_of.count(n) for n in names},
               'horizon_azimuths': AZIMUTHS, 'grids': {}, 'floor_grids': {}, 'exit_weight_ratio': {},
               'scenes': {}}
    for spacing, grid in grids.items():
        baked_nodes = [p for p in baked['positions'] if p['kind'] == 'node' and p['spacing'] == spacing]
        summary['grids'][str(spacing)] = {
            'counts': list(grid.counts), 'full_grid_nodes': math.prod(grid.counts),
            'baked_nodes': len(baked_nodes), 'invalid_nodes': sum(not p['valid'] for p in baked_nodes),
            'endpoints_without_valid_corner': all_invalid[str(spacing)],
            'values_per_size': {str(s): math.prod(grid.counts) * s * s for s in SIZES}}

    for spacing, (grid, nodes) in floor_grids.items():
        summary['floor_grids'][str(spacing)] = {
            'counts': list(grid.counts[:2]), 'full_grid_texels': math.prod(grid.counts[:2]),
            'baked_nodes': len(nodes), 'nodes_without_floor': sum(h is None for h in nodes.values()),
            'values_per_azimuths': {str(a): math.prod(grid.counts[:2]) * a for a in AZIMUTHS}}
    summary['floor_endpoints'] = len(horizon_data['endpoints'])
    summary['bronze_constant_all'] = bronze_constants

    # Exit weight alone (no radiance): the corrected walk against the trace, per material.
    for variant in VARIANTS:
        converged = [groups[(i, variant, CONVERGED, 0)] for i in range(len(endpoints))]
        result = {}
        for name, factor in corrections.items():
            ratio = exit_weight(factor)[converged] / np.maximum(true_exit_weight, 1e-12)
            result[name] = {'all': quantiles(ratio[true_exit_weight > 0].tolist()),
                            **{g: quantiles([r for r, m, t in zip(ratio, group_of, true_exit_weight)
                                             if m == g and t > 0]) for g in names}}
        summary['exit_weight_ratio'][variant] = result

    for label, scene in report['scenes'].items():
        seeds = [c['seed'] for c in scene['captures']]
        full = sum(np.load(args.capture / f'capture-{label}-{s}.npy').astype(np.float64) for s in seeds) / len(seeds)
        truth_rgb = np.array([t['truth'][label]['rgb'] for t in terminals])
        truth_rgb[missed] = lookup(full, terminal_directions[missed])
        truth = endpoint_sums(truth_rgb)
        use = [i for i in range(len(endpoints)) if truth[i].sum() > 0]
        combined = {}
        for render in radiance['renders']:
            if render.get('mode') == 'path' and render.get('scene') == label and 'passes' in render:
                combined.setdefault(render['index'], []).append(np.array(render['colors']['combined']))
        points = [(i, np.mean(combined[e['radiance_index']], axis=0)) for i, e in enumerate(endpoints)
                  if e['radiance_index'] in combined and truth[i].sum() > 0]
        colors = lookup(downsample(full, full.shape[1] // WIDTH), lookups)
        entry = {}
        for variant in VARIANTS:
            result = {}
            for name, factor in corrections.items():
                estimate = np.zeros((len(groups), 3))
                np.add.at(estimate, rows, (weights * factor)[:, None] * colors)
                estimate /= group_sizes[:, None]

                def errors(key, trial=0):
                    return {i: relative_error(estimate[groups[(i, variant, key, trial)]], truth[i]) for i in use}

                def by_material(values):
                    return {'all': quantiles(list(values.values())),
                            **{g: quantiles([v for i, v in values.items() if group_of[i] == g]) for g in names}}

                of_combined = {i: float(np.abs(estimate[groups[(i, variant, CONVERGED, 0)]] - truth[i]).sum() / c.sum())
                               for i, c in points}
                result[name] = {'converged': by_material(errors(CONVERGED)),
                                'converged_of_combined': by_material(of_combined), 'counts': {}}
                for count in COUNTS:
                    trials = [by_material(errors(count, t)) for t in range(TRIALS)]
                    result[name]['counts'][str(count)] = {
                        g: {k: median_of([t[g] for t in trials if t[g]], k) for k in ('p50', 'p90', 'mean')}
                        for g in ['all'] + names if trials[0][g]}
                if name == 'none':
                    converged = estimate[[groups[(i, variant, CONVERGED, 0)] for i in use]]
                    model = exit_weight(factor)[[groups[(i, variant, CONVERGED, 0)] for i in use]]
                    # Oracle: rescaled to the traced exit weight (summarize_water_exit_sampling.py).
                    result['oracle'] = {'converged': by_material(
                        {i: relative_error(c * true_exit_weight[i] / w, truth[i])
                         for i, c, w in zip(use, converged, model) if w > 0})}
            entry[variant] = result
        summary['scenes'][label] = entry

    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: summary[k] for k in ('endpoints_by_material', 'grids', 'floor_grids')}))
    shown = lambda name: name in ('none', 'oracle', 'endpoint/8', '0.1/1', 'horizon/endpoint/8', 'horizon/0.025/16') or name.startswith('bronze')
    for variant in VARIANTS:
        for name, r in summary['exit_weight_ratio'][variant].items():
            if not shown(name):
                continue
            print('exit', variant, name, {g: v and (v['p50'], v['p90']) for g, v in r.items()})
    for label, entry in summary['scenes'].items():
        for variant, result in entry.items():
            for name, r in result.items():
                if not shown(name):
                    continue
                c = r['converged']
                line = {g: v and (v['p50'], v['p90']) for g, v in c.items()}
                extra = r.get('counts', {}).get('8', {}).get('all')
                comb = {g: v and (v['p50'], v['p90']) for g, v in r.get('converged_of_combined', {}).items()}
                print(label, variant, name, line, 'N=8', extra and (extra['p50'], extra['p90']), 'comb', comb)


if __name__ == '__main__':
    main()
