"""Validate ABBA captures for seasonal light or controlled refraction motion.

Usage: python3 scripts/summarize_season_water.py <seasonal|sway> <before1.json>
       <after1.json> <after2.json> <before2.json> <output-dir>
PNG files live under the report's outputDir. Images remain local, JSON is tracked.
"""
import base64
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw


def walk(suites):
    for suite in suites:
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                yield from test['results']
        yield from walk(suite.get('suites', []))


def load(path, attachment, count):
    report = json.loads(path.read_text())
    stats = report['stats']
    assert stats['expected'] == 1 and not any(stats[k] for k in ['unexpected', 'flaky', 'skipped']) and not report['errors'], stats
    results = list(walk(report['suites']))
    assert len(results) == 1 and results[0]['status'] == 'passed'
    body = [a for a in results[0]['attachments'] if a['name'] == attachment]
    assert len(body) == 1
    data = json.loads(base64.b64decode(body[0]['body']))
    assert not data['errors'] and len(data['samples']) == count
    assert len({s['file'] for s in data['samples']}) == count
    root = Path(report['config']['projects'][0]['outputDir'])
    files = {}
    for sample in data['samples']:
        matches = list(root.rglob(sample['file']))
        assert len(matches) == 1
        with Image.open(matches[0]) as image:
            assert image.size == (1280, 800)
        files[sample['file']] = matches[0]
    return dict(stats=stats, report_sha256=hashlib.sha256(path.read_bytes()).hexdigest(), data=data,
                png_sha256={name: hashlib.sha256(p.read_bytes()).hexdigest() for name, p in files.items()}), files


def pixels(path):
    with Image.open(path) as image:
        return np.asarray(image.convert('RGB'), dtype=np.int16)


def difference(a, b):
    delta = np.abs(a - b)
    return dict(mean_rgb=float(delta.mean()), different_pixels=int(np.any(delta != 0, axis=2).sum()),
                max_rgb=int(delta.max()))


def main(mode, reports, out):
    assert mode in ['seasonal', 'sway']
    tag, count = ('season-light', 36) if mode == 'seasonal' else ('refraction-sway', 152)
    labels = ['before1', 'after1', 'after2', 'before2']
    records, paths = {}, {}
    for label, path in zip(labels, reports):
        records[label], paths[label] = load(path, tag, count)
    reference = records['before1']['data']
    for data in [v['data'] for v in records.values()]:
        assert data['browser'] == reference['browser']
        assert data['viewport'] == reference['viewport'] == dict(width=1280, height=800)
        assert [{k: v for k, v in s.items() if k != 'metrics'} for s in data['samples']] == [
            {k: v for k, v in s.items() if k != 'metrics'} for s in reference['samples']]
        for name, digest in data['hashes'].items():
            if name.startswith('public/') or name.startswith('e2e/') or (mode == 'sway' and name.endswith(('irradiance.ts', 'waterBottom.ts', 'seasonal-light.json'))):
                assert digest == reference['hashes'][name], name
    for first, second in [('before1', 'before2'), ('after1', 'after2')]:
        assert records[first]['data']['hashes'] == records[second]['data']['hashes']
    out.mkdir(parents=True, exist_ok=True)
    changes = []
    for sample in reference['samples']:
        name = sample['file']
        arrays = {label: pixels(paths[label][name]) for label in labels}
        row = dict(sample=sample,
                   before_repeat=difference(arrays['before1'], arrays['before2']),
                   after_repeat=difference(arrays['after1'], arrays['after2']),
                   changed=difference(arrays['before1'], arrays['after1']))
        if mode == 'seasonal':
            assert sample['metrics']['pixelRatio'] == '1' and sample['metrics']['garden'] == 'ready'
            assert all(v['data']['samples'][len(changes)]['metrics']['pixelRatio'] == '1' for v in records.values())
        changes.append(row)
    series = []
    if mode == 'sway':
        for lighting in ['day', 'evening']:
            for heading, pitch in [(0, 'level'), (1, 'down')]:
                samples = [s for s in reference['samples'] if s['lighting'] == lighting and s['heading'] == heading and s['mode'] == 'moving']
                assert len(samples) == 36 and [s['frame'] for s in samples] == list(range(36))
                times = np.array([s['clock']['now'] for s in samples])
                counts = np.array([s['clock']['count'] for s in samples])
                assert np.allclose(np.diff(times), 1000 / 60, atol=1e-6) and np.all(np.diff(counts) == 2)
                metrics = {}
                for label in labels:
                    # Bound memory: fixed water ROI, sRGB-weighted luma (not L*).
                    crop = (slice(440, 760), slice(128, 1152)) if pitch == 'level' else (slice(120, 680), slice(192, 1088))
                    frames = np.array([pixels(paths[label][s['file']])[crop] @ np.array([.2126, .7152, .0722]) for s in samples], dtype=np.float32)
                    metrics[label] = dict(frame_change=float(np.abs(np.diff(frames, axis=0)).mean()),
                                          second_difference=float(np.abs(np.diff(frames, n=2, axis=0)).mean()))
                still = {}
                for label in labels:
                    names = [s['file'] for s in reference['samples'] if s['lighting'] == lighting and s['heading'] == heading and s['mode'] == 'reduced']
                    still[label] = difference(pixels(paths[label][names[0]]), pixels(paths[label][names[1]]))
                series.append(dict(lighting=lighting, heading=heading, pitch=pitch, roi='level 128,440..1152,760; down 192,120..1088,680', metrics=metrics, reduced_repeat=still))
    # Full-size paired images for manual review; no automatic perceptual verdict.
    names = ['totonou-winter-day.png', 'water-winter-evening.png', 'sauna-autumn-day.png'] if mode == 'seasonal' else [
        f'{lighting}-1-down-moving-{frame:03}.png' for lighting in ['day', 'evening'] for frame in [0, 17, 35]]
    for i, name in enumerate(names):
        sheet = Image.new('RGB', (2560, 824), '#182020'); draw = ImageDraw.Draw(sheet)
        for col, label in enumerate(['before1', 'after1']):
            with Image.open(paths[label][name]) as image:
                sheet.paste(image, (col * 1280, 24))
            draw.text((col * 1280 + 8, 6), f'{label} / {name}', fill='white')
        sheet.save(out / f'comparison-{i}.jpg', quality=95)
    result = dict(note='ABBA, bounded static/controlled-clock evidence; not perceived flicker, FPS, real Safari or device validation.',
                  mode=mode, runs=records, changes=changes, series=series)
    (out / 'validation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(mode, 'passed runs', len(records), 'images', count * 4)
    for label in labels:
        print(label, records[label]['stats']['duration'])
    for s in series:
        print(s['lighting'], s['heading'], s['metrics'], 'still', s['reduced_repeat'])


if __name__ == '__main__':
    if len(sys.argv) != 7:
        raise SystemExit(__doc__)
    main(sys.argv[1], [Path(p) for p in sys.argv[2:6]], Path(sys.argv[6]))
