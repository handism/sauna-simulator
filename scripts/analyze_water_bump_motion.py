"""How the plunge's frayed light patches (waterBottom.ts's bump) move with the waves, before and
after the bump: a numeric stand-in for watching them at 60 fps, not a perceptual verdict.

python3 scripts/analyze_water_bump_motion.py <before report> <after report> --out <dir>
The reports are `--reporter=json` output of e2e/water-bump-motion.visual.ts (build logs before the
JSON are skipped), for the same frames of the same views. Writes motion.json (tracked) and, per
view, <view>.webp (before | after, 2×, 60 fps, local) to --out. Needs NumPy, SciPy and Pillow.

Per view, over the lounge dusk fill's patch (the crops of summarize_water_bump.py):
- roughness: water_bump.edge_roughness of each frame (median), and of the mean of each 6 frames
  (100 ms, roughly what the eye integrates): whether the fraying survives as a frayed outline or
  averages into a soft one;
- flips: pixels crossing the patch's threshold between consecutive frames, per pixel of outline,
  and the share of the outline's pixels that flip back within 3 frames (a flicker, not a drift);
- highPass: mean |y1 − (y0 + y2) / 2| over the pixels near the outline (8-bit luma), and over the
  rest of the crop (the waves' own motion), and its 10 Hz+ share of the temporal spectrum there.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from water_bump import edge_roughness

# The lounge dusk fill's patches: x0, x1, y0, y1 in the 1280×800 views (summarize_water_bump.py).
PATCHES = {'1-down': (680, 940, 0, 180), '2-level': (120, 420, 520, 720)}
THRESHOLD = 150
FPS = 60
INTEGRATE = 6
LUMA = np.array([0.2126, 0.7152, 0.0722])


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(report_path):
    raw = Path(report_path).read_text()
    report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
    if report['errors'] or any(report['stats'][k] for k in ['unexpected', 'skipped', 'flaky']):
        raise SystemExit(f'{report_path}: incomplete run')
    runs = []
    stack = list(report['suites'])
    while stack:
        suite = stack.pop()
        stack += suite.get('suites', [])
        for spec in suite.get('specs', []):
            for t in spec['tests']:
                for result in t['results']:
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == 'water-bump-motion':
                            runs.append(json.loads(base64.b64decode(attachment['body'])))
    if len(runs) != 1:
        raise SystemExit(f'{report_path}: expected one capture, found {len(runs)}')
    return runs[0]


def frames(run, lighting, view):
    heading, pitch = view.split('-')
    x0, x1, y0, y1 = PATCHES[view]
    picked = sorted(
        (s for s in run['samples'] if s['lighting'] == lighting and s['heading'] == int(heading) and s['pitch'] == pitch),
        key=lambda s: s['frame'],
    )
    rgb = np.stack([np.asarray(Image.open(Path(run['dir']) / s['file']).convert('RGB'))[y0:y1, x0:x1] for s in picked])
    return rgb, [s['now'] for s in picked]


def outline(mask):
    return mask ^ ndimage.binary_erosion(mask)


def flips(masks):
    """Threshold crossings between consecutive frames per outline pixel, and the share of crossing
    pixels that cross back within 3 frames."""
    changed = masks[1:] ^ masks[:-1]
    edge = np.mean([outline(m).sum() for m in masks])
    back = 0
    for t in range(len(changed)):
        later = changed[t + 1:t + 4].any(axis=0)
        back += (changed[t] & later).sum()
    return float(changed.sum(axis=(1, 2)).mean() / max(edge, 1)), float(back / max(changed.sum(), 1))


def high_pass(luma):
    return np.abs(luma[1:-1] - (luma[:-2] + luma[2:]) / 2).mean(axis=0)


def fast_share(luma, region):
    """Share of the temporal variance (per pixel, detrended) above 10 Hz, over `region`."""
    series = luma[:, region]
    series = series - series.mean(axis=0)
    power = np.abs(np.fft.rfft(series * np.hanning(len(series))[:, None], axis=0)) ** 2
    freqs = np.fft.rfftfreq(len(series), 1 / FPS)
    return float(power[freqs >= 10].sum() / max(power[freqs > 0].sum(), 1e-9))


def analyze(rgb):
    luma = rgb.astype(float) @ LUMA
    masks = np.stack([ndimage.binary_opening(y > THRESHOLD, iterations=1) for y in luma])
    means = [luma[t:t + INTEGRATE].mean(axis=0) for t in range(0, len(luma) - INTEGRATE + 1, INTEGRATE)]
    near = ndimage.binary_dilation(np.any([outline(m) for m in masks], axis=0), iterations=2)
    hp = high_pass(luma)
    rate, back = flips(masks)
    return {
        'patchPixels': int(np.median(masks.sum(axis=(1, 2)))),
        'roughness': {
            'perFrame': round(float(np.median([edge_roughness(y, THRESHOLD) for y in luma])), 3),
            'mean100ms': round(float(np.median([edge_roughness(y, THRESHOLD) for y in means])), 3),
        },
        'flipsPerOutlinePixelPerFrame': round(rate, 3),
        'flipsBackWithin3Frames': round(back, 3),
        'highPass': {
            'nearOutline': round(float(hp[near].mean()), 3),
            'elsewhere': round(float(hp[~near].mean()), 3),
            'nearOutlineP99': round(float(np.percentile(hp[near], 99)), 2),
        },
        'over10HzShareNearOutline': round(fast_share(luma, near), 3),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('before', type=Path)
    parser.add_argument('after', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    runs = {'before': load(args.before), 'after': load(args.after)}
    out = {
        'inputs': {k: {'hashes': r['hashes'], 'browser': r['browser'], 'stepMs': r['stepMs']} for k, r in runs.items()},
        'frames': None,
        'views': {},
    }
    for lighting in ['evening', 'night']:
        for view in PATCHES:
            name = f'{lighting}-{view}'
            crops, clocks = {}, {}
            for build, run in runs.items():
                crops[build], clocks[build] = frames(run, lighting, view)
            if clocks['before'] != clocks['after']:
                raise SystemExit(f'{name}: the builds were captured at different times')
            out['frames'] = len(clocks['after'])
            out['views'][name] = {build: analyze(c) for build, c in crops.items()}
            gap = np.zeros((*crops['after'].shape[1:2], 4, 3), np.uint8)
            movie = [
                Image.fromarray(np.concatenate([b, gap, a], 1)).resize(
                    ((b.shape[1] * 2 + 4) * 2, b.shape[0] * 2), Image.NEAREST
                )
                for b, a in zip(crops['before'], crops['after'])
            ]
            movie[0].save(args.out / f'{name}.webp', save_all=True, append_images=movie[1:], duration=17, loop=0, lossless=True)
    out['script_sha256'] = sha(__file__)
    (args.out / 'motion.json').write_text(json.dumps(out, indent=1) + '\n')
    print(json.dumps(out['views'], indent=1))


if __name__ == '__main__':
    main()
