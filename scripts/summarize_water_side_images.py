"""Compare browser captures before and after the mirrored side images of the plunge (refraction.ts).

python3 scripts/summarize_water_side_images.py BEFORE_DIR AFTER_DIR --out DIR
    [--renders blender/renders --v11-renders blender/renders/v11
     --bluehour blender/renders/web-bluehour --v11-bluehour blender/renders/web-bluehour/v11
     --stage blender/renders/stage-water --stage-before DIR --stage-after DIR]

BEFORE_DIR and AFTER_DIR hold the cycles-NN-{day,evening}.jpg captures of
e2e/cycles-compare.visual.ts. Images are compared in CIELAB at 600x400 (BOX), as
cycles_tone_stats.py does. For every Cycles render with a capture, writes the difference
of the mean L* (the review statistic of the progress notes); for the renders the
flattened water changed, also the water region, the pixels where the Cycles L* changed by
more than 2 between the V11 and the fixed source (as in docs/3d-qa/water-flat-sides), and
the pixels the browser change moved by more than 2 L*: their mean L* and mean CIE76 color
difference to Cycles. Also writes crops of camera 03 (Cycles / before / after). With --stage
and the captures of stage-compare.visual.ts (stage-water-<lighting>-<heading>-<pitch>.jpg),
compares the water stage's views rendered by blender_stage_reference.py the same way and
writes their sheets (Cycles / before / after per row).
"""
import argparse
import json
from pathlib import Path

import numpy as np

SIZE = (600, 400)
REGION_DL = 2.0  # L* change that marks the water region and the changed pixels
# The original renders: 06 is camera 01 in the blue-hour scene.
ORIGINAL = {'01': ('01', 'day'), '02': ('02', 'day'), '03': ('03', 'day'), '04': ('04', 'day'),
            '05': ('05', 'day'), '06': ('01', 'evening'), '07': ('07', 'day')}
BLUEHOUR = ('02', '03', '04', '05', '07')
CROP = (0.2, 0.3, 0.85, 0.75)  # left, top, right, bottom of camera 03's plunge


def lab(pixels):
    """CIELAB (D65) of 8-bit sRGB pixels."""
    a = np.asarray(pixels, dtype=np.float64) / 255
    lin = np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)
    xyz = lin @ np.array([[.4124, .3576, .1805], [.2126, .7152, .0722], [.0193, .1192, .9505]]).T / [.9505, 1, 1.089]
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def load(path):
    from PIL import Image
    return lab(Image.open(path).convert('RGB').resize(SIZE, Image.Resampling.BOX))


def region_stats(mask, reference, before, after):
    """Mean L* and mean CIE76 difference to the reference inside the mask."""
    if not mask.any():
        return {'share': 0.0}
    delta = lambda image: float(np.linalg.norm(image[mask] - reference[mask], axis=-1).mean())
    return {
        'share': float(mask.mean()),
        'L': {'cycles': float(reference[mask, 0].mean()), 'before': float(before[mask, 0].mean()),
              'after': float(after[mask, 0].mean())},
        'delta_e76': {'before': delta(before), 'after': delta(after)},
    }


def compare(reference, before, after, v11=None):
    """Statistics of one Cycles render against the two captures."""
    row = {
        'mean_L': {'cycles': float(reference[..., 0].mean()), 'before': float(before[..., 0].mean()),
                   'after': float(after[..., 0].mean())},
        'changed': region_stats(np.abs(after[..., 0] - before[..., 0]) > REGION_DL, reference, before, after),
    }
    if v11 is not None:
        row['water'] = region_stats(np.abs(reference[..., 0] - v11[..., 0]) > REGION_DL, reference, before, after)
    return row


def mean_abs_dl(rows, names, which):
    values = [abs(rows[n]['mean_L'][which] - rows[n]['mean_L']['cycles']) for n in names if n in rows]
    return float(np.mean(values)) if values else None


def crops(renders, bluehour, before, after, out):
    from PIL import Image
    for name, cycles, light in (('03', renders / '03.png', 'day'), ('bh-03', bluehour / '03.png', 'evening')):
        paths = [cycles, before / f'cycles-03-{light}.jpg', after / f'cycles-03-{light}.jpg']
        if not all(p.exists() for p in paths):
            continue
        images = [Image.open(p).convert('RGB') for p in paths]
        size = images[0].size
        box = tuple(int(c * size[i % 2]) for i, c in enumerate(CROP))
        parts = [image.resize(size, Image.Resampling.LANCZOS).crop(box) for image in images]
        width = 1000
        parts = [p.resize((width, round(p.height * width / p.width)), Image.Resampling.LANCZOS) for p in parts]
        sheet = Image.new('RGB', (width, sum(p.height for p in parts)))
        y = 0
        for part in parts:
            sheet.paste(part, (0, y))
            y += part.height
        sheet.save(out / f'compare-{name}.jpg', quality=88)


