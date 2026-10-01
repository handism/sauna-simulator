"""Summarise e2e/frame-cost.gpu.ts reports: GPU time of alternating before/after runs, the shading
ablations and the fragments shaded per pixel, and the pixel differences of captures.

python3 scripts/summarize_frame_cost.py --out docs/3d-qa/depth-prepass/cost.json \
    --runs standard before=<json>,<json>,... after=<json>,... \
    [--runs high before=... after=...] [--ablation <json>...] [--images <before dir> <after dir>] \
    [--image-runs before=<dir>,<dir> after=<dir>,<dir>] [--overdraw <before json> <after json>] \
    [--light-costs <json>...] [--image-delta <before dir> <after dir>]

Each report is Playwright's JSON reporter output (build logs before the first `{` are skipped).
--runs pairs the i-th `before` run with the i-th `after` run (run them alternately) and records,
per stage and lighting, the medians and the after/before ratios, and for reports that keep it the
mean interval between drawn frames divided by the repeat (FRAME_COST_REPEAT) with its ratios. On
ANGLE Metal the timer of a frame that misses the display interval reads about 1.8x that interval,
so the interval of repeated frames, not the timer, is the cost (e2e/gpu-timer.ts). --ablation keeps the medians of
every variant (product, trivial, discard) in the order run and the overdraw histograms. --images
compares every .jpg/.png under two capture folders (same relative paths) and records, per folder,
the largest channel difference and the share of pixels over 8 levels, whole and in the centre
(20% margins cut, where the DOM glow of the full surveys does not reach). --image-runs takes
repeated captures of each build and checks, per image, that every `after` capture is pixel-equal to
some `before` capture: two page loads may differ (e2e/CLAUDE.md), so one pair alone cannot tell a
change from that. --overdraw keeps the fragments shaded per pixel of a before and an after report.
--light-costs takes reports that ran `noshadow-*` variants between product runs: a variant's saving
is the mean of the product medians just before and after it in its report minus its own median,
and per view the savings of all reports are kept with their median (with the sum of the
single-light medians, to set against `noshadow-all`). Other variants (`rolled`) are kept the
same way. `warmup` runs are left out. --image-delta is for a change that alters images: per folder
the CIELAB ΔE76 (sRGB, D65) between same-named captures, its mean and the shares of pixels over 2
and 5, whole and in the centre, with the five images of the largest share over 5.
"""
import argparse
import base64
import json
import statistics
from pathlib import Path


def attachments(path, name):
    """The decoded JSON attachments called `name` of a Playwright JSON report."""
    raw = Path(path).read_text()
    report = json.loads(raw[raw.index('{'):])
    found = []

    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                for result in test['results']:
                    if result['status'] != 'passed':
                        raise SystemExit(f'{path}: {spec["title"]} {result["status"]}')
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == name:
                            found.append(json.loads(base64.b64decode(attachment['body'])))
        for child in suite.get('suites', []):
            walk(child)

    for suite in report['suites']:
        walk(suite)
    return found


def medians(path):
    """{(stage, lighting): median GPU ms} of a report's product frame-cost runs, and their metrics."""
    runs = [run for run in attachments(path, 'frame-cost') if run['variant'] == 'product']
    if len(runs) != 1:
        raise SystemExit(f'{path}: expected one product run, got {len(runs)}')
    return runs[0], {(r['stage'], r['lighting']): r for r in runs[0]['results']}


def compare_runs(label, before, after):
    if len(before) != len(after):
        raise SystemExit(f'{label}: {len(before)} before runs, {len(after)} after')
    loaded = {'before': [medians(p) for p in before], 'after': [medians(p) for p in after]}
    qualities = {run['quality'] for side in loaded.values() for run, _ in side}
    browsers = {run['browser'] for side in loaded.values() for run, _ in side}
    dprs = {run.get('dpr', 1) for side in loaded.values() for run, _ in side}
    repeats = {run.get('repeat', 1) for side in loaded.values() for run, _ in side}
    if len(qualities) != 1 or len(browsers) != 1 or len(dprs) != 1 or len(repeats) != 1:
        raise SystemExit(
            f'{label}: mixed qualities {qualities}, browsers {browsers}, DPRs {dprs} or repeats {repeats}')
    views = []
    for key in loaded['before'][0][1]:
        b = [results[key]['gpuMs']['median'] for _, results in loaded['before']]
        a = [results[key]['gpuMs']['median'] for _, results in loaded['after']]
        ratios = [y / x for x, y in zip(b, a)]
        metrics = {
            side: {k: loaded[side][0][1][key]['metrics'].get(k) for k in ('drawCalls', 'triangles', 'prepassMeshes', 'pixelRatio')}
            for side in loaded
        }
        view = {
            'stage': key[0], 'lighting': key[1],
            'beforeMs': b, 'afterMs': a,
            'ratios': [round(r, 3) for r in ratios],
            'medianRatio': round(statistics.median(ratios), 3),
            'metrics': metrics,
        }
        if all('intervalMs' in results[key] for side in loaded.values() for _, results in side):
            bi = [round(results[key]['intervalMs']['mean'], 2) for _, results in loaded['before']]
            ai = [round(results[key]['intervalMs']['mean'], 2) for _, results in loaded['after']]
            interval_ratios = [y / x for x, y in zip(bi, ai)]
            view.update({
                'beforeIntervalMs': bi, 'afterIntervalMs': ai,
                'intervalRatios': [round(r, 3) for r in interval_ratios],
                'medianIntervalRatio': round(statistics.median(interval_ratios), 3),
            })
        views.append(view)
    return {
        'quality': qualities.pop(), 'dpr': dprs.pop(), 'repeat': repeats.pop(), 'browser': browsers.pop(), 'runs': len(before), 'views': views,
    }


