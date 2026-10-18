"""Validate same-build ABBA captures; report static changes, not perceptual quality.

python3 scripts/summarize_room_light.py <report.json> <capture-root> <output-dir>
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def summarize(report_path, captures, output):
    raw = report_path.read_text()
    report = json.loads(raw[raw.index('{'):])
    assert report['stats']['expected'] == 4
    assert all(report['stats'][k] == 0 for k in ('unexpected', 'flaky', 'skipped'))
    runs = []
    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert len(test['results']) == 1 and test['results'][0]['status'] == 'passed'
                for a in test['results'][0]['attachments']:
                    if a['name'] == 'room-light.json':
                        runs.append(json.loads(base64.b64decode(a['body'])))
        for child in suite.get('suites', []):
            walk(child)
    for suite in report['suites']:
        walk(suite)
    assert [r['run'] for r in runs] == ['before-1', 'after-1', 'after-2', 'before-2']
    assert [r['enabled'] for r in runs] == [False, True, True, False]
    assert len({r['directory'] for r in runs}) == 4
    assert len({r['browser'] for r in runs}) == 1
    assert all(r['inputs'] == runs[0]['inputs'] and not r['errors'] for r in runs)
    expected = [(view, time) for view in ('seated', 'rear', 'review') for time in ('day', 'evening', 'night')]
    images, hashes = [], {}
    for r in runs:
        assert [(s['view'], s['lighting']) for s in r['captures']] == expected
        row = []
        for s in r['captures']:
            path = captures / r['directory'] / s['file']
            im = Image.open(path).convert('RGB')
            assert im.size == (1280, 800)
            m = s['metrics']
            assert m['quality'] == 'standard' and m['pixelRatio'] == '1' and m['garden'] == 'ready'
            assert m['roomIrradianceMaterials'] == '2'
            row.append(np.array(im, dtype=np.int16))
            hashes[f"{r['run']}/{s['file']}"] = hashlib.sha256(path.read_bytes()).hexdigest()
        images.append(row)
    def delta(a, b):
        d = np.abs(a - b)
        return dict(changed_pixels=int(np.any(d > 0, axis=2).sum()), max_channel=int(d.max()), mean_channel=float(d.mean()))
    views = [dict(view=v, lighting=t, before_recapture=delta(images[0][i], images[3][i]),
                  after_recapture=delta(images[1][i], images[2][i]),
                  changes=[delta(images[0][i], images[1][i]), delta(images[3][i], images[2][i])])
             for i, (v, t) in enumerate(expected)]
    output.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGB', (1280, 6 * 420), '#202020')
    draw = ImageDraw.Draw(sheet)
    for row, i in enumerate((0, 2, 3, 5, 6, 8)):
        for col, r in enumerate((0, 1)):
            sheet.paste(Image.fromarray(images[r][i].astype('uint8')).resize((640, 400)), (col * 640, row * 420 + 20))
            draw.text((col * 640 + 5, row * 420 + 3), f"{'before' if r == 0 else 'after'} {expected[i]}", fill='white')
    sheet.save(output / 'comparison.jpg', quality=95)
    result = dict(browser=runs[0]['browser'], inputs=runs[0]['inputs'],
                  report_sha256=hashlib.sha256(report_path.read_bytes()).hexdigest(), captures=hashes, views=views,
                  scope='same-build shader ablation; standard DPR1 static views; not device FPS or continuous-motion approval')
    (output / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(views, indent=2))


if __name__ == '__main__':
    summarize(*(Path(p) for p in sys.argv[1:]))
