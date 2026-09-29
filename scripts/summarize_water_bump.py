"""Compare the plunge's frayed light patches before and after the bump (waterBottom.ts) with Cycles.

python3 scripts/summarize_water_bump.py <before captures> <after captures> <Cycles bump dir> --out <dir>
[--stage blender/renders/stage-water]

The captures are e2e/stage-compare.visual.ts's JPEGs (stage-water-<lighting>-<view>.jpg), the
Cycles stage references come from blender_stage_reference.py and the bump dir from
diagnose_water_bump.py (bump.json). Writes summary.json and review.png (crops: before, after,
Cycles) to --out:

- the bump's slope over the same 0.5 m square as bump.json, from water_bump.py (the product's
  formula) next to Cycles' shading normals;
- the edge roughness (water_bump.edge_roughness) of the lounge dusk fill's patches at dusk and
  night, looking down and at heading 2;
- the mean ΔE76 to Cycles of all 12 views, over the whole frame and over the pixels the change
  moved (ΔE > 2 between the captures, dilated 6 px). The fraying cannot match Cycles pixel for
  pixel, so these only check that nothing else moved.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from water_bump import bump_slopes, edge_roughness

LIGHTINGS = ['day', 'evening', 'night']
VIEWS = ['0-level', '1-down', '2-level', '4-level']
# The lounge dusk fill's patches: x0, x1, y0, y1 in the 1280×800 views.
PATCHES = {'1-down': (680, 940, 0, 180), '2-level': (120, 420, 520, 720)}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rgb(path):
    return np.asarray(Image.open(path).convert('RGB').resize((1280, 800), Image.BOX))


def lab(pixels):
    x = pixels.astype(float) / 255
    x = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = x @ m.T / np.array([0.95047, 1, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def luma(pixels):
    return pixels.astype(float) @ np.array([0.2126, 0.7152, 0.0722])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('bump', type=Path)
    parser.add_argument('--stage', type=Path, default=Path('blender/renders/stage-water'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    cycles_bump = json.loads((args.bump / 'bump.json').read_text())
    view = cycles_bump['normalView']
    half = view['size'] / 2
    ticks = np.arange(view['pixels']) * view['size'] / view['pixels']
    x, y = np.meshgrid(view['center'][0] - half + ticks, view['center'][1] - half + ticks)
    slopes = bump_slopes(x, y, np.full_like(x, 0.765))
    summary = {
        'inputs': {},
        'bumpSlope': {
            'cycles': cycles_bump['bumpSlope'],
            'browserFormula': {
                'rms': float(np.sqrt((slopes ** 2).mean())),
                'p50': float(np.median(slopes)),
                'p95': float(np.percentile(slopes, 95)),
            },
        },
        'edgeRoughness': {},
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
            if lighting != 'day' and v in PATCHES:
                x0, x1, y0, y1 = PATCHES[v]
                crops = {k: i[y0:y1, x0:x1] for k, i in images.items()}
                summary['edgeRoughness'][name] = {k: round(edge_roughness(luma(c)), 3) for k, c in crops.items()}
                gap = np.zeros((y1 - y0, 4, 3), np.uint8)
                rows.append(np.concatenate([crops['before'], gap, crops['after'], gap, crops['cycles']], 1))
    width = max(r.shape[1] for r in rows)
    sheet = np.concatenate([np.pad(r, ((0, 4), (0, width - r.shape[1]), (0, 0))) for r in rows])
    Image.fromarray(sheet).save(args.out / 'review.png')
    summary['script_sha256'] = sha(__file__)
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    print(json.dumps({k: summary[k] for k in ('bumpSlope', 'edgeRoughness')}, indent=1))


if __name__ == '__main__':
    main()