def ablation(paths):
    runs, overdraw = [], []
    for path in paths:
        for run in attachments(path, 'frame-cost'):
            runs.append({
                'variant': run['variant'], 'index': run['index'], 'quality': run['quality'],
                'medianMs': {f"{r['stage']}/{r['lighting']}": r['gpuMs']['median'] for r in run['results']},
            })
        for run in attachments(path, 'overdraw'):
            for r in run['results']:
                total = sum(r['histogram'])
                overdraw.append({
                    'stage': r['stage'], 'lighting': r['lighting'], 'quality': run['quality'],
                    'meanLayers': round(r['mean'], 3),
                    'atLeast3': round(sum(r['histogram'][3:]) / total, 4),
                    'atLeast5': round(sum(r['histogram'][5:]) / total, 4),
                    'histogram': r['histogram'],
                })
    return {'runs': runs, 'overdraw': overdraw}


def light_costs(paths):
    views = {}
    for path in paths:
        runs = [run for run in attachments(path, 'frame-cost') if run['variant'] != 'warmup']
        medians = [{(r['stage'], r['lighting']): r['gpuMs']['median'] for r in run['results']} for run in runs]
        products = [i for i, run in enumerate(runs) if run['variant'] == 'product']
        if not products or products[0] > min(i for i, run in enumerate(runs) if run['variant'] != 'product') \
                or products[-1] != len(runs) - 1:
            raise SystemExit(f'{path}: expected product runs around the variants')
        for i in products:
            for key, ms in medians[i].items():
                views.setdefault(key, {'productMs': [], 'savingMs': {}})['productMs'].append(ms)
        for i, run in enumerate(runs):
            if run['variant'] == 'product':
                continue
            before = max(j for j in products if j < i)
            after = min(j for j in products if j > i)
            for key, ms in medians[i].items():
                saving = round((medians[before][key] + medians[after][key]) / 2 - ms, 2)
                views[key]['savingMs'].setdefault(run['variant'], []).append(saving)
    out = []
    for (stage, lighting), view in views.items():
        medians = {variant: round(statistics.median(ms), 2) for variant, ms in view['savingMs'].items()}
        out.append({
            'stage': stage, 'lighting': lighting,
            'productMs': view['productMs'],
            'medianSavingMs': medians,
            'sumOfSingleLights': round(sum(ms for variant, ms in medians.items()
                                           if variant.startswith('noshadow-') and variant != 'noshadow-all'), 2),
            'savingMs': view['savingMs'],
        })
    return out


def image_differences(before_root, after_root):
    import numpy as np
    from PIL import Image

    before_root, after_root = Path(before_root), Path(after_root)
    folders = {}
    for before in sorted(p for p in before_root.rglob('*') if p.suffix in ('.jpg', '.png')):
        rel = before.relative_to(before_root)
        after = after_root / rel
        if not after.exists():
            raise SystemExit(f'missing {after}')
        a = np.asarray(Image.open(before).convert('RGB'), int)
        b = np.asarray(Image.open(after).convert('RGB'), int)
        d = np.abs(a - b).max(axis=2)
        h, w = d.shape
        m = int(min(h, w) * 0.2)
        entry = folders.setdefault(rel.parts[0], {'images': 0, 'maxDifference': 0, 'maxOver8': 0.0, 'maxCentreOver8': 0.0})
        entry['images'] += 1
        entry['maxDifference'] = max(entry['maxDifference'], int(d.max()))
        entry['maxOver8'] = max(entry['maxOver8'], round(float((d > 8).mean()), 5))
        entry['maxCentreOver8'] = max(entry['maxCentreOver8'], round(float((d[m:h - m, m:w - m] > 8).mean()), 5))
    return folders


