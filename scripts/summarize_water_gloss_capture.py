"""Compare the browser's tile gloss of the dusk fill with Cycles', pixel by pixel, in linear light.

python3 scripts/summarize_water_gloss_capture.py <captures>... --out docs/3d-qa/water-gloss-capture
  [--scene blender/diagnostics/water-gloss-scene] [--bottom blender/diagnostics/water-bottom-gloss]

Each <captures> folder (summarised under its name, e.g. before/after) holds the PNGs of
e2e/water-gloss-capture.visual.ts (gloss-{on,off,on-again}-<view>.png: the HDR buffer times `scale`
encoded as sRGB, no view transform) and its JSON report (report.json).
The browser's gloss is on − off; Cycles' is the `source` gloss of diagnose_water_gloss_scene.py (the
dusk fill's light group, Specular IOR Level on − off). The total is compared with the Combined pass
of diagnose_water_bottom_gloss.py (`base`). Every pixel is also sorted by the flat water box
(summarize_water_gloss_scene.flat_view): seen straight or through a side's reflection. capture.json
holds, per folder, the means in each spot and part, the 5×5-block correlation and the reload's own
difference; review.png (local) shows browser, Cycles and their difference (red: browser brighter,
the side-reflected part tinted) per folder and crop.
"""
import argparse
import base64
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

from diagnose_water_gloss_scene import LUMINANCE, STRIDE
from summarize_water_gloss_scene import BOX, ROOT, camera_rays
from water_gloss import BOTTOM, IOR, LEVEL

CROPS = [(1, 'down', 680, 940, 0, 180), (2, 'level', 120, 420, 520, 720)]


def linear(path, scale):
    """Scene-linear RGB of a capture (sRGB-encoded HDR buffer times `scale`)."""
    v = np.asarray(Image.open(path).convert('RGB'), float) / 255
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4) / scale


def side_bounces(origin, ray):
    """Sides the refracted camera ray reflects off in the flat box before the bottom (−1: misses it)."""
    origin = np.asarray(origin, float)
    if ray[1] >= 0:
        return -1
    p = origin + ray * (LEVEL - origin[1]) / ray[1]
    if not (BOX[0] < p[0] < BOX[1] and BOX[2] < p[2] < BOX[3]):
        return -1
    d = np.array([ray[0] / IOR, 0.0, ray[2] / IOR])
    d[1] = -math.sqrt(1 - d[0] ** 2 - d[2] ** 2)
    for n in range(16):
        t, wall = (BOTTOM - p[1]) / d[1], None
        for axis, low, high in ((0, BOX[0], BOX[1]), (2, BOX[2], BOX[3])):
            if d[axis] != 0:
                s = ((high if d[axis] > 0 else low) - p[axis]) / d[axis]
                if s < t:
                    t, wall = s, axis
        p = p + d * t
        if wall is None:
            return n
        d[wall] = -d[wall]
    return -1


