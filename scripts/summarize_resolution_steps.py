"""Summarise e2e/resolution-steps.visual.ts: how the dynamic resolution steps change the image.

python3 scripts/summarize_resolution_steps.py <report.json> <captures dir> <out dir>

<report.json> is Playwright's JSON reporter output (build logs before the first `{` are skipped),
<captures dir> the test's output folder under test-results/visual/. Per view the captures at ratio
1.25 and 1, and the repeat at 1.5 (after a quality change; the capture noise), are compared with the
first capture at 1.5: the CIELAB ΔE76 (sRGB, D65) mean and the shares of pixels over 2 and 5, whole
and in the centre (20% margins cut), and the detail kept, the mean gradient magnitude of L* as a
share of the 1.5 capture's (the browser scales a lower ratio's canvas up, which blurs edges).
Writes <out dir>/steps.json and, for local review only, <out dir>/crops-<stage>-<lighting>.png: the
200×150 window of the largest ΔE at ratio 1 of that stage and lighting, at 1.5, 1.25 and 1, three
times enlarged.
"""

import argparse
import base64
import hashlib
import json
import statistics
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_frame_cost import srgb_lab

CROP = (200, 150)
ZOOM = 3


def samples(report_path):
    text = Path(report_path).read_text()
    report = json.loads(text[text.index('\n{') + 1 if not text.startswith('{') else 0:])

    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                for result in test['results']:
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == 'resolution-steps':
                            yield json.loads(base64.b64decode(attachment['body']))
        for child in suite.get('suites', []):
            yield from walk(child)

    found = [body for suite in report['suites'] for body in walk(suite)]
    if len(found) != 1:
        raise SystemExit(f'{len(found)} resolution-steps attachments')
    return found[0]['samples']


def gradient(lab):
    l = lab[..., 0]
    return float(np.hypot(np.diff(l, axis=1)[:-1], np.diff(l, axis=0)[:, :-1]).mean())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('report')
    parser.add_argument('captures')
    parser.add_argument('out')
    args = parser.parse_args()
    captures, out = Path(args.captures), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    views = {}
    for sample in samples(args.report):
        views.setdefault((sample['stage'], sample['lighting'], sample['view']), []).append(sample)
    rows, crops = [], {}
    for (stage, lighting, view), steps in views.items():
        if [(s['ratio'], s['repeat']) for s in steps] != [(1.5, False), (1.25, False), (1, False), (1.5, True)]:
            raise SystemExit(f'{stage} {lighting} {view}: unexpected steps {steps}')
        images = [np.asarray(Image.open(captures / s['file']).convert('RGB')) for s in steps]
        labs = [srgb_lab(image.astype(float)) for image in images]
        base_gradient = gradient(labs[0])
        row = {'stage': stage, 'lighting': lighting, 'view': view,
               'files': [s['file'] for s in steps], 'canvasWidths': [s['canvasWidth'] for s in steps],
               'sha256': [hashlib.sha256((captures / s['file']).read_bytes()).hexdigest() for s in steps],
               'size': list(images[0].shape[1::-1])}
        for name, lab in (('1.25', labs[1]), ('1', labs[2]), ('repeat', labs[3])):
            d = np.linalg.norm(lab - labs[0], axis=-1)
            h, w = d.shape
            m = int(min(h, w) * 0.2)
            row[name] = {'meanDeltaE': round(float(d.mean()), 4), 'over2': round(float((d > 2).mean()), 5),
                         'over5': round(float((d > 5).mean()), 5),
                         'centreOver5': round(float((d[m:h - m, m:w - m] > 5).mean()), 5),
                         'detail': round(gradient(lab) / base_gradient, 4)}
            if name == '1':
                # The window of the largest mean ΔE, on a grid of half windows.
                cw, ch = CROP
                best = max(((float(d[y:y + ch, x:x + cw].mean()), x, y)
                            for y in range(0, h - ch + 1, ch // 2) for x in range(0, w - cw + 1, cw // 2)))
                if best[0] > crops.get((stage, lighting), (0,))[0]:
                    crops[(stage, lighting)] = (best[0], best[1], best[2], view, images[:3])
        rows.append(row)
    for (stage, lighting), (_, x, y, view, images) in crops.items():
        cw, ch = CROP
        sheet = Image.new('RGB', (3 * cw * ZOOM + 2 * 8, ch * ZOOM), 'white')
        for n, image in enumerate(images):
            tile = Image.fromarray(image[y:y + ch, x:x + cw]).resize((cw * ZOOM, ch * ZOOM), Image.NEAREST)
            sheet.paste(tile, (n * (cw * ZOOM + 8), 0))
        sheet.save(out / f'crops-{stage}-{lighting}.png')
    summary = {}
    for name in ('1.25', '1', 'repeat'):
        summary[name] = {key: {'median': statistics.median(r[name][key] for r in rows),
                               'max': max(r[name][key] for r in rows),
                               'min': min(r[name][key] for r in rows)}
                         for key in ('meanDeltaE', 'over2', 'over5', 'centreOver5', 'detail')}
    result = {'note': 'Each view compared with its first capture at ratio 1.5 (display 1200x800 at 1.5, '
                      'captures 1800x1200). detail: mean |grad L*| as a share of the 1.5 capture.',
              'summary': summary, 'crops': {f'{s}-{l}': {'view': c[3], 'x': c[1], 'y': c[2], 'meanDeltaE': round(c[0], 3)}
                                            for (s, l), c in crops.items()},
              'views': rows}
    (out / 'steps.json').write_text(json.dumps(result, indent=1, ensure_ascii=False) + '\n')
    for name, values in summary.items():
        print(name, {key: v['median'] for key, v in values.items()})
    for row in rows:
        print(row['stage'], row['lighting'], row['view'],
              *(f"{n}: ΔE {row[n]['meanDeltaE']} >5 {row[n]['over5']} detail {row[n]['detail']}"
                for n in ('1.25', '1', 'repeat')))


if __name__ == '__main__':
    main()
