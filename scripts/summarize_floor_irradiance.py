"""python3 scripts/summarize_floor_irradiance.py <surface-sampling.json> --out <dir>

Maps the sauna-floor diagnostic of bake_irradiance_probes.py --surface-samples (fixture from
sample_room_floor.py): grid interpolation over the near-surface cosine integral per point, in
Rec.709 luminance. Writes floor-summary.json and floor-map.png (top view, x right, glTF +z down).
Also scores two candidate corrections: one global factor per scene (is the error a plain bias?)
and a floor-only irradiance map with twice the fixture spacing, point-sampled at even cells and
scored on the held-out cells only (would a map at the probe spacing help?). Points that mostly
see back faces lie inside closed geometry (stove base) and are left out. Diagnostic only.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

LUMA = np.array([.2126, .7152, .0722])
OFFSET = 0.05  # 2 cm is also measured; 5 cm is less sensitive to floor micro-shadowing.
BACKFACE = 0.25  # Like the bake: points that mostly see back faces lie inside closed geometry.
STOVE = np.array([-1.4, -1.4])  # glTF xz of the stove base's center (web_scene.py stove is above it).


def regions(position):
    """Floor regions by glTF xz: the east wall strip, around the stove, other walls, open floor."""
    x, z = position[:, 0], position[:, 2]
    stove = np.hypot(x - STOVE[0], z - STOVE[1]) < 0.8
    east = (x > -1.0) & ~stove
    wall = ((x < -5.9) | (z < -4.35) | (z > -0.5)) & ~east & ~stove
    return dict(east_wall=east, stove=stove, other_walls=wall, open_floor=~(east | stove | wall))


def table(rows):
    cells = np.array([r['cell'] for r in rows])
    measured = np.array([[m for m in r['measured'] if m['offset_m'] == OFFSET][0]['cosine_rgb'] for r in rows]) @ LUMA
    near = np.array([[m for m in r['measured'] if m['offset_m'] == .02][0]['cosine_rgb'] for r in rows]) @ LUMA
    half = np.array([r['grid_half_spacing_rgb'] for r in rows]) @ LUMA
    zero = np.array([r['grid_no_offset_rgb'] for r in rows]) @ LUMA
    return cells, measured, near, half, zero


def stats(estimate, measured):
    ratio = estimate / measured
    log = np.log2(ratio)
    return dict(sum_ratio=round(float(estimate.sum() / measured.sum()), 4),
                median_ratio=round(float(np.median(ratio)), 4),
                mean_abs_log2=round(float(np.abs(log).mean()), 4),
                p10_ratio=round(float(np.percentile(ratio, 10)), 4),
                p90_ratio=round(float(np.percentile(ratio, 90)), 4),
                share_over_1_1=round(float((ratio > 1.1).mean()), 4),
                share_under_0_9=round(float((ratio < 0.9).mean()), 4))


def holdout_map(cells, measured):
    """Map texels at even cells; each odd cell takes the mean of its nearest texels (bilinear at
    the midpoint). Returns the held-out indices and their estimates."""
    known = {tuple(c): v for c, v in zip(cells, measured) if c[0] % 2 == 0 and c[1] % 2 == 0}
    index, estimate = [], []
    for k, (i, j) in enumerate(cells):
        if (i, j) in known:
            continue
        near = [known[(a, b)] for a in ({i} if i % 2 == 0 else {i - 1, i + 1})
                for b in ({j} if j % 2 == 0 else {j - 1, j + 1}) if (a, b) in known]
        if near:
            index.append(k)
            estimate.append(np.mean(near))
    return np.array(index), np.array(estimate)


def diverging(log):
    """log2 ratio in [-1, 1] to blue-white-red."""
    t = np.clip(log, -1, 1)
    white = np.array([245, 245, 245.])
    end = np.array([200, 60, 50.]) if t > 0 else np.array([50, 90, 200.])
    return tuple(int(c) for c in white + abs(t) * (end - white))


def draw(path, cells, scenes, spacing):
    size = 18
    shape = cells.max(axis=0) + 1
    width, height = shape[0] * size, shape[1] * size
    image = Image.new('RGB', (len(scenes) * 2 * (width + 12) + 12, height + 40), 'white')
    pen = ImageDraw.Draw(image)
    for k, (key, measured, half) in enumerate(scenes):
        for panel, title in enumerate((f'{key}: measured 5 cm (luminance / max)', f'{key}: grid / measured (log2, +-1)')):
            left = 12 + (2 * k + panel) * (width + 12)
            pen.text((left, 6), title, fill='black')
            for (i, j), m, h in zip(cells, measured, half):
                color = tuple([int(255 * (m / measured.max()) ** (1 / 2.2))] * 3) if panel == 0 else diverging(np.log2(h / m))
                x, y = left + i * size, 24 + j * size
                pen.rectangle((x, y, x + size - 1, y + size - 1), fill=color)
    pen.text((12, height + 26), f'cells {spacing} m; x right (-6.15..-0.5), glTF +z down (-4.59..-0.25); stove near x -1.25, z -1.28', fill='black')
    image.save(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('sampling', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    report = json.loads(args.sampling.read_text())
    out = dict(input_sha256=report['input_sha256'], probe_bin_sha256=report['probe_bin_sha256'],
               surface_samples_sha256=report['surface_samples_sha256'], offset_m=OFFSET, scenes={})
    maps = []
    spacing = None
    for key, scene in report['scenes'].items():
        inside = [r['label'] for r in scene['samples'] if max(m['backface_cosine'] for m in r['measured']) >= BACKFACE]
        rows = [r for r in scene['samples'] if r['label'] not in inside]
        cells, measured, near, half, zero = table(rows)
        spacing = spacing or round(float(np.diff(sorted({r['position'][0] for r in rows}))[0]), 3)
        factor = measured.sum() / half.sum()
        entry = dict(points=len(rows), inside_geometry=inside, measured_mean=round(float(measured.mean()), 5),
                     near_over_5cm=stats(near, measured),
                     grid_half_spacing=stats(half, measured), grid_no_offset=stats(zero, measured),
                     global_factor=round(float(factor), 4), grid_half_times_global_factor=stats(half * factor, measured),
                     )
        held, value = holdout_map(cells, measured)
        entry['holdout'] = dict(points=len(held), floor_map=stats(value, measured[held]),
                                grid_half_spacing=stats(half[held], measured[held]))
        # Where the excess sits: split by the measured level (dark floor under benches vs open floor).
        dark = measured < np.median(measured)
        entry['grid_half_dark_half'] = stats(half[dark], measured[dark])
        entry['grid_half_bright_half'] = stats(half[~dark], measured[~dark])
        position = np.array([r['position'] for r in rows])
        entry['grid_half_by_region'] = {name: dict(points=int(mask.sum()), **stats(half[mask], measured[mask]))
                                        for name, mask in regions(position).items()}
        out['scenes'][key] = entry
        maps.append((key, measured, half))
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'floor-summary.json').write_text(json.dumps(out, indent=2) + '\n')
    draw(args.out / 'floor-map.png', cells, maps, spacing)
    print(json.dumps(out, indent=2))


if __name__ == '__main__':
    main()
