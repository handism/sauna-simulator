"""Validate lossless mirror-step ABBA captures; report changes without perceptual/performance approval."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
from PIL import Image, ImageDraw
from summarize_sun_shadow import results


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--browser', choices=['chromium', 'webkit'], required=True)
    args = parser.parse_args()
    report = json.loads(args.report.read_text())
    if report['errors'] or report['stats']['expected'] != 8 or any(
        report['stats'][key] for key in ['unexpected', 'skipped', 'flaky']
    ):
        raise ValueError('Incomplete or failed run')
    runs = []
    for result in results(report['suites']):
        attachments = [a for a in result['attachments'] if a['name'] == 'mirror-steps']
        if result['status'] != 'passed' or result.get('retry', 0) or len(attachments) != 1:
            raise ValueError('Failed/retried or missing attachment')
        run = json.loads(base64.b64decode(attachments[0]['body']))
        if run['browserName'] != args.browser or run['errors'] or len(run['patches']) != 1:
            raise ValueError('Unexpected browser/error/patch count')
        for path, digest in run['hashes'].items():
            if sha(path) != digest:
                raise ValueError(f'Input drift: {path}')
        samples = run['samples']
        if [s['frame'] for s in samples] != list(range(61)):
            raise ValueError('Incomplete or reordered frames')
        for s in samples:
            if any(s['data'].get(k) != v for k, v in [
                ('stage', 'water'), ('quality', 'high'), ('warmup', 'split'),
                ('garden', 'ready'), ('warmupUndrawn', '0'), ('gardenWarmupUndrawn', '0'),
                ('temporal', 'on'), ('pixelRatio', '1'),
            ]):
                raise ValueError('Capture state mismatch')
            if sha(Path(run['dir']) / s['file']) != s['sha256']:
                raise ValueError('PNG hash mismatch')
        if not np.allclose(np.diff([s['now'] for s in samples]), 1000 / 60, atol=1e-6):
            raise ValueError('Unexpected synthetic frame interval')
        if not np.allclose(np.diff([s['wall'] for s in samples]), 1000 / 60, atol=0.001):
            raise ValueError('Unexpected synthetic clock interval')
        runs.append(run)
    expected = [(minute, i, mode) for minute in [12, 27]
                for i, mode in enumerate(['product', 'continuous', 'continuous', 'product'])]
    if [(r['minute'], r['order'], r['mode']) for r in runs] != expected:
        raise ValueError('Expected complete ABBA order')
    for run in runs:
        for key in ['hashes', 'browser', 'viewport']:
            if run[key] != runs[0][key]:
                raise ValueError(f'Mismatched {key}')
    args.output.mkdir(parents=True, exist_ok=True)
    summary = {'reportSha256': sha(args.report), 'scriptSha256': sha(__file__),
               'browser': args.browser, 'browserVersion': runs[0]['browser'],
               'durationSeconds': report['stats']['duration'] / 1000,
               'hashes': runs[0]['hashes'],
               'limits': 'Controlled one-second midpoint sequences, static water only. '
                         'PNG captures freeze rAF; waves/TAA remain active per synthetic frame. '
                         'Between-load wave phase can differ; ABBA repeats measure that floor. '
                         'Continuous mirror variant is diagnostic, not a shipped setting. '
                         'No real-time, full-view, performance or perceptual approval.',
               'runs': [], 'comparisons': []}
    sequences = {}
    for run in runs:
        label = f"{run['minute']}-{run['order']}-{run['mode']}"
        destination = args.output / label
        destination.mkdir(exist_ok=True)
        sequence = []
        for sample in run['samples']:
            source = Path(run['dir']) / sample['file']
            shutil.copyfile(source, destination / sample['file'])
            with Image.open(source) as image:
                if image.size != (1280, 800):
                    raise ValueError('Unexpected PNG dimensions')
                # Downsample only numeric diagnostics. Source PNGs stay untouched locally.
                sequence.append(np.array(image.convert('RGB').resize((320, 200)), np.float32))
        frames = np.stack(sequence)
        sequences[(run['minute'], run['order'])] = frames
        luma = frames @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        diffs = np.abs(np.diff(luma, axis=0))[:, 100:].mean(axis=(1, 2))
        keys = np.array([s['key'] for s in run['samples']])
        changes = np.diff(keys) != 0
        summary['runs'].append({'label': label, 'patch': run['patches'][0],
            'samples': run['samples'], 'mirrorKeyChanges': int(changes.sum()),
            'lowerHalfDiffs': [round(float(d), 5) for d in diffs],
            'lowerHalfDiffMax': float(diffs.max()),
            'keyChangeDiffMean': float(diffs[changes].mean()) if changes.any() else None,
            'heldKeyDiffMean': float(diffs[~changes].mean()) if (~changes).any() else None})
        peak = int(diffs.argmax()) + 1
        sheet = Image.new('RGB', (1920, 424))
        for column, frame in enumerate([peak - 1, peak, min(60, peak + 1)]):
            source = Path(run['dir']) / run['samples'][frame]['file']
            with Image.open(source) as image:
                sheet.paste(image.convert('RGB').resize((640, 400)), (column * 640, 24))
            ImageDraw.Draw(sheet).text((column * 640 + 8, 5), f'{label} frame {frame}', fill='white')
        sheet.save(args.output / f'{label}-peak.jpg', quality=94)
    for minute in [12, 27]:
        for a, b, label in [(0, 1, 'product-continuous'), (3, 2, 'product-continuous-repeat'),
                            (0, 3, 'product-repeat'), (1, 2, 'continuous-repeat')]:
            delta = np.abs(sequences[(minute, a)] - sequences[(minute, b)])
            summary['comparisons'].append({'minute': minute, 'comparison': label,
                'meanRGBDifference': float(delta.mean()), 'p99RGBDifference': float(np.percentile(delta, 99))})
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps([{k: v for k, v in r.items() if k not in ['samples', 'lowerHalfDiffs', 'patch']}
                      for r in summary['runs']], indent=2))


if __name__ == '__main__':
    main()
