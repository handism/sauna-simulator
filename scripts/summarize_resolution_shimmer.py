"""Summarise e2e/resolution-shimmer.visual.ts: how much each dynamic resolution step shimmers while
looking around.

python3 scripts/summarize_resolution_shimmer.py <report.json> <captures dir> <out dir>

<report.json> is Playwright's JSON reporter output (build logs before the first `{` are skipped),
<captures dir> the test's output folder under test-results/visual/. Each sequence turns the camera
by a known yaw per frame (rotation order YXZ, the view's pitch and vertical field of view from
public/models/sauna.scene.json). A pure rotation maps frame k+1 onto frame k by a homography,
whatever the depth, so frame k is resampled (cubic) into frame k+1's pixels and the L* residual is
what the motion does not explain: edges stepping between pixels, leaves popping in and out. Per
sequence it keeps the mean |residual| per pixel and over 12×12 tiles (8 CSS pixels, where a leaf
appearing or vanishing changes the mean and the resampling's own error mostly cancels), with the
99th percentile of the tiles. The control is the round trip k → k+1 → k: twice the resampling
error of the same image with nothing changed. The sign of the yaw is checked: the other sign must
leave a larger residual. Writes <out dir>/shimmer.json and, for local review only,
<out dir>/tiles-<stage>-<lighting>.png (the tile residual of the first pair at each ratio).
--baseline <shimmer.json> adds each sequence's ratio to the same sequence of another run (e.g. the
same speed with ?temporal=off).
"""

import argparse
import base64
import json
import math
import statistics
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from summarize_frame_cost import srgb_lab

TILE = 12
SCENE = Path(__file__).resolve().parent.parent / 'public/models/sauna.scene.json'


def samples(report_path):
    text = Path(report_path).read_text()
    report = json.loads(text[0 if text.startswith('{') else text.index('\n{') + 1:])

    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                for result in test['results']:
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == 'resolution-shimmer':
                            yield json.loads(base64.b64decode(attachment['body']))
        for child in suite.get('suites', []):
            yield from walk(child)

    found = [body for suite in report['suites'] for body in walk(suite)]
    if len(found) != 1:
        raise SystemExit(f'{len(found)} resolution-shimmer attachments')
    return found[0]


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def warp_coords(shape, fov, pitch, yaw):
    """For each pixel of the frame turned by `yaw` (rotation.y += yaw), where it lies in the frame
    before: (row, column) arrays."""
    h, w = shape
    f = (h / 2) / math.tan(math.radians(fov) / 2)
    v, u = np.mgrid[0:h, 0:w] + 0.5
    rays = np.stack([(u - w / 2) / f, -(v - h / 2) / f, -np.ones_like(u)], -1)
    # Camera k: R_y(y) R_x(p); camera k+1: R_y(y + yaw) R_x(p); c_k = R_x(-p) R_y(yaw) R_x(p) c_k+1.
    m = rot_x(-pitch) @ rot_y(yaw) @ rot_x(pitch)
    c = rays @ m.T
    z = -c[..., 2]
    return h / 2 - f * c[..., 1] / z - 0.5, w / 2 + f * c[..., 0] / z - 0.5


def resample(image, coords):
    return ndimage.map_coordinates(image, coords, order=3, mode='nearest')


def inside(coords, shape, margin=3):
    r, c = coords
    return (r >= margin) & (r <= shape[0] - 1 - margin) & (c >= margin) & (c <= shape[1] - 1 - margin)


def tiles(residual, valid):
    h, w = residual.shape
    th, tw = h // TILE, w // TILE
    r = residual[:th * TILE, :tw * TILE].reshape(th, TILE, tw, TILE)
    ok = valid[:th * TILE, :tw * TILE].reshape(th, TILE, tw, TILE).all(axis=(1, 3))
    return np.abs(r.mean(axis=(1, 3))), ok


