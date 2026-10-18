"""Validate the prop ABBA capture/cost records and retain review images.

python3 scripts/summarize_loyly_props.py visual report.json capture-root output-dir
python3 scripts/summarize_loyly_props.py cost report.json output-dir
"""
import base64
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def load(path, attachment, count):
    raw = path.read_text()
    report = json.loads(raw[raw.index('{'):])
    assert report['stats']['expected'] == count
    assert all(report['stats'][k] == 0 for k in ('unexpected', 'flaky', 'skipped'))
    rows = []
    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert len(test['results']) == 1 and test['results'][0]['status'] == 'passed'
                for a in test['results'][0]['attachments']:
                    if a['name'] == attachment:
                        rows.append(json.loads(base64.b64decode(a['body'])))
        for child in suite.get('suites', []):
            walk(child)
    for suite in report['suites']:
        walk(suite)
    assert len(rows) == count and len({r['browser'] for r in rows}) == 1
    assert all(not r['errors'] for r in rows)
    return rows


def visual(report, captures, out):
    runs = load(report, 'loyly-props', 4)
    assert [r['run'] for r in runs] == ['before-1', 'after-1', 'after-2', 'before-2']
    assert runs[0]['modelSha256'] == runs[3]['modelSha256']
    assert runs[1]['modelSha256'] == runs[2]['modelSha256'] != runs[0]['modelSha256']
    assert all(r['inputs'] == runs[0]['inputs'] and r['views'] == runs[0]['views'] for r in runs)
    expected = [(v['name'], t) for v in runs[0]['views'] for t in ('day', 'evening', 'night')]
    images = []
    for r in runs:
        roots = list(captures.glob('*loyly-props-' + r['run']))
        assert len(roots) == 1
        assert [(s['view'], s['lighting']) for s in r['captures']] == expected
        row = []
        for s in r['captures']:
            path = roots[0] / s['file']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == s['sha256']
            im = Image.open(path).convert('RGB')
            v = next(v for v in r['views'] if v['name'] == s['view'])
            assert im.size == (v['width'], v['height'])
            m = s['metrics']
            assert m['quality'] == 'standard' and m['pixelRatio'] == '1' and m['garden'] == 'ready'
            row.append(np.array(im, dtype=np.int16))
            if r['run'] in ('before-1', 'after-1'):
                shutil.copyfile(path, out / (r['run'].split('-')[0] + '-' + s['file']))
        images.append(row)
    def delta(a, b):
        d = np.abs(a - b)
        return {'pixels': int(np.any(d > 0, axis=2).sum()), 'max_channel': int(d.max()), 'mean_channel': float(d.mean())}
    changes = [dict(view=v, lighting=t, before_recapture=delta(images[0][i], images[3][i]),
                    after_recapture=delta(images[1][i], images[2][i]), change=delta(images[0][i], images[1][i]))
               for i, (v, t) in enumerate(expected)]
    sheet = Image.new('RGB', (1280, 4 * 420), '#202020')
    draw = ImageDraw.Draw(sheet)
    for row, i in enumerate((0, 3, 4, 5)):
        for col, run in enumerate((0, 1)):
            im = Image.fromarray(images[run][i].astype('uint8')).resize((640, 400))
            sheet.paste(im, (col * 640, row * 420 + 20))
            draw.text((col * 640 + 8, row * 420 + 3), f"{'before' if run == 0 else 'after'} {expected[i]}", fill='white')
    sheet.save(out / 'comparison.jpg', quality=94)
    result = {'runs': runs, 'changes': changes, 'report_sha256': hashlib.sha256(report.read_bytes()).hexdigest(),
              'scope': '48 static captures, standard DPR1 Chrome; no continuous-motion, real-device or FPS claim'}
    (out / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(changes, indent=2))


def cost(report, out):
    runs = load(report, 'loyly-cost', 5)
    assert [r['variant'] for r in runs] == ['warmup', 'original', 'candidate', 'candidate', 'original']
    assert all(r['inputHashes'] == runs[0]['inputHashes'] for r in runs)
    assert all(r['originalSha256'] == runs[0]['originalSha256'] and
               r['candidateSha256'] == runs[0]['candidateSha256'] for r in runs)
    assert all(r['requests'] == 1 and r['repeat'] == runs[0]['repeat'] for r in runs)
    runs = runs[1:]
    expected = [(s, t) for s in ('sauna', 'water', 'totonou') for t in ('day', 'night')]
    for r in runs:
        assert [(s['stage'], s['lighting']) for s in r['rows']] == expected
    results = []
    for i, (stage, lighting) in enumerate(expected):
        before = [runs[j]['rows'][i]['intervalMeanMs'] for j in (0, 3)]
        after = [runs[j]['rows'][i]['intervalMeanMs'] for j in (1, 2)]
        results.append(dict(stage=stage, lighting=lighting, before_ms=before, after_ms=after,
                            ratio=float(np.mean(after) / np.mean(before)),
                            delta_ms=float(np.mean(after) - np.mean(before))))
    result = {'scope': 'draw-issued rAF interval / repeat; not pure GPU time or device FPS',
              'report_sha256': hashlib.sha256(report.read_bytes()).hexdigest(), 'results': results, 'runs': runs}
    (out / 'cost.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    mode, *args = sys.argv[1:]
    paths = [Path(p) for p in args]
    paths[-1].mkdir(parents=True, exist_ok=True)
    {'visual': visual, 'cost': cost}[mode](*paths)