def stage_sheets(stage, before, after, out):
    """Cycles / before / after rows of every stage view, per lighting."""
    from PIL import Image
    for light in ('day', 'evening'):
        names = sorted(p.stem for p in stage.glob(f'{light}-*.png'))
        rows = [(stage / f'{n}.png', before / f'stage-water-{n}.jpg', after / f'stage-water-{n}.jpg') for n in names]
        rows = [r for r in rows if all(p.exists() for p in r)]
        if not rows:
            continue
        cell = (640, 400)
        sheet = Image.new('RGB', (cell[0] * 3, cell[1] * len(rows)))
        for i, row in enumerate(rows):
            for j, path in enumerate(row):
                sheet.paste(Image.open(path).convert('RGB').resize(cell, Image.Resampling.LANCZOS), (cell[0] * j, cell[1] * i))
        sheet.save(out / f'stage-{light}.jpg', quality=85)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--renders', type=Path, default=Path('blender/renders'))
    parser.add_argument('--v11-renders', type=Path, default=Path('blender/renders/v11'))
    parser.add_argument('--bluehour', type=Path, default=Path('blender/renders/web-bluehour'))
    parser.add_argument('--v11-bluehour', type=Path, default=Path('blender/renders/web-bluehour/v11'))
    parser.add_argument('--stage', type=Path, help='blender_stage_reference.py renders')
    parser.add_argument('--stage-before', type=Path)
    parser.add_argument('--stage-after', type=Path)
    args = parser.parse_args()

    pairs = {name: (args.renders / f'{name}.png', args.v11_renders / f'{name}.png', camera, light)
             for name, (camera, light) in ORIGINAL.items()}
    pairs.update({f'bh-{n}': (args.bluehour / f'{n}.png', args.v11_bluehour / f'{n}.png', n, 'evening')
                  for n in BLUEHOUR})
    rows = {}
    for name, (cycles, v11, camera, light) in pairs.items():
        capture = f'cycles-{camera}-{light}.jpg'
        if not (cycles.exists() and (args.before / capture).exists() and (args.after / capture).exists()):
            continue
        reference = load(cycles)
        old = load(v11) if v11.exists() else None
        rows[name] = {'capture': capture, **compare(reference, load(args.before / capture), load(args.after / capture), old)}
    if not rows:
        parser.error('no Cycles render has both captures')
    stage = {}
    if args.stage and args.stage_before and args.stage_after:
        for render in sorted(args.stage.glob('*.png')):
            capture = f'stage-water-{render.stem}.jpg'
            if (args.stage_before / capture).exists() and (args.stage_after / capture).exists():
                stage[render.stem] = {'capture': capture, **compare(
                    load(render), load(args.stage_before / capture), load(args.stage_after / capture))}
    dusk = ['06'] + [f'bh-{n}' for n in BLUEHOUR]
    summary = {
        'size': SIZE,
        'region_dl': REGION_DL,
        'mean_abs_dL': {
            'original': {w: mean_abs_dl(rows, ORIGINAL, w) for w in ('before', 'after')},
            'dusk': {w: mean_abs_dl(rows, dusk, w) for w in ('before', 'after')},
        },
        'renders': rows,
        'stage': stage,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    crops(args.renders, args.bluehour, args.before, args.after, args.out)
    if stage:
        stage_sheets(args.stage, args.stage_before, args.stage_after, args.out)
    for name, row in stage.items():
        changed = row['changed']
        if changed['share']:
            print(f"stage {name:15} changed {changed['share']:.1%}  dE76 {changed['delta_e76']['before']:.1f} -> "
                  f"{changed['delta_e76']['after']:.1f}  mean L* cycles {row['mean_L']['cycles']:.1f} "
                  f"before {row['mean_L']['before']:.1f} after {row['mean_L']['after']:.1f}")
    for name, row in rows.items():
        water = row.get('water', {})
        if water.get('share', 0) > 0.01:
            print(f"{name:6} water {water['share']:.1%}  L* cycles {water['L']['cycles']:.1f} before {water['L']['before']:.1f} "
                  f"after {water['L']['after']:.1f}  dE76 {water['delta_e76']['before']:.1f} -> {water['delta_e76']['after']:.1f}")
    for group, value in summary['mean_abs_dL'].items():
        print(f"mean |dL*| {group}: {value['before']:.2f} -> {value['after']:.2f}")


if __name__ == '__main__':
    main()
