"""Compare product/before/repeat captures from sun-shadow or sun-transition diagnostics.

python3 scripts/summarize_sun_product.py <report.json> <output>
The evening's candidate is `before` (the sun always at 16+24) against v13-sky Cycles; the
night's (SUN_SHADOW_LIGHTING=night) is `lite` (the moon at the evening's 4+6) against web-night.
The table keeps the key `before` for either candidate, and `candidate` names it. Images remain local; summary and input hashes are tracked.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

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
    if report['errors'] or any(report['stats'][k] for k in ['unexpected', 'skipped', 'flaky']):
        raise SystemExit('Incomplete run')
    groups = {}
    for result in results(report['suites']):
        if result['status'] != 'passed':
            raise SystemExit('Failed capture')
        for attachment in result.get('attachments', []):
            if attachment['name'] not in ['sun-shadow', 'sun-transition']:
                continue
            run = json.loads(base64.b64decode(attachment['body']))
            mode = run['mode'].replace('original', 'product')
            if mode == 'lite':
                mode = 'before'
                run['candidate'] = 'lite'
            group = groups.setdefault((run.get('lighting', 'evening'), run['quality']), {})
            if mode in group:
                raise SystemExit('Duplicate condition')
            group[mode] = run
    if not groups:
        raise SystemExit('No captures')
    args.output.mkdir(parents=True, exist_ok=True)
    summary = dict(durationSeconds=report['stats']['duration'] / 1000, qualities={})
    if len({lighting for lighting, _ in groups}) != 1:
        raise SystemExit('Mixed lighting')
    for (lighting, quality), runs in groups.items():
        if set(runs) != {'product', 'before', 'product-repeat'}:
            raise SystemExit('Missing mode')
        baseline = runs['product']
        names = [s['file'] for s in baseline['samples']]
        if not names or len(names) != len(set(names)):
            raise SystemExit('Empty or duplicate captures')
        for run in runs.values():
            if [s['file'] for s in run['samples']] != names:
                raise SystemExit('Mismatched captures')
            if run['errors'] or any(run.get(k) != baseline.get(k) for k in ['hashes', 'browser', 'viewport', 'quality', 'lighting']):
                raise SystemExit('Mismatched inputs or browser errors')
            for a, b in zip(baseline['samples'], run['samples']):
                if 'sun' in a and (a['sun'] != b['sun'] or a['now'] != b['now']):
                    raise SystemExit('Mismatched transition state')
        summary['lighting'] = lighting
        group = summary['qualities'][quality] = dict(
            candidate=runs['before'].get('candidate', 'before'),
            conditions={k: baseline[k] for k in ['hashes', 'browser', 'viewport', 'quality']},
            views={}, temporal={}, referenceHashes={})
        sheets = {}
        prior = {}
        for sample in baseline['samples']:
            name = sample['file']
            images = {mode: Image.open(Path(run['dir']) / name).convert('RGB') for mode, run in runs.items()}
            values = {mode: lab(img) for mode, img in images.items()}
            row = group['views'][name] = dict(change=stats(values['before'], values['product']),
                captureNoise=stats(values['product'], values['product-repeat']))
            if 'sun' in sample:
                row['sun'] = sample['sun']
                row['lite'] = max(sample['sun']) < 0.1
            if '-move-' in name or 'direction' in sample:
                key = sample['stage'] + '-' + sample.get('direction', 'move')
                error = values['product'] - values['before']
                noise = values['product-repeat'] - values['product']
                if key in prior:
                    old_error, old_noise = prior[key]
                    group['temporal'][name] = dict(change=stats(error, old_error), noise=stats(noise, old_noise))
                prior[key] = (error, noise)
            if name.startswith('cycles-'):
                render = name.removeprefix('cycles-')
                refpath = (Path('blender/renders/web-night') / render if lighting == 'night' else
                           Path('blender/renders/v13-sky') / ('06.png' if render == '01.png' else 'bh-' + render))
                group['referenceHashes'][str(refpath)] = hashlib.sha256(refpath.read_bytes()).hexdigest()
                ref = load(refpath)
                row['cycles600x400'] = {mode: stats(ref, load(Path(runs[mode]['dir']) / name))
                                        for mode in ['before', 'product']}
            if name.startswith(('stage-', 'cycles-')) or ('sun' in sample and sample['direction'] == 'evening' and sample['step'] in [56, 57, 58]):
                sheet = Image.new('RGB', (1800, 425), '#222222')
                for i, mode in enumerate(['before', 'product', 'product-repeat']):
                    label = group['candidate'] if mode == 'before' else mode
                    ImageDraw.Draw(sheet).text((600*i+8, 5), f'{quality} {label} {name}', fill='white')
                    sheet.paste(images[mode].resize((600, 400), Image.Resampling.BOX), (600*i, 25))
                sheet.save(args.output / f'{quality}-{name[:-4]}.jpg', quality=93)
            if name == 'totonou-survey-5-0.png':
                crop = Image.new('RGB', (1800, 505), '#222222')
                for i, mode in enumerate(['before', 'product', 'product-repeat']):
                    ImageDraw.Draw(crop).text((600*i+8, 5), group['candidate'] if mode == 'before' else mode, fill='white')
                    crop.paste(images[mode].crop((640, 320, 940, 560)).resize((600, 480)), (600*i, 25))
                crop.save(args.output / f'{quality}-wall-crop.jpg', quality=95)
            if '-survey-' in name and name.endswith('-0.png'):
                stage, rest = name.split('-survey-')
                heading = int(rest.split('-')[0])
                sheet = sheets.setdefault(stage, Image.new('RGB', (1200, 8*220), '#222222'))
                for i, mode in enumerate(['before', 'product', 'product-repeat']):
                    label = group['candidate'] if mode == 'before' else mode
                    ImageDraw.Draw(sheet).text((400*i+8, 220*heading+3), f'{heading} {label}', fill='white')
                    sheet.paste(images[mode].resize((400, 200), Image.Resampling.BOX), (400*i, 220*heading+20))
        for stage, sheet in sheets.items():
            sheet.save(args.output / f'{quality}-survey-{stage}.jpg', quality=93)
        group['maxima'] = {kind: {metric: max(row[kind][metric] for row in group['views'].values())
                                  for metric in ['mean', 'over2Percent', 'overHalfPercent', 'maximum']}
                            for kind in ['change', 'captureNoise']}
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    (args.output / 'runs.json').write_text(json.dumps({q: runs for (_, q), runs in groups.items()}, indent=2) + '\n')
    print(json.dumps({q: s['maxima'] for q, s in summary['qualities'].items()}, indent=2))


if __name__ == '__main__':
    main()
