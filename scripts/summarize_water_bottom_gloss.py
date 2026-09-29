"""Compare the inside of the plunge's dusk disks before and after the floor highlight's shadow fix.

python3 scripts/summarize_water_bottom_gloss.py <before captures> <after captures> <gloss dir> --out <dir>
[--stage blender/renders/stage-water]

The captures are e2e/stage-compare.visual.ts's JPEGs, the Cycles stage references come from
blender_stage_reference.py and the gloss dir from diagnose_water_bottom_gloss.py (gloss.json and
the display crops). Writes summary.json and review.png to --out:

- inside the lounge dusk fill's patches at dusk and night (looking down and at heading 2): the
  mean, spread and 5/50/95th percentiles of the luma of the patch (luma > 140 of 255), for the
  captures before and after and Cycles; at dusk also for Cycles with the pool tiles' specular at 0
  (the diagnostic's crops, whose patches are uniform like the old captures);
- the mean ΔE76 to Cycles of all 12 views over the whole frame and over the pixels the change moved
  (ΔE > 2 between the captures, dilated 6 px), as in summarize_water_bump.py.

review.png rows: evening/night × looking down/heading 2; columns: before, after, Cycles, and at
dusk Cycles without the tiles' specular.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from summarize_water_bump import LIGHTINGS, PATCHES, VIEWS, lab, luma, rgb, sha

SPOT = 140


def spot_stats(crop):
    y = luma(crop)
    values = y[y > SPOT]
    p5, p50, p95 = np.percentile(values, [5, 50, 95])
    return {
        'pixels': int(values.size),
        'mean': round(float(values.mean()), 2),
        'std': round(float(values.std()), 2),
        'p5': round(float(p5), 1),
        'p50': round(float(p50), 1),
        'p95': round(float(p95), 1),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('gloss', type=Path)
    parser.add_argument('--stage', type=Path, default=Path('blender/renders/stage-water'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    gloss = json.loads((args.gloss / 'gloss.json').read_text())
    summary = {
        'inputs': {'gloss.json': sha(args.gloss / 'gloss.json')},
        'cycles': {k: gloss[k] for k in ('blendSha256', 'samples', 'tileMaterial', 'spotMeanLinear', 'visibility')},
        'spot': {},
        'meanDE76': {},
    }
    rows = []
    for lighting in LIGHTINGS:
        for v in VIEWS:
            name = f'{lighting}-{v}'
            paths = {
                'before': args.before / f'stage-water-{name}.jpg',
                'after': args.after / f'stage-water-{name}.jpg',
                'cycles': args.stage / f'{name}.png',
            }
            summary['inputs'][name] = {k: sha(p) for k, p in paths.items()}
            images = {k: rgb(p) for k, p in paths.items()}
            labs = {k: lab(i) for k, i in images.items()}
            to_cycles = {k: np.linalg.norm(labs[k] - labs['cycles'], axis=-1) for k in ('before', 'after')}
            changed = np.linalg.norm(labs['after'] - labs['before'], axis=-1) > 2
            band = ndimage.binary_dilation(changed, iterations=6)
            summary['meanDE76'][name] = {
                'changedPixels': int(changed.sum()),
                'all': {k: round(float(d.mean()), 3) for k, d in to_cycles.items()},
                'changedBand': {k: round(float(d[band].mean()), 3) for k, d in to_cycles.items()} if band.any() else None,
            }
            if lighting == 'day' or v not in PATCHES:
                continue
            x0, x1, y0, y1 = PATCHES[v]
            crops = {k: i[y0:y1, x0:x1] for k, i in images.items()}
            if lighting == 'evening':
                shown = np.load(args.gloss / f'spec0-{v}-display.npy')
                crops['cyclesNoTileSpecular'] = np.round(shown * 255).astype(np.uint8)
            summary['spot'][name] = {k: spot_stats(c) for k, c in crops.items()}
            gap = np.zeros((y1 - y0, 4, 3), np.uint8)
            row = [crops['before'], gap, crops['after'], gap, crops['cycles']]
            if 'cyclesNoTileSpecular' in crops:
                row += [gap, crops['cyclesNoTileSpecular']]
            rows.append(np.concatenate(row, 1))
    width = max(r.shape[1] for r in rows)
    sheet = np.concatenate([np.pad(r, ((0, 4), (0, width - r.shape[1]), (0, 0))) for r in rows])
    Image.fromarray(sheet).save(args.out / 'review.png')
    summary['script_sha256'] = sha(__file__)
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    print(json.dumps(summary['spot'], indent=1))


if __name__ == '__main__':
    main()
