"""Summarize e2e/sun-shadow.gpu.ts JSON; compare full-resolution captures and Cycles at 600x400.

python3 scripts/summarize_sun_shadow.py /tmp/sauna-sun-shadow.json docs/3d-qa/sun-shadow
Requires NumPy/Pillow; input captures and Cycles renders must remain available locally.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from summarize_water_side_images import lab, load


def results(suites):
    for suite in suites:
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                yield from test['results']
        yield from results(suite.get('suites', []))


def stats(a, b):
    delta = np.linalg.norm(a - b, axis=-1)
    return dict(mean=float(delta.mean()), p99=float(np.percentile(delta, 99)),
                over2Percent=float((delta > 2).mean() * 100),
                overHalfPercent=float((delta > 0.5).mean() * 100), maximum=float(delta.max()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    raw = args.report.read_text()
    report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
    if report['errors'] or report['stats']['unexpected'] or report['stats']['skipped']:
        raise SystemExit('Incomplete run: inspect report first')
    runs = {}
    for result in results(report['suites']):
        if result['status'] != 'passed':
            raise SystemExit('Failed capture')
        for attachment in result.get('attachments', []):
            if attachment['name'] == 'sun-shadow':
                run = json.loads(base64.b64decode(attachment['body']))
                if run['mode'] in runs:
                    raise SystemExit('Duplicate variant')
                runs[run['mode']] = run
    modes = ['original', 'hard', 'off', 'original-repeat']
    if set(runs) != set(modes):
        raise SystemExit('Missing variant')
    names = [s['file'] for s in runs['original']['samples']]
    for run in runs.values():
        if [s['file'] for s in run['samples']] != names or run['hashes'] != runs['original']['hashes']:
            raise SystemExit('Capture inputs differ')
    args.output.mkdir(parents=True, exist_ok=True)
    summary = dict(conditions={k: runs['original'][k] for k in ['browser', 'viewport', 'quality', 'reducedMotion', 'hashes']},
                   durationSeconds=report['stats']['duration'] / 1000, views={}, gpu={}, referenceHashes={})
    for name in names:
        paths = {mode: Path(runs[mode]['dir']) / name for mode in modes}
        images = {mode: Image.open(path).convert('RGB') for mode, path in paths.items()}
        values = {mode: lab(image) for mode, image in images.items()}
        row = {'captureNoise': stats(values['original'], values['original-repeat']),
               'change': {mode: stats(values['original'], values[mode]) for mode in ['hard', 'off']}}
        reference = None
        if name.startswith('cycles-'):
            render = name.removeprefix('cycles-')
            reference = Path('blender/renders/06.png') if render == '01.png' else Path('blender/renders/web-bluehour') / render
            summary['referenceHashes'][str(reference)] = hashlib.sha256(reference.read_bytes()).hexdigest()
            ref = load(reference)
            resized = {mode: load(path) for mode, path in paths.items()}
            row['cycles600x400'] = {mode: stats(ref, image) for mode, image in resized.items()}
            row['changedRegionsVsCycles'] = {}
            for mode in ['hard', 'off']:
                mask = np.linalg.norm(resized[mode] - resized['original'], axis=-1) > 0.5
                row['changedRegionsVsCycles'][mode] = dict(thresholdDeltaE=0.5, percent=float(mask.mean() * 100), **({
                    'original': stats(ref[mask], resized['original'][mask]),
                    'candidate': stats(ref[mask], resized[mode][mask]),
                } if mask.any() else {}))
        summary['views'][name] = row
        # Same-view sheet with a reference where available. Artifacts for manual review.
        entries = ([('Cycles', Image.open(reference).convert('RGB'))] if reference else []) + [(m, images[m]) for m in modes[:3]]
        sheet = Image.new('RGB', (600 * len(entries), 425), '#222222')
        draw = ImageDraw.Draw(sheet)
        for i, (label, image) in enumerate(entries):
            draw.text((i * 600 + 10, 6), label, fill='white')
            sheet.paste(image.resize((600, 400), Image.Resampling.BOX), (i * 600, 25))
        sheet.save(args.output / name.replace('.png', '.jpg'), quality=92)
    for mode, run in runs.items():
        summary['gpu'][mode] = {}
        for sample in run['samples']:
            if sample['file'].startswith('stage-'):
                times = sample['times']
                summary['gpu'][mode][sample['stage']] = dict(frames=len(times),
                    quantilesMs=np.percentile(times, [10, 50, 90]).tolist() if times else None,
                    calls=sample['metrics'].get('drawCalls'), triangles=sample['metrics'].get('triangles'))
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    (args.output / 'runs.json').write_text(json.dumps(runs, indent=2) + '\n')
    print(json.dumps({'gpu': summary['gpu'], 'views': summary['views']}, indent=2))


if __name__ == '__main__':
    main()
