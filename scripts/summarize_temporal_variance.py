"""Validate and summarise same-build SHIMMER_ABBA=1 captures (camera=review required).

python3 scripts/summarize_temporal_variance.py report.json captures-root out
PNG artifacts stay local; JSON records hashes, replay differences and bounded diagnostics.
"""
import argparse
import hashlib
import json
import statistics
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_frame_cost import srgb_lab
from summarize_resolution_shimmer import samples

RUNS = ('before1', 'after1', 'after2', 'before2')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def summarize_cost(report, report_path, out):
    import base64
    stats = report['stats']
    if stats['expected'] != 5 or any(stats[k] for k in ('unexpected', 'skipped', 'flaky')) or report['errors']:
        raise ValueError('Require warmup plus four successful cost tests')
    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                for result in test['results']:
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == 'temporal-cost':
                            yield json.loads(base64.b64decode(attachment['body']))
        for child in suite.get('suites', []):
            yield from walk(child)
    bodies = [b for suite in report['suites'] for b in walk(suite)]
    if [b['run'] for b in bodies] != ['warmup', *RUNS]:
        raise ValueError('Missing or unordered cost captures')
    ref = bodies[0]
    for body in bodies:
        if body['errors'] or any(body[k] != ref[k] for k in ('browser', 'repeat', 'dpr', 'size', 'sourceHash')):
            raise ValueError('Inconsistent cost inputs')
        if bool(body['controls']) != body['run'].startswith('before') or len(body['samples']) != 6:
            raise ValueError('Invalid control or sample count')
        if any(s['temporalDraws'] <= 2 * s['frames'] or s['metrics']['temporal'] != 'on'
               for s in body['samples']):
            raise ValueError('Temporal pass was not active during measurement')
    comparisons = []
    by_run = {b['run']: b for b in bodies}
    for before, after in (('before1','after1'), ('before2','after2')):
        for a, b in zip(by_run[before]['samples'], by_run[after]['samples'], strict=True):
            if (a['stage'],a['lighting']) != (b['stage'],b['lighting']):
                raise ValueError('Different views')
            comparisons.append(dict(stage=a['stage'], lighting=a['lighting'], pair=[before,after],
                beforeMs=a['intervalMeanMs'], afterMs=b['intervalMeanMs'],
                ratio=b['intervalMeanMs']/a['intervalMeanMs']))
    out.mkdir(parents=True, exist_ok=True)
    result = dict(note='Issued rendering callback intervals divided by three, not GPU time or device FPS.',
                  reportSHA256=digest(report_path), captures=bodies, comparisons=comparisons)
    (out/'cost.json').write_text(json.dumps(result, indent=2)+'\n')
    print('cost ratios', min(r['ratio'] for r in comparisons), max(r['ratio'] for r in comparisons))


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument('report')
    parser.add_argument('captures')
    parser.add_argument('out')
    parser.add_argument('--cost', action='store_true', help='summarise cost captures; use - for captures')
    args = parser.parse_args()
    report_path = Path(args.report)
    report = json.loads(report_path.read_text())
    if args.cost:
        summarize_cost(report, report_path, Path(args.out))
        return
    stats = report['stats']
    if stats['expected'] != 4 or any(stats[key] for key in ('unexpected', 'flaky', 'skipped')) or report['errors']:
        raise ValueError('Require four successful ABBA tests, no errors/skips/retries')
    bodies = {run: samples(report_path, run) for run in RUNS}
    reference = bodies['before1']
    if ('&camera=review' not in reference['query'] or not reference['fixedResolution']
            or not reference.get('controlledFrames')):
        raise ValueError('Require controlled frames, fixed resolution and review camera')
    for run, body in bodies.items():
        for key in ('browser', 'query', 'sourceHash', 'quality', 'headingSteps', 'fixedResolution',
                    'yawPerStep', 'framesPerStep', 'controlledFrames', 'samples'):
            if body[key] != reference[key]:
                raise ValueError(f'{run}: mismatched {key}')
        if body.get('control') != reference.get('control') or bool(body['controls']) != run.startswith('before'):
            raise ValueError(f'{run}: missing or unexpected shader substitution')
    groups = {}
    for sample in reference['samples']:
        key = (sample['stage'], sample['lighting'], sample['ratio'])
        groups.setdefault(key, []).append(sample)
    if len(groups) != 6:
        raise ValueError('Require three stages by day/evening at one fixed ratio')
    for sequence in groups.values():
        if [s['step'] for s in sequence] != list(range(13)):
            raise ValueError('Missing or duplicate motion samples')
        if any(b['frameCount'] - a['frameCount'] != reference['framesPerStep']
               for a, b in zip(sequence, sequence[1:])):
            raise ValueError('Different frame counts between captures')
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    folders, measured, hashes = {}, {}, {}
    for run, body in bodies.items():
        matches = [p for p in Path(args.captures).iterdir() if p.is_dir() and p.name.endswith('-' + run)]
        if len(matches) != 1:
            raise ValueError(f'{run}: ambiguous capture folder')
        folders[run] = matches[0]
        hashes[run] = {s['file']: digest(matches[0] / s['file']) for s in body['samples']}
    # Independent captures; two workers bound the large floating-point image buffers.
    def measure_run(run):
        subprocess.run([sys.executable, str(Path(__file__).with_name('summarize_resolution_shimmer.py')),
                        str(report_path), str(folders[run]), str(out / run), '--run', run], check=True,
                       stdout=subprocess.DEVNULL)
    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(measure_run, RUNS))
    for run in RUNS:
        measured[run] = json.loads((out / run / 'shimmer.json').read_text())['sequences']
    comparisons, replay = [], []
    replay_residual_ratios = []
    for a,b in (('before1','before2'), ('after1','after2')):
        for old,new in zip(measured[a], measured[b], strict=True):
            replay_residual_ratios.append(dict(stage=old['stage'], lighting=old['lighting'], pair=[a,b],
                relative={key:new[key]/old[key] for key in ('pixel','tile','tileP99')}))
    for a, b in (('before1', 'after1'), ('before2', 'after2')):
        for old, new in zip(measured[a], measured[b], strict=True):
            identity = {key: old[key] for key in ('stage', 'lighting', 'ratio')}
            comparisons.append(dict(identity, pair=[a, b],
                relative={key: new[key] / old[key] for key in ('pixel', 'tile', 'tileP99')}))
    # Static first frames must stay equal; compare all frames of same-variant replays separately.
    static = []
    gradients = []
    for sample in reference['samples']:
        filename = sample['file']
        images = {run: np.asarray(Image.open(folder / filename).convert('RGB'), dtype=float)
                  for run, folder in folders.items()}
        if sample['step'] == 0:
            static.append(dict(file=filename, maxRGB=max(float(np.abs(images[a] - images[b]).max())
                               for a, b in (('before1', 'after1'), ('before2', 'after2')))))
        if sample['step'] == 12:
            g = {}
            for run, image in images.items():
                light = srgb_lab(image)[..., 0]
                g[run] = float((np.abs(np.diff(light, axis=0)).mean() + np.abs(np.diff(light, axis=1)).mean()) / 2)
            gradients.append(dict(file=filename, relative=[g['after1']/g['before1'], g['after2']/g['before2']]))
        for a, b in (('before1', 'before2'), ('after1', 'after2')):
            difference = np.abs(images[a] - images[b])
            replay.append(dict(file=filename, pair=[a,b], maxRGB=float(difference.max()),
                               meanRGB=float(difference.mean()), changedPixels=int(np.any(difference > 0, axis=2).sum())))
    summary = dict(note='Controlled rotation-compensated L* residual, not perceptual flicker or FPS. '
                        'Gradient includes removal of aliasing and is not a pure blur metric.',
                   reportSHA256=digest(report_path), inputs={key:reference[key] for key in
                   ('browser','query','quality','sourceHash','headingSteps','yawPerStep','framesPerStep', 'controlledFrames')},
                   comparisons=comparisons, replayResidualRatios=replay_residual_ratios,
                   static=static, gradients=gradients, replay=replay, pngSHA256=hashes,
                   residualRatios={key:dict(min=min(row['relative'][key] for row in comparisons),
                       median=statistics.median(row['relative'][key] for row in comparisons),
                       max=max(row['relative'][key] for row in comparisons)) for key in ('pixel','tile','tileP99')})
    (out / 'comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary['residualRatios'], indent=2))
    print('static maxRGB', max(row['maxRGB'] for row in static))
    print('replay maxRGB', max(row['maxRGB'] for row in replay))
    print('gradient ratios', min(min(row['relative']) for row in gradients), max(max(row['relative']) for row in gradients))


if __name__ == '__main__':
    main()