def blocks(a):
    h, w = a.shape[0] // STRIDE * STRIDE, a.shape[1] // STRIDE * STRIDE
    return a[:h, :w].reshape(h // STRIDE, STRIDE, w // STRIDE, STRIDE).mean((1, 3))


def top(a):
    return a >= np.quantile(a, 0.8)


def mean(a, mask):
    return float(a[mask].mean()) if mask.any() else None


def summarise(captures, scene_dir, bottom_dir):
    # The reporter's JSON follows the build's log lines.
    text = (captures / 'report.json').read_text()
    report = json.loads(text[text.index('\n{') + 1:] if not text.startswith('{') else text)
    attachments = [json.loads(base64.b64decode(a['body']))
                   for s in report['suites'] for spec in s['specs'] for t in spec['tests']
                   for r in t['results'] for a in r['attachments'] if a['name'] == 'water-gloss-capture']
    scale = attachments[0]['scale']
    assert all(a['scale'] == scale for a in attachments)
    view = json.loads((ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
    out, review = {}, []
    for heading, pitch, x0, x1, y0, y1 in CROPS:
        key = f'{heading}-{pitch}'
        load = lambda v: linear(captures / f'gloss-{v}-{key}.png', scale)[y0:y1, x0:x1]
        on, off, again = load('on'), load('off'), load('on-again')
        gloss = (on - off) @ LUMINANCE
        total = on @ LUMINANCE
        source = np.load(scene_dir / f'source-{key}.npz')
        cycles = source['gloss'] @ LUMINANCE
        fill = source['fillOn'] @ LUMINANCE
        combined = np.load(bottom_dir / f'base-{key}.npz')['Combined'] @ LUMINANCE
        ys, xs = np.mgrid[y0:y1, x0:x1]
        rays = camera_rays(view, heading, pitch, np.stack([xs.ravel(), ys.ravel()], 1))
        bounces = np.array([side_bounces(view['position'], r) for r in rays]).reshape(gloss.shape)
        spot, own = top(fill), top(total)
        parts = {'straight': bounces == 0, 'side': bounces > 0}
        cy, cx = np.mgrid[:gloss.shape[0], :gloss.shape[1]]
        centroid = lambda m: [float(cx[m].mean()), float(cy[m].mean())]
        out[key] = {
            'clippedFraction': float((np.stack([on, off, again]) >= 1 / scale - 1e-3).any(-1).mean()),
            'reloadMeanAbs': float(np.abs((on - again) @ LUMINANCE).mean()),
            'reloadChangedPixels': int((np.abs(on - again).max(-1) > 0).sum()),
            'cyclesSpot': {
                'browserGloss': mean(gloss, spot), 'cyclesGloss': mean(cycles, spot),
                'browserTotal': mean(total, spot), 'cyclesCombined': mean(combined, spot),
                'browserWithoutGloss': mean(off @ LUMINANCE, spot),
            },
            'ownSpots': {
                'browserTotal': mean(total, own), 'cyclesCombined': mean(combined, top(combined)),
                'overlap': float((own & top(combined)).sum() / own.sum()),
                'browserGloss': mean(gloss, own), 'cyclesGloss': mean(cycles, top(combined)),
                'browserCentroid': centroid(own), 'cyclesCentroid': centroid(top(combined)),
                'browserGlossCentroid': centroid(top(gloss)), 'cyclesGlossCentroid': centroid(top(cycles)),
            },
            'parts': {
                name: {
                    'pixels': int(m.sum()),
                    'spotPixels': int((m & spot).sum()),
                    'browserGloss': mean(gloss, m), 'cyclesGloss': mean(cycles, m),
                    'browserGlossInSpot': mean(gloss, m & spot), 'cyclesGlossInSpot': mean(cycles, m & spot),
                } for name, m in parts.items()
            },
            'crop': {'browserGloss': float(gloss.mean()), 'cyclesGloss': float(cycles.mean())},
            'blockCorrelation': float(np.corrcoef(blocks(gloss).ravel(), blocks(cycles).ravel())[0, 1]),
            'blockCorrelationStraight': float(np.corrcoef(blocks(gloss)[blocks(parts['straight'].astype(float)) == 1],
                                                          blocks(cycles)[blocks(parts['straight'].astype(float)) == 1])[0, 1]),
        }
        image = lambda a: np.repeat((np.clip(a / 0.15, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)[..., None], 3, -1)
        d = gloss - cycles
        diff = np.zeros(d.shape + (3,), np.uint8)
        diff[..., 0], diff[..., 2] = np.clip(d / 0.05, 0, 1) * 255, np.clip(-d / 0.05, 0, 1) * 255
        edge = np.zeros_like(diff)
        edge[parts['side']] = (60, 60, 0)
        review.append(np.hstack([image(gloss), image(cycles), np.maximum(diff, edge)]))
    width = max(r.shape[1] for r in review)
    review = np.vstack([np.pad(r, ((0, 4), (0, width - r.shape[1]), (0, 0))) for r in review])
    return scale, out, Image.fromarray(review)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('captures', type=Path, nargs='+', help='capture folders, each summarised under its name')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--scene', type=Path, default=ROOT / 'blender/diagnostics/water-gloss-scene')
    parser.add_argument('--bottom', type=Path, default=ROOT / 'blender/diagnostics/water-bottom-gloss')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    here = Path(__file__).resolve().parent
    runs, reviews = {}, []
    for captures in args.captures:
        scale, out, review = summarise(captures, args.scene, args.bottom)
        reviews.append(np.asarray(review))
        runs[captures.name] = {
            'scale': scale,
            'captures': {p.name: digest(p) for p in sorted(captures.glob('gloss-*.png'))},
            'results': out,
        }
    width = max(r.shape[1] for r in reviews)
    Image.fromarray(np.vstack([np.pad(r, ((0, 8), (0, width - r.shape[1]), (0, 0))) for r in reviews])).save(
        args.out / 'review.png')
    summary = {
        'crops': CROPS,
        'inputs': {
            'cycles': {p.name: digest(p) for p in [*(args.scene / f'source-{h}-{v}.npz' for h, v, *_ in CROPS),
                                                   *(args.bottom / f'base-{h}-{v}.npz' for h, v, *_ in CROPS),
                                                   args.scene / 'scene.json']},
            'test_sha256': digest(ROOT / 'e2e/water-gloss-capture.visual.ts'),
            'script_sha256': digest(here / 'summarize_water_gloss_capture.py'),
        },
        'runs': runs,
    }
    (args.out / 'capture.json').write_text(json.dumps(summary, indent=1) + '\n')
    for name, run in runs.items():
        for key, value in run['results'].items():
            parts = value['parts']
            print(name, key, 'own spot total %.4f / Cycles %.4f' % (value['ownSpots']['browserTotal'], value['ownSpots']['cyclesCombined']),
                  'gloss straight %.4f / %.4f side %.4f / %.4f' % (parts['straight']['browserGloss'], parts['straight']['cyclesGloss'],
                                                                  parts['side']['browserGloss'], parts['side']['cyclesGloss']))


if __name__ == '__main__':
    main()
