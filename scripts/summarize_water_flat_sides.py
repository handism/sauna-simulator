"""Compare the Cycles glossy passes and renders before and after flatten_water_sides.py.

python3 scripts/summarize_water_flat_sides.py V11_GLOSS_DIR FIXED_GLOSS_DIR --out DIR
    [--renders blender/renders --before-renders blender/renders/v11 ...]

V11_GLOSS_DIR is diagnose_water_gloss_mismatch.py run on the V11 source (base = every
water face smooth, flat = every face flat), FIXED_GLOSS_DIR the same run on the fixed
blend with the shading variants. The fixed blend must be a shading-only child of the
V11 one (blend_lineage.py) and both runs must use the same endpoints and seeds. Writes
summary.json with the glossy pass GlossCol x (GlossDir + GlossInd) per endpoint, the
ratio of the fixed source to the fully flat V11 water (what the geometric-normal traces
assumed), and, for each pair of renders, how much and where the image changed plus a
difference map (requires Pillow).
"""
import argparse
import json
from pathlib import Path
import statistics
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from blend_lineage import SHADING_ONLY  # noqa: E402

RENDERS = ('01', '02', '03', '04', '05', '06', '07')
BLUEHOUR = ('02', '03', '04', '05', '07')
THRESHOLD = 8  # 8-bit sRGB step of the largest channel counted as a visible change
MAP_SHARE = 0.001  # difference maps are written only for renders that changed more than this


def glossy(passes):
    return sum(c * (d + i) for c, d, i in zip(passes['GlossCol'], passes['GlossDir'], passes['GlossInd']))


def glossy_table(report):
    """{(scene, variant, index): [glossy per seed]}"""
    table = {}
    for render in report['renders']:
        key = (render['scene'], render['variant'], render['index'])
        table.setdefault(key, []).append(glossy(render['passes']))
    return table


def ratio_stats(values):
    return {'median': statistics.median(values), 'min': min(values), 'max': max(values)}


def image_change(before, after):
    """Mean absolute 8-bit difference, share of pixels whose largest channel moved more than
    THRESHOLD, the bounding box of those pixels (x0, y0, x1, y1 as fractions) and the map."""
    difference = np.abs(before.astype(np.int16) - after.astype(np.int16)).max(axis=2)
    changed = difference > THRESHOLD
    box = None
    if changed.any():
        ys, xs = np.nonzero(changed)
        h, w = changed.shape
        box = [round(float(xs.min()) / w, 4), round(float(ys.min()) / h, 4),
               round(float(xs.max() + 1) / w, 4), round(float(ys.max() + 1) / h, 4)]
    stats = {'mean_abs': round(float(np.abs(before.astype(np.int16) - after.astype(np.int16)).mean()), 4),
             'changed_share': round(float(changed.mean()), 6), 'changed_box': box,
             'max_step': int(difference.max())}
    return stats, difference


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--renders', type=Path)
    parser.add_argument('--before-renders', type=Path)
    parser.add_argument('--bluehour', type=Path)
    parser.add_argument('--before-bluehour', type=Path)
    args = parser.parse_args()
    before = json.loads((args.before / 'gloss.json').read_text())
    after = json.loads((args.after / 'gloss.json').read_text())
    if SHADING_ONLY.get(after['input_sha256']) != before['input_sha256']:
        raise RuntimeError('the fixed run is not a shading-only child of the V11 run')
    if before['endpoints'] != after['endpoints'] or before['seeds'] != after['seeds']:
        raise RuntimeError('the runs use different endpoints or seeds')
    old, new = glossy_table(before), glossy_table(after)
    mean = lambda values: sum(values) / len(values)
    summary = {'before_sha256': before['input_sha256'], 'after_sha256': after['input_sha256'],
               'samples_per_pixel': after['samples_per_pixel'], 'seeds': after['seeds'],
               'water_sharp_faces': after['water_sharp_faces'], 'water_sharp_edges': after['water_sharp_edges'],
               'units': 'glossy pass, RGB sum x 1000, seed mean', 'scenes': {}}
    variants = [v for v in after['variants'] if v != 'base']
    for scene in sorted({key[0] for key in new}):
        rows, ratios, spread = [], [], []
        for endpoint in after['endpoints']:
            i = endpoint['index']
            row = {'index': i, 'group': endpoint['group'], 'material': endpoint['material'],
                   'v11_smooth': mean(old[(scene, 'base', i)]) * 1000,
                   'v11_flat': mean(old[(scene, 'flat', i)]) * 1000,
                   'fixed': mean(new[(scene, 'base', i)]) * 1000}
            row.update({f'fixed_{v}': mean(new[(scene, v, i)]) * 1000 for v in variants})
            row['fixed_over_v11_flat'] = row['fixed'] / row['v11_flat']
            row['fixed_over_v11_smooth'] = row['fixed'] / row['v11_smooth']
            seeds = new[(scene, 'base', i)]
            spread.append((max(seeds) - min(seeds)) / mean(seeds))
            ratios.append(row['fixed_over_v11_flat'])
            rows.append(row)
        summary['scenes'][scene] = {
            'endpoints': rows, 'fixed_over_v11_flat': ratio_stats(ratios),
            'fixed_over_v11_smooth': ratio_stats([r['fixed_over_v11_smooth'] for r in rows]),
            'fixed_seed_spread': ratio_stats(spread)}

    pairs = []
    if args.renders and args.before_renders:
        pairs += [('final', n, args.before_renders / f'{n}.png', args.renders / f'{n}.png') for n in RENDERS]
    if args.bluehour and args.before_bluehour:
        pairs += [('bluehour', n, args.before_bluehour / f'{n}.png', args.bluehour / f'{n}.png') for n in BLUEHOUR]
    if pairs:
        from PIL import Image
        args.out.mkdir(parents=True, exist_ok=True)
        summary['renders'] = {'threshold_8bit': THRESHOLD, 'images': []}
        for kind, number, old_path, new_path in pairs:
            a = np.asarray(Image.open(old_path).convert('RGB'))
            b = np.asarray(Image.open(new_path).convert('RGB'))
            stats, difference = image_change(a, b)
            summary['renders']['images'].append({'kind': kind, 'render': number, **stats})
            if stats['changed_share'] > MAP_SHARE:
                scale = 255 / max(1, int(difference.max()))
                heat = Image.fromarray(np.clip(difference * scale, 0, 255).astype(np.uint8))
                heat.thumbnail((700, 700))
                heat.save(args.out / f'diff-{kind}-{number}.png', optimize=True)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2, ensure_ascii=False) + '\n')
    for scene, entry in summary['scenes'].items():
        print(scene, 'fixed/v11 flat', {k: round(v, 3) for k, v in entry['fixed_over_v11_flat'].items()})
    for image in summary.get('renders', {}).get('images', []):
        print(image)


if __name__ == '__main__':
    main()
