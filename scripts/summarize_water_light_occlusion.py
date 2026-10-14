"""Compare two repeated PNG stage captures per build, and the existing Cycles water reference.

Arguments: before-report before-repeat-report after-report after-repeat-report
  --captures <four preserved capture directories> --out <directory>
Reports must contain successful stage-compare attachments, with identical browser/settings.
The first pair of reports may predate browser metadata; supply --baseline-browser only when
its version is independently known from the same build's repeated capture.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from summarize_water_bump import lab


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def report(path):
    text = Path(path).read_text()
    data = json.loads(text[text.index('{\n  "config"'):])
    assert data['stats']['expected'] == 1 and not any(data['stats'][k] for k in ('unexpected', 'skipped', 'flaky'))
    found = []

    def visit(node):
        if isinstance(node, dict):
            for a in node.get('attachments', []):
                if a['name'] == 'stage-compare':
                    found.append(json.loads(base64.b64decode(a['body'])))
            for value in node.values():
                visit(value)
        elif isinstance(node, list):
            for value in node:
                visit(value)
    visit(data['suites'])
    assert len(found) == 1
    return data['stats'], found[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reports', nargs=4, type=Path)
    parser.add_argument('--captures', nargs=4, type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--baseline-browser')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    reports = [report(p) for p in args.reports]
    metadata = [r[1] for r in reports]
    browser = metadata[1]['browser']
    assert all(m.get('browser', args.baseline_browser) == browser for m in metadata)
    keys = [(s['lighting'], s['heading'], s['pitch']) for s in metadata[0]['samples']]
    assert len(keys) == 12 and len(set(keys)) == 12
    for m in metadata:
        assert m['quality'] == 'standard' and m['cut'] is None and m['bodyCandidate'] is None
        assert [(s['lighting'], s['heading'], s['pitch']) for s in m['samples']] == keys
        assert all(s['metrics']['quality'] == 'standard' and float(s['metrics']['pixelRatio']) == 1 for s in m['samples'])
    summary = {'browser': browser, 'quality': 'standard', 'dpr': 1,
               'reports': [{'sha256': sha(p), 'stats': r[0]} for p, r in zip(args.reports, reports)],
               'views': {}, 'limitations': 'Static PNGs, fixed views; Cycles reference predates garden/weather changes. No perceptual flicker or device performance claim.'}
    rows = []
    for i, key in enumerate(keys):
        name = '-'.join(map(str, key))
        paths = [next(root.rglob(m['samples'][i]['file'])) for root, m in zip(args.captures, metadata)]
        reference = Path('blender/renders/stage-water') / f'{name}.png'
        images = [np.asarray(Image.open(p).convert('RGB')) for p in paths + [reference]]
        assert all(im.shape == (800, 1280, 3) for im in images)
        labs = [lab(im) for im in images]
        mask = np.linalg.norm(labs[0] - labs[2], axis=-1) > 2
        errors = [np.linalg.norm(labs[j] - labs[4], axis=-1) for j in (0, 2)]
        summary['views'][name] = {
            'sha256': [sha(p) for p in paths + [reference]],
            'changedPixelsDE76Above2': int(mask.sum()),
            'changedMeanDE76ToCycles': [float(e[mask].mean()) if mask.any() else None for e in errors],
            'wholeMeanDE76ToCycles': [float(e.mean()) for e in errors],
            'repeatMeanDE76': [float(np.linalg.norm(labs[j] - labs[j+1], axis=-1).mean()) for j in (0, 2)],
            'repeatChangedPixels': [int(np.any(images[j] != images[j+1], axis=-1).sum()) for j in (0, 2)],
        }
        if key[0] in ('evening', 'night') and key[1] in (1, 2):
            crop = (680, 0, 940, 180) if key[1] == 1 else (120, 520, 420, 720)
            row = Image.new('RGB', (900, 224))
            draw = ImageDraw.Draw(row)
            for col, (j, label) in enumerate([(0, 'Before'), (2, 'After'), (4, 'Cycles reference')]):
                row.paste(Image.fromarray(images[j]).crop(crop), (col*300, 24))
                draw.text((col*300+3, 4), f'{name}: {label}', fill='white')
            rows.append(row)
    sheet = Image.new('RGB', (900, 224*len(rows)))
    for i, row in enumerate(rows):
        sheet.paste(row, (0, 224*i))
    sheet.save(args.out / 'comparison.png')
    summary['scriptSha256'] = sha(__file__)
    (args.out / 'comparison.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: v['changedMeanDE76ToCycles'] for k, v in summary['views'].items()}, indent=2))


if __name__ == '__main__':
    main()
