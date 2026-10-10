"""Validate warmup ABBA full-surround captures, including replay noise."""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('report', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--quality', choices=['standard', 'high'], default='standard')
args = parser.parse_args()
report_path, output = args.report, args.output
raw = report_path.read_text()
report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
assert not report['errors']
assert report['stats']['expected'] == 4
assert all(report['stats'][key] == 0 for key in ['unexpected', 'skipped', 'flaky'])
runs = []
seen_paths = set()
root = output.parent / 'surround-captures'
expected = [(s, l, h, p) for s in ['sauna', 'water', 'totonou']
            for l in ['day', 'evening', 'night'] for h in range(8)
            for p in ['down', 'level', 'up']]

def visit(suites):
    for suite in suites:
        visit(suite.get('suites', []))
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert test['status'] == 'expected' and len(test['results']) == 1
                result = test['results'][0]
                assert result['status'] == 'passed'
                attachments = result['attachments']
                meta_item, = [a for a in attachments if a['name'] == 'warmup-surround']
                meta = json.loads(base64.b64decode(meta_item['body']))
                index = len(runs)
                assert meta['index'] == index
                assert meta['variant'] == ['normal', 'split', 'split', 'normal'][index]
                assert meta['requests'] == 1 and not meta['errors']
                assert meta['quality'] == args.quality and meta['dpr'] == 1 and meta['reducedMotion']
                assert meta['viewport'] == {'width': 1200, 'height': 800}
                assert [(r['stage'], r['lighting'], r['heading'], r['pitch']) for r in meta['rows']] == expected
                images = [a for a in attachments if a['contentType'] == 'image/png']
                assert len(images) == len(expected)
                directory = root / str(index)
                directory.mkdir(parents=True, exist_ok=True)
                for row in meta['rows']:
                    name = f"{row['stage']}-{row['lighting']}-{row['heading']}-{row['pitch']}"
                    item, = [a for a in images if a['name'] == name]
                    if 'path' in item:
                        source = Path(item['path']).resolve()
                        assert source not in seen_paths, ('Shared capture path', source)
                        seen_paths.add(source)
                    data = Path(item['path']).read_bytes() if 'path' in item else base64.b64decode(item['body'])
                    assert hashlib.sha256(data).hexdigest() == row['imageSha256']
                    (directory / f'{name}.png').write_bytes(data)
                    metrics = row['metrics']
                    assert metrics['stage'] == row['stage'] and metrics['lighting'] == row['lighting']
                    assert metrics['garden'] == 'ready' and metrics['quality'] == args.quality
                    assert float(metrics['pixelRatio']) == 1
                    if meta['variant'] == 'split':
                        assert metrics['warmup'] == 'split' and metrics['warming'] == 'none'
                        assert metrics['warmupUndrawn'] == metrics['gardenWarmupUndrawn'] == '0'
                runs.append(meta)

visit(report['suites'])
assert len(runs) == 4 and len({r['browser'] for r in runs}) == 1
assert all(r['inputHashes'] == runs[0]['inputHashes'] for r in runs)
for path, digest in runs[0]['inputHashes'].items():
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, ('Changed input', path)
comparisons = {}
for label, a, b in [('firstPair', 0, 1), ('secondPair', 3, 2), ('normalReplay', 0, 3), ('splitReplay', 1, 2)]:
    rows = []
    for stage, lighting, heading, pitch in expected:
        name = f'{stage}-{lighting}-{heading}-{pitch}.png'
        first = np.asarray(Image.open(root / str(a) / name).convert('RGB'), dtype=np.int16)
        second = np.asarray(Image.open(root / str(b) / name).convert('RGB'), dtype=np.int16)
        assert first.shape == second.shape == (800, 1200, 3)
        delta = np.abs(first - second)
        rows.append({'image': name, 'changedPixels': int(np.any(delta, axis=-1).sum()),
                     'maxChannelDifference': int(delta.max()), 'meanChannelDifference': float(delta.mean())})
    comparisons[label] = rows
    worst = sorted(rows, key=lambda row: row['changedPixels'], reverse=True)[:3]
    sheet = Image.new('RGB', (1800, 3 * 422), '#181818')
    draw = ImageDraw.Draw(sheet)
    for y, row in enumerate(worst):
        first_image = Image.open(root / str(a) / row['image']).convert('RGB')
        second_image = Image.open(root / str(b) / row['image']).convert('RGB')
        delta = np.abs(np.asarray(first_image, dtype=np.int16) - np.asarray(second_image, dtype=np.int16))
        amplified = Image.fromarray(np.minimum(delta * 8, 255).astype(np.uint8))
        for x, image in enumerate([first_image, second_image, amplified]):
            image.thumbnail((600, 400))
            sheet.paste(image, (x * 600, y * 422 + 22))
        draw.text((3, y * 422 + 3), f"{row['image']}: {row['changedPixels']} changed pixels; run {a} / run {b} / absolute RGB diff x8", fill='white')
    sheet.save(output.parent / f'surround-difference-{label}.jpg', quality=90)
# All 216 split views on nine local review sheets. Images stay out of Git.
for stage in ['sauna', 'water', 'totonou']:
    for lighting in ['day', 'evening', 'night']:
        sheet = Image.new('RGB', (8 * 300, 3 * 222), '#181818')
        draw = ImageDraw.Draw(sheet)
        for h in range(8):
            for y, pitch in enumerate(['down', 'level', 'up']):
                image = Image.open(root / '1' / f'{stage}-{lighting}-{h}-{pitch}.png').convert('RGB')
                image.thumbnail((300, 200))
                sheet.paste(image, (h * 300, y * 222 + 22))
                draw.text((h * 300 + 3, y * 222 + 3), f'{h}: {pitch}', fill='white')
        sheet.save(output.parent / f'surround-{stage}-{lighting}.jpg', quality=90)
summary = {'reportSha256': hashlib.sha256(report_path.read_bytes()).hexdigest(), 'browser': runs[0]['browser'], 'stats': report['stats'],
           'inputHashes': runs[0]['inputHashes'], 'runs': runs, 'comparisons': comparisons,
           'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
           'quality': args.quality,
           'note': f'Static {args.quality}-quality/DPR1 ABBA survey, 216 views per run. Replay differences are separate. No real-motion, shadow-update/load-cost, driver-memory or mobile approval.'}
output.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({label: {'views': len(rows), 'changedViews': sum(r['changedPixels'] > 0 for r in rows),
                        'maxChangedPixels': max(r['changedPixels'] for r in rows),
                        'maxChannelDifference': max(r['maxChannelDifference'] for r in rows)}
                  for label, rows in comparisons.items()}, indent=2))
