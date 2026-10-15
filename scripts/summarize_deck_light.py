"""Validate the four ABBA captures and retain image hashes and recapture differences.

python3 scripts/summarize_deck_light.py <report.json> <capture-root> <output-directory>
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from summarize_water_bump import lab


def summarize(report_path, captures, output):
    raw = report_path.read_text()
    report = json.loads(raw[raw.index('{'):])
    assert report['stats']['expected'] == 4
    assert all(report['stats'][key] == 0 for key in ('unexpected', 'flaky', 'skipped'))
    runs = []

    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert len(test['results']) == 1 and test['results'][0]['status'] == 'passed'
                for attachment in test['results'][0]['attachments']:
                    if attachment['name'] == 'deck-light.json':
                        runs.append(json.loads(base64.b64decode(attachment['body'])))
        for child in suite.get('suites', []):
            walk(child)
    for suite in report['suites']:
        walk(suite)
    assert [r['run'] for r in runs] == ['before-1', 'after-1', 'after-2', 'before-2']
    assert len({r['browser'] for r in runs}) == 1
    assert all(r['inputs'] == runs[0]['inputs'] for r in runs)
    expected = [(stage, time) for stage in ('sauna', 'water', 'totonou') for time in ('day', 'evening', 'night')]
    images = []
    hashes = {}
    for run in runs:
        assert [(s['stage'], s['lighting']) for s in run['captures']] == expected
        row = []
        for sample in run['captures']:
            path = captures / run['directory'] / sample['file']
            image = Image.open(path).convert('RGB')
            assert image.size == (1200, 800)
            assert sample['metrics']['quality'] == 'standard'
            assert sample['metrics']['pixelRatio'] == '1'
            row.append(np.array(image, dtype=np.int16))
            hashes[f"{run['run']}/{sample['file']}"] = hashlib.sha256(path.read_bytes()).hexdigest()
        images.append(row)

    def delta(a, b):
        diff = np.abs(a - b)
        return dict(changed_pixels=int(np.any(diff > 0, axis=2).sum()),
                    max_channel=int(diff.max()), mean_channel=float(diff.mean()))

    views = []
    for i, (stage, time) in enumerate(expected):
        views.append(dict(stage=stage, lighting=time,
                          before_recapture=delta(images[0][i], images[3][i]),
                          after_recapture=delta(images[1][i], images[2][i]),
                          changes=[delta(images[0][i], images[1][i]), delta(images[3][i], images[2][i])]))
    output.mkdir(parents=True, exist_ok=True)
    # 07 evening/night side by side, control above candidate. Full views, not ROI-only.
    sheet = Image.new('RGB', (1200, 840), '#202020')
    draw = ImageDraw.Draw(sheet)
    for col, i in enumerate((7, 8)):
        for row, r in enumerate((0, 1)):
            tile = Image.fromarray(images[r][i].astype(np.uint8)).resize((600, 400))
            sheet.paste(tile, (col * 600, row * 420 + 20))
            draw.text((col * 600 + 8, row * 420 + 4), f"{'before' if row == 0 else 'after'} / {expected[i][1]}", fill='white')
    sheet.save(output / 'comparison.jpg', quality=94)
    result = dict(browser=runs[0]['browser'], inputs=runs[0]['inputs'],
                  report_sha256=hashlib.sha256(report_path.read_bytes()).hexdigest(),
                  captures=hashes, views=views,
                  scope='same-build shader ablation; standard DPR1 static views; not device FPS or continuous motion')
    references = []
    for i, folder in ((7, 'web-bluehour'), (8, 'web-night')):
        path = Path('blender/renders') / folder / '07.png'
        reference = Image.open(path).convert('RGB')
        pair = [np.asarray(Image.fromarray(images[r][i].astype(np.uint8)).resize(reference.size, Image.Resampling.BICUBIC), dtype=np.int16)
                for r in (0, 1)]
        mask = np.max(np.abs(pair[0] - pair[1]), axis=2) > 8
        errors = [np.linalg.norm(lab(a) - lab(np.asarray(reference)), axis=2)[mask] for a in pair]
        references.append(dict(lighting=expected[i][1], reference_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                               size=list(reference.size), changed_pixels=int(mask.sum()),
                               before_deltaE=float(errors[0].mean()), after_deltaE=float(errors[1].mean())))
    result['reference'] = references
    (output / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(views, indent=2))


if __name__ == '__main__':
    summarize(*(Path(p) for p in sys.argv[1:]))