def srgb_lab(rgb):
    import numpy as np

    a = rgb / 255.0
    linear = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    xyz = linear @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz /= np.array([0.9505, 1.0, 1.089])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def image_delta(before_root, after_root):
    import numpy as np
    from PIL import Image

    before_root, after_root = Path(before_root), Path(after_root)
    folders = {}
    for before in sorted(p for p in before_root.rglob('*') if p.suffix in ('.jpg', '.png')):
        rel = before.relative_to(before_root)
        after = after_root / rel
        if not after.exists():
            raise SystemExit(f'missing {after}')
        d = np.linalg.norm(srgb_lab(np.asarray(Image.open(before).convert('RGB'), float))
                           - srgb_lab(np.asarray(Image.open(after).convert('RGB'), float)), axis=-1)
        h, w = d.shape
        m = int(min(h, w) * 0.2)
        centre = d[m:h - m, m:w - m]
        entry = folders.setdefault(rel.parts[0], {'images': [], 'pixels': 0, 'sum': 0.0, 'over2': 0, 'over5': 0,
                                                  'centrePixels': 0, 'centreOver5': 0})
        entry['images'].append((str(rel.relative_to(rel.parts[0])), round(float((d > 5).mean()), 5),
                                round(float(d.mean()), 4)))
        entry['pixels'] += d.size
        entry['sum'] += float(d.sum())
        entry['over2'] += int((d > 2).sum())
        entry['over5'] += int((d > 5).sum())
        entry['centrePixels'] += centre.size
        entry['centreOver5'] += int((centre > 5).sum())
    result = {}
    for name, e in folders.items():
        worst = sorted(e['images'], key=lambda image: -image[1])[:5]
        result[name] = {
            'images': len(e['images']),
            'meanDeltaE': round(e['sum'] / e['pixels'], 4),
            'over2': round(e['over2'] / e['pixels'], 5),
            'over5': round(e['over5'] / e['pixels'], 5),
            'centreOver5': round(e['centreOver5'] / e['centrePixels'], 5),
            'maxImageMeanDeltaE': max(image[2] for image in e['images']),
            'worstOver5': [{'image': image, 'over5': over5, 'meanDeltaE': mean} for image, over5, mean in worst],
        }
    return result


def image_runs(before_roots, after_roots):
    import hashlib

    import numpy as np
    from PIL import Image

    roots = [Path(r) for r in before_roots + after_roots]
    labels = ['before'] * len(before_roots) + ['after'] * len(after_roots)
    folders = {}
    # A capture folder may hold only some of the suites: each image is judged on the runs that have it.
    images = sorted({p.relative_to(root) for root in roots for p in root.rglob('*') if p.suffix in ('.jpg', '.png')})
    for rel in images:
        runs = [(root, label) for root, label in zip(roots, labels) if (root / rel).exists()]
        digests = [hashlib.sha256(np.asarray(Image.open(root / rel).convert('RGB')).tobytes()).hexdigest()
                   for root, _ in runs]
        before = {d for d, (_, label) in zip(digests, runs) if label == 'before'}
        entry = folders.setdefault(rel.parts[0], {'images': 0, 'minRuns': {}, 'varyingBetweenLoads': 0,
                                                  'afterNotInBefore': []})
        entry['images'] += 1
        for side in ('before', 'after'):
            count = sum(label == side for _, label in runs)
            entry['minRuns'][side] = min(entry['minRuns'].get(side, count), count)
        entry['varyingBetweenLoads'] += len(set(digests)) > 1
        if not before or any(d not in before for d, (_, label) in zip(digests, runs) if label == 'after'):
            entry['afterNotInBefore'].append(str(rel.relative_to(rel.parts[0])))
    return {'before': before_roots, 'after': after_roots, 'folders': folders}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--runs', nargs=3, action='append', metavar=('LABEL', 'BEFORE', 'AFTER'), default=[])
    parser.add_argument('--ablation', nargs='*', default=[])
    parser.add_argument('--images', nargs=2)
    parser.add_argument('--image-runs', nargs=2, metavar=('BEFORE', 'AFTER'))
    parser.add_argument('--overdraw', nargs=2, metavar=('BEFORE', 'AFTER'))
    parser.add_argument('--light-costs', nargs='*', default=[])
    parser.add_argument('--image-delta', nargs=2, metavar=('BEFORE', 'AFTER'))
    args = parser.parse_args()
    out = {'comparisons': {}}
    for label, before, after in args.runs:
        b = before.removeprefix('before=').split(',')
        a = after.removeprefix('after=').split(',')
        out['comparisons'][label] = compare_runs(label, b, a)
    if args.ablation:
        out['ablation'] = ablation(args.ablation)
    if args.images:
        out['images'] = image_differences(*args.images)
    if args.image_runs:
        before, after = args.image_runs
        out['imageRuns'] = image_runs(before.removeprefix('before=').split(','),
                                      after.removeprefix('after=').split(','))
    if args.overdraw:
        out['overdraw'] = {side: ablation([path])['overdraw'] for side, path in zip(('before', 'after'), args.overdraw)}
    if args.light_costs:
        out['lightCosts'] = light_costs(args.light_costs)
    if args.image_delta:
        out['imageDelta'] = image_delta(*args.image_delta)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
    for label, comparison in out['comparisons'].items():
        for v in comparison['views']:
            print(label, v['stage'], v['lighting'], v['beforeMs'], v['afterMs'], v['medianRatio'])
    for v in out.get('lightCosts', []):
        print(v['stage'], v['lighting'], v['productMs'], v['medianSavingMs'], v['sumOfSingleLights'])


if __name__ == '__main__':
    main()
