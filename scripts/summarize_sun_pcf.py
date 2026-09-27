"""Summarize SUN_SHADOW_REVIEW=1 sun-shadow.gpu.ts captures and reverse-order timings.

python3 scripts/summarize_sun_pcf.py <report.json> <output>
Motion statistics are temporal changes of candidate-minus-PCSS error, not perceptual flicker scores.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from summarize_sun_shadow import results, stats
from summarize_water_side_images import lab, load


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    raw = args.report.read_text()
    report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
    if report['errors'] or any(report['stats'][key] for key in ['unexpected', 'skipped', 'flaky']):
        raise SystemExit('Incomplete run')
    runs = {}
    for result in results(report['suites']):
        if result['status'] != 'passed':
            raise SystemExit('Failed capture')
        for attachment in result.get('attachments', []):
            if attachment['name'] == 'sun-shadow':
                run = json.loads(base64.b64decode(attachment['body']))
                if run['mode'] in runs:
                    raise SystemExit('Duplicate mode')
                runs[run['mode']] = run
    expected = ['original', 'hard', 'pcf', 'original-repeat', 'pcf-repeat', 'hard-repeat', 'original-final']
    if list(runs) != expected:
        raise SystemExit('Missing/reordered run')
    baseline = runs['original']
    names = [s['file'] for s in baseline['samples']]
    stages = ['sauna', 'water', 'totonou']
    for mode, run in runs.items():
        required = names if mode in expected[:4] else [f'stage-{stage}.png' for stage in stages]
        if [s['file'] for s in run['samples']] != required:
            raise SystemExit('Mismatched captures')
        if any(run[key] != baseline[key] for key in ['hashes', 'browser', 'viewport', 'quality', 'reducedMotion']):
            raise SystemExit('Mismatched inputs')
        if run['errors']:
            raise SystemExit('Browser errors')
    args.output.mkdir(parents=True, exist_ok=True)
    summary = dict(conditions={k: baseline[k] for k in ['browser', 'viewport', 'quality', 'reducedMotion', 'hashes']},
                   durationSeconds=report['stats']['duration'] / 1000, views={}, gpu={}, motion={}, referenceHashes={})
    prior = {}
    sheets = {stage: Image.new('RGB', (1200, 8 * 220), '#222222') for stage in stages}
    for name in names:
        images = {mode: Image.open(Path(runs[mode]['dir']) / name).convert('RGB') for mode in expected[:4]}
        values = {mode: lab(image) for mode, image in images.items()}
        summary['views'][name] = row = dict(captureNoise=stats(values['original'], values['original-repeat']),
            change={mode: stats(values['original'], values[mode]) for mode in ['hard', 'pcf']})
        if '-move-' in name:
            stage, step = name.split('-move-')
            for mode in ['hard', 'pcf']:
                error = values[mode] - values['original']
                key = f'{stage}-{mode}'
                if key in prior:
                    summary['motion'].setdefault(key, []).append(stats(error, prior[key]))
                prior[key] = error
        if name.startswith('cycles-'):
            render = name.removeprefix('cycles-')
            refpath = Path('blender/renders/06.png') if render == '01.png' else Path('blender/renders/web-bluehour') / render
            summary['referenceHashes'][str(refpath)] = hashlib.sha256(refpath.read_bytes()).hexdigest()
            ref = load(refpath)
            resized = {mode: load(Path(runs[mode]['dir']) / name) for mode in expected[:3]}
            row['cycles600x400'] = {mode: stats(ref, value) for mode, value in resized.items()}
            row['changedRegionsVsCycles'] = {}
            for mode in ['hard', 'pcf']:
                mask = np.linalg.norm(resized[mode] - resized['original'], axis=-1) > 0.5
                row['changedRegionsVsCycles'][mode] = dict(percent=float(mask.mean() * 100), **({
                    'original': stats(ref[mask], resized['original'][mask]),
                    'candidate': stats(ref[mask], resized[mode][mask])} if mask.any() else {}))
        if name.startswith(('stage-', 'cycles-')):
            sheet = Image.new('RGB', (1800, 425), '#222222')
            for i, mode in enumerate(expected[:3]):
                ImageDraw.Draw(sheet).text((600 * i + 8, 6), mode, fill='white')
                sheet.paste(images[mode].resize((600, 400), Image.Resampling.BOX), (600 * i, 25))
            sheet.save(args.output / name.replace('.png', '.jpg'), quality=92)
        crops = {'totonou-survey-5-0.png': (640, 320), 'stage-sauna.png': (40, 160)}
        if name in crops:
            x, y = crops[name]
            sheet = Image.new('RGB', (1800, 505), '#222222')
            for i, mode in enumerate(expected[:3]):
                ImageDraw.Draw(sheet).text((600 * i + 10, 5), mode, fill='white')
                sheet.paste(images[mode].crop((x, y, x + 300, y + 240)).resize((600, 480)), (600 * i, 25))
            sheet.save(args.output / ('crop-' + name.replace('.png', '.jpg')), quality=95)
        if '-survey-' in name and name.endswith('-0.png'):
            stage, rest = name.split('-survey-')
            heading = int(rest.split('-')[0])
            for i, mode in enumerate(expected[:3]):
                ImageDraw.Draw(sheets[stage]).text((400 * i + 8, 220 * heading + 3), f'{heading} {mode}', fill='white')
                sheets[stage].paste(images[mode].resize((400, 200), Image.Resampling.BOX), (400 * i, 220 * heading + 20))
    for stage, sheet in sheets.items():
        sheet.save(args.output / f'survey-{stage}.jpg', quality=92)
    for mode, run in runs.items():
        summary['gpu'][mode] = {}
        for sample in run['samples']:
            if not sample['file'].startswith('stage-'):
                continue
            times = sample['times']
            if not sample['timer'] or len(times) <= 20:
                raise SystemExit('Insufficient GPU timing')
            summary['gpu'][mode][sample['stage']] = dict(frames=len(times),
                quantilesMs=np.percentile(times, [10, 50, 90]).tolist(),
                calls=sample['metrics'].get('drawCalls'), triangles=sample['metrics'].get('triangles'))
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    (args.output / 'runs.json').write_text(json.dumps(runs, indent=2) + '\n')
    print(json.dumps(dict(duration=summary['durationSeconds'], gpu=summary['gpu']), indent=2))


if __name__ == '__main__':
    main()