def measure(before, after, coords, back):
    valid = inside(coords, before.shape)
    residual = resample(before, coords) - after
    tile, ok = tiles(residual, valid)
    out = {'pixel': float(np.abs(residual[valid]).mean()), 'tile': float(tile[ok].mean()),
           'tileP99': float(np.percentile(tile[ok], 99))}
    if back is not None:
        trip_valid = valid & inside(back, before.shape)
        trip = resample(resample(before, coords), back) - before
        trip_tile, trip_ok = tiles(trip, trip_valid)
        out['tripPixel'] = float(np.abs(trip[trip_valid]).mean())
        out['tripTile'] = float(trip_tile[trip_ok].mean())
    return out, tile, ok


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('report')
    parser.add_argument('captures')
    parser.add_argument('out')
    parser.add_argument('--baseline', help="another run's shimmer.json: each sequence's ratio to it")
    args = parser.parse_args()
    captures, out = Path(args.captures), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    body = samples(args.report)
    yaw = body['yawPerStep']
    views = json.loads(SCENE.read_text())['views']
    sequences = {}
    for sample in body['samples']:
        sequences.setdefault((sample['stage'], sample['lighting'], sample['ratio']), []).append(sample)
    rows, maps = [], {}
    for (stage, lighting, ratio), steps in sequences.items():
        steps.sort(key=lambda s: s['step'])
        view = views[stage]
        p, t = view['position'], view['target']
        pitch = math.atan2(t[1] - p[1], math.hypot(t[0] - p[0], t[2] - p[2]))
        lum = [srgb_lab(np.asarray(Image.open(captures / s['file']).convert('RGB'), float))[..., 0] for s in steps]
        # Dragging right turns rotation.y down: frame k+1's pixels in frame k, and the way back.
        forward = warp_coords(lum[0].shape, view['fov'], pitch, -yaw)
        reverse = warp_coords(lum[0].shape, view['fov'], pitch, yaw)
        pairs = []
        for k in range(len(lum) - 1):
            values, tile, ok = measure(lum[k], lum[k + 1], forward, reverse)
            pairs.append(values)
            if k == 0:
                maps.setdefault((stage, lighting), []).append((ratio, np.where(ok, tile, 0)))
        wrong, _, _ = measure(lum[0], lum[1], reverse, None)
        unwarped = float(np.abs(lum[0] - lum[1]).mean())
        if wrong['pixel'] <= pairs[0]['pixel']:
            raise SystemExit(f'{stage} {lighting} {ratio}: the other yaw sign fits as well')
        row = {'stage': stage, 'lighting': lighting, 'ratio': ratio, 'pitch': round(pitch, 4), 'fov': view['fov'],
               'frames': len(lum), 'firstPairUnwarpedPixel': round(unwarped, 4),
               'firstPairWrongSignPixel': round(wrong['pixel'], 4)}
        for key in pairs[0]:
            row[key] = round(statistics.mean(pair[key] for pair in pairs), 4)
        rows.append(row)
    for (stage, lighting), tiles_by_ratio in maps.items():
        top = max(float(np.percentile(t, 99.5)) for _, t in tiles_by_ratio) or 1
        strips = [np.clip(t / top * 255, 0, 255).astype(np.uint8) for _, t in sorted(tiles_by_ratio, reverse=True)]
        gap = np.full((strips[0].shape[0], 2), 255, np.uint8)
        sheet = np.concatenate([x for s in strips for x in (s, gap)][:-1], axis=1)
        Image.fromarray(sheet).resize((sheet.shape[1] * 4, sheet.shape[0] * 4), Image.NEAREST).save(
            out / f'tiles-{stage}-{lighting}.png')
    rows.sort(key=lambda r: (r['stage'], r['lighting'], -r['ratio']))
    by_view = {}
    for row in rows:
        by_view.setdefault((row['stage'], row['lighting']), {})[row['ratio']] = row
    relative = {}
    for (stage, lighting), ratios in by_view.items():
        for ratio in (1.25, 1):
            if ratio not in ratios or 1.5 not in ratios:
                continue
            for key in ('pixel', 'tile', 'tileP99'):
                relative.setdefault(f'{ratio}', {}).setdefault(key, []).append(
                    round(ratios[ratio][key] / ratios[1.5][key], 4))
    result = {'note': 'L* residual after warping frame k onto frame k+1 by the known rotation '
                      f'({yaw} rad of yaw per frame), mean over the pairs of a sequence. tile: |mean| over '
                      f'{TILE}x{TILE} capture pixels. trip*: round trip k -> k+1 -> k (resampling error alone, '
                      'twice). relativeTo1_5: per view, the ratio to the 1.5 sequence.',
              'yawPerStep': yaw, 'framesPerStep': body.get('framesPerStep', 2),
              'relativeTo1_5': {ratio: {key: {'min': min(v), 'median': statistics.median(v), 'max': max(v)}
                                        for key, v in values.items()} for ratio, values in relative.items()},
              'sequences': rows}
    if args.baseline:
        base = {(r['stage'], r['lighting'], r['ratio']): r
                for r in json.loads(Path(args.baseline).read_text())['sequences']}
        against = {}
        for row in rows:
            other = base.get((row['stage'], row['lighting'], row['ratio']))
            if other is None:
                continue
            row['relativeToBaseline'] = {key: round(row[key] / other[key], 4) for key in ('pixel', 'tile', 'tileP99')}
            for key, value in row['relativeToBaseline'].items():
                against.setdefault(f"{row['ratio']}", {}).setdefault(key, []).append(value)
        result['relativeToBaseline'] = {
            'baseline': args.baseline,
            'byRatio': {ratio: {key: {'min': min(v), 'median': statistics.median(v), 'max': max(v)}
                                for key, v in values.items()} for ratio, values in against.items()}}
    (out / 'shimmer.json').write_text(json.dumps(result, indent=1) + '\n')
    for row in rows:
        print(row['stage'], row['lighting'], row['ratio'], 'pixel', row['pixel'], 'tile', row['tile'],
              'p99', row['tileP99'], 'trip', row['tripPixel'], row['tripTile'],
              'unwarped', row['firstPairUnwarpedPixel'], 'wrong', row['firstPairWrongSignPixel'])
    print(json.dumps(result['relativeTo1_5'], indent=1))
    if 'relativeToBaseline' in result:
        print(json.dumps(result['relativeToBaseline']['byRatio'], indent=1))


if __name__ == '__main__':
    main()
