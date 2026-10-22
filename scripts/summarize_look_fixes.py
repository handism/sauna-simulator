"""Summarizes the ABBA stills of e2e/look-fixes.visual.ts (the 2026-10-22 look fixes).

Run: python3 scripts/summarize_look_fixes.py <before1.json> <after1.json> <after2.json> <before2.json>
     <captures-root> <out-dir>
<captures-root> holds before1/ after1/ after2/ before2/ copies of each run's PNGs (test-results is
cleared on the next run). Writes values.json: per view the re-capture difference of each build and
the change between builds (share of pixels over 3 levels, mean CIELAB ΔE76), plus a local
compare.png of the most changed views (left before, right after). Needs NumPy and Pillow.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

RUNS = ('before1', 'after1', 'after2', 'before2')


def report(path, run):
    data = json.loads(Path(path).read_text())
    stats = data['stats']
    if stats['unexpected'] or stats['flaky'] or stats['skipped'] or stats['expected'] != 1:
        raise SystemExit(f'{path}: not one passed test')
    result = data['suites'][0]['specs'][0]['tests'][0]['results'][0]
    body = next(a for a in result['attachments'] if a['name'] == 'look-fixes')
    attached = json.loads(base64.b64decode(body['body']) if 'body' in body else Path(body['path']).read_text())
    if attached['run'] != run or attached['errors']:
        raise SystemExit(f'{path}: run {attached["run"]} or errors {attached["errors"]}')
    return attached


def lab(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    xyz = c @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def compare(a, b):
    over = (np.abs(a.astype(int) - b.astype(int)).max(-1) > 3).mean()
    return dict(over3=round(float(over) * 100, 4), delta_e=round(float(np.linalg.norm(lab(a) - lab(b), axis=-1).mean()), 4))


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
        views[f] = dict(
            repeat_before=compare(images['before1'][f], images['before2'][f]),
            repeat_after=compare(images['after1'][f], images['after2'][f]),
            change=compare(images['before1'][f], images['after1'][f]),
            change_repeat=compare(images['before2'][f], images['after2'][f]),
        )
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    hashes = {run: {f: hashlib.sha256((Path(root) / run / f).read_bytes()).hexdigest() for f in files} for run in RUNS}
    (out / 'values.json').write_text(json.dumps(dict(browser=attached[0]['browser'], views=views, png_sha256=hashes), indent=2) + '\n')
    ranked = sorted(files, key=lambda f: -views[f]['change']['delta_e'])[:8]
    w, h = Image.open(Path(root) / 'before1' / files[0]).size
    sheet = Image.new('RGB', (w, h * len(ranked) // 2))
    for i, f in enumerate(ranked):
        pair = Image.new('RGB', (w * 2, h))
        pair.paste(Image.fromarray(images['before1'][f]), (0, 0))
        pair.paste(Image.fromarray(images['after1'][f]), (w, 0))
        sheet.paste(pair.resize((w, h // 2)), (0, i * h // 2))
    sheet.save(out / 'compare.png')
    for f in files:
        v = views[f]
        print(f'{f:32} repeat {v["repeat_before"]["over3"]:.4f}/{v["repeat_after"]["over3"]:.4f}%  '
              f'change {v["change"]["over3"]:.3f}% ΔE {v["change"]["delta_e"]:.3f} (again {v["change_repeat"]["delta_e"]:.3f})')


if __name__ == '__main__':
    main()
