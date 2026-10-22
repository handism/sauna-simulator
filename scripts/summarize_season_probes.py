"""Summarizes the ABBA stills of e2e/season-probes.visual.ts (seasonal outdoor probe rebake).

Run: python3 scripts/summarize_season_probes.py <gains1.json> <baked1.json> <baked2.json> <gains2.json>
     <captures-root> <out-dir>
<captures-root> holds gains1/ baked1/ baked2/ gains2/ copies of each run's PNGs (test-results is
cleared on the next run). Writes values.json: per view the re-capture difference of each mode and
the change from the calibrated gains to the rebaked grids (share of pixels over 3 levels, mean
CIELAB ΔE76, mean luminance ratio), plus a local compare.png of the most changed views (left gains,
right baked). Needs NumPy and Pillow.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_look_fixes import compare, lab

RUNS = ('gains1', 'baked1', 'baked2', 'gains2')


def report(path, run):
    data = json.loads(Path(path).read_text())
    stats = data['stats']
    if stats['unexpected'] or stats['flaky'] or stats['skipped'] or stats['expected'] != 1:
        raise SystemExit(f'{path}: not one passed test')
    result = data['suites'][0]['specs'][0]['tests'][0]['results'][0]
    body = next(a for a in result['attachments'] if a['name'] == 'season-probes')
    attached = json.loads(base64.b64decode(body['body']) if 'body' in body else Path(body['path']).read_text())
    if attached['run'] != run or attached['errors']:
        raise SystemExit(f'{path}: run {attached["run"]} or errors {attached["errors"]}')
    baked = run.startswith('baked')
    for c in attached['captures']:
        season = c['file'].split('-')[1]
        if (c['metrics'].get('seasonProbes') == season) != baked:
            raise SystemExit(f'{path}: {c["file"]} season probes {c["metrics"].get("seasonProbes")}')
    return attached


def main():
    *reports, root, out = sys.argv[1:]
    attached = [report(path, run) for path, run in zip(reports, RUNS)]
    files = [c['file'] for c in attached[0]['captures']]
    if any([c['file'] for c in a['captures']] != files for a in attached):
        raise SystemExit('the runs captured different views')
    if len({a['browser'] for a in attached}) != 1:
        raise SystemExit('the runs used different browsers')
    images = {run: {f: np.asarray(Image.open(Path(root) / run / f).convert('RGB')) for f in files} for run in RUNS}
    views = {}
    for f in files:
        ga, ba = lab(images['gains1'][f])[..., 0].mean(), lab(images['baked1'][f])[..., 0].mean()
        views[f] = dict(
            repeat_gains=compare(images['gains1'][f], images['gains2'][f]),
            repeat_baked=compare(images['baked1'][f], images['baked2'][f]),
            change=compare(images['gains1'][f], images['baked1'][f]),
            change_repeat=compare(images['gains2'][f], images['baked2'][f]),
            lightness=dict(gains=round(float(ga), 3), baked=round(float(ba), 3)),
        )
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    hashes = {run: {f: hashlib.sha256((Path(root) / run / f).read_bytes()).hexdigest() for f in files} for run in RUNS}
    (out / 'values.json').write_text(json.dumps(dict(
        browser=attached[0]['browser'], seasons=attached[0]['seasons'], requested=attached[1]['requested'],
        views=views, png_sha256=hashes), indent=2) + '\n')
    ranked = sorted(files, key=lambda f: -views[f]['change']['delta_e'])[:8]
    w, h = Image.open(Path(root) / 'gains1' / files[0]).size
    sheet = Image.new('RGB', (w, h * len(ranked) // 2))
    for i, f in enumerate(ranked):
        pair = Image.new('RGB', (w * 2, h))
        pair.paste(Image.fromarray(images['gains1'][f]), (0, 0))
        pair.paste(Image.fromarray(images['baked1'][f]), (w, 0))
        sheet.paste(pair.resize((w, h // 2)), (0, i * h // 2))
    sheet.save(out / 'compare.png')
    for f in files:
        v = views[f]
        print(f'{f:28} repeat {v["repeat_gains"]["over3"]:.4f}/{v["repeat_baked"]["over3"]:.4f}%  '
              f'change {v["change"]["over3"]:.3f}% ΔE {v["change"]["delta_e"]:.3f} '
              f'(again {v["change_repeat"]["delta_e"]:.3f})  L* {v["lightness"]["gains"]:.2f}→{v["lightness"]["baked"]:.2f}')


if __name__ == '__main__':
    main()
