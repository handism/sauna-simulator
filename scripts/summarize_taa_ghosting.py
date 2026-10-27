"""Summarise e2e/taa-ghosting.visual.ts: the afterimage of moving things behind the temporal pass.

python3 scripts/summarize_taa_ghosting.py report.json captures-root out [--move 2]
Per condition and frame, `still-off` (time held) and `off` (time running) mark the pixels that
the animation moves (|ΔL*| > --move); there each TAA variant's |L* − off| is its lag behind the
true frame. Pixels the animation leaves alone give the same comparison for the static scene, where
the TAA differs from `off` by smoothing the shimmer, not by lag. The repeat run bounds the noise.
"""
import argparse
import base64
import hashlib
import json
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from summarize_frame_cost import srgb_lab  # noqa: E402


def attachments(report):
    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                for result in test['results']:
                    if result['status'] != 'passed':
                        print(f"skipping {spec['title']}: {result['status']}", file=sys.stderr)
                        continue
                    for attachment in result.get('attachments', []):
                        if attachment['name'] == 'taa-ghosting':
                            yield json.loads(base64.b64decode(attachment['body']))
        for child in suite.get('suites', []):
            yield from walk(child)
    return [b for suite in report['suites'] for b in walk(suite)]


def load(sample, variant, root):
    # Older captures recorded only the file name: find the test's folder by the variant's slug.
    if 'path' in sample:
        # Copied out of test-results/ (which each run clears), keeping the test's folder.
        recorded = Path(sample['path'])
        path = Path(root) / recorded.parent.name / recorded.name
    else:
        slug = 'pass-' + variant.replace('.', '-')
        [folder] = [d for d in Path(root).iterdir() if d.name.endswith(slug)]
        path = folder / sample['file']
    rgb = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    return srgb_lab(rgb)[..., 0], hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('report')
    parser.add_argument('captures')
    parser.add_argument('out')
    parser.add_argument('--move', type=float, default=2.0)
    args = parser.parse_args()
    text = Path(args.report).read_text()
    report = json.loads(text[text.index('{'):])
    bodies = {b['variant']['name']: b for b in attachments(report)}
    if 'off' not in bodies or 'still-off' not in bodies:
        raise ValueError('Missing reference runs')
    names = [n for n in bodies if n not in ('off', 'still-off')]
    ref = bodies['off']
    for body in bodies.values():
        if body['browser'] != ref['browser'] or body['sourceHash'] != ref['sourceHash']:
            raise ValueError('Inconsistent inputs')
        if [s['file'] for s in body['samples']] != [s['file'] for s in ref['samples']]:
            raise ValueError('Different capture lists')
    for body in bodies.values():
        for sample in body['samples']:
            data = sample.get('data')
            if data is None:
                continue
            if any(v == 'NaN' for v in data.values()):
                raise ValueError(f"{body['variant']['name']} {sample['file']}: NaN scene state")
            if float(data['rain']) != (1.0 if sample['weather'] == 'rain' else 0.0):
                raise ValueError(f"{body['variant']['name']} {sample['file']}: rain {data['rain']} not settled")
    for name in names:
        if [s['now'] for s in bodies[name]['samples']] != [s['now'] for s in ref['samples']]:
            raise ValueError(f'{name}: clock differs from off')
    rows = []
    hashes = {}
    for index, sample in enumerate(ref['samples']):
        off, hashes[('off', sample['file'])] = load(sample, 'off', args.captures)
        still, _ = load(bodies['still-off']['samples'][index], 'still-off', args.captures)
        moving = np.abs(off - still) > args.move
        row = dict(file=sample['file'], stage=sample['stage'], weather=sample['weather'],
                   phase=sample['phase'], step=sample['step'], moving=float(moving.mean()))
        for name in names:
            image, hashes[(name, sample['file'])] = load(bodies[name]['samples'][index], name, args.captures)
            error = np.abs(image - off)
            row[name] = dict(
                moving=float(error[moving].mean()) if moving.any() else None,
                moving_p99=float(np.percentile(error[moving], 99)) if moving.any() else None,
                moving_over5=float((error[moving] > 5).mean()) if moving.any() else None,
                static=float(error[~moving].mean()),
            )
        rows.append(row)
    base = names[0]
    summary = {}
    for name in names[1:]:
        groups = {}
        for row in rows:
            if row[base]["moving"] is None or row["moving"] < 0.001 or row[base]["moving"] == 0:
                continue
            key = f"{row['stage']}-{row['weather']}-{row['phase']}"
            groups.setdefault(key, []).append(row)
        summary[name] = {
            key: dict(
                frames=len(group),
                moving_share=statistics.median(r['moving'] for r in group),
                **{f'{base}_moving': statistics.median(r[base]['moving'] for r in group),
                   f'{name}_moving': statistics.median(r[name]['moving'] for r in group),
                   'ratio_moving': statistics.median(r[name]['moving'] / r[base]['moving'] for r in group),
                   'ratio_moving_p99': statistics.median(
                       r[name]['moving_p99'] / max(r[base]['moving_p99'], 1e-6) for r in group),
                   'ratio_static': statistics.median(r[name]['static'] / r[base]['static'] for r in group)},
            )
            for key, group in sorted(groups.items())
        }
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'ghosting.json').write_text(json.dumps(dict(
        browser=ref['browser'], sourceHash=ref['sourceHash'], yawPerStep=ref['yawPerStep'],
        moveThreshold=args.move, baseline=base, variants=names, summary=summary, frames=rows,
        script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        images={f'{k[0]}/{k[1]}': v for k, v in sorted(hashes.items())},
    ), indent=1, ensure_ascii=False) + '\n')
    for name, groups in summary.items():
        print(f'{name} vs {base}')
        for key, g in groups.items():
            print(f"  {key:28} moving {g['moving_share']:.3f}  {base} {g[f'{base}_moving']:.2f}"
                  f"  {name} {g[f'{name}_moving']:.2f}  ratio {g['ratio_moving']:.3f}"
                  f"  p99 {g['ratio_moving_p99']:.3f}  static {g['ratio_static']:.3f}")


if __name__ == '__main__':
    main()
