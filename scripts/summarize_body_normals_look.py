"""Validate and compare four body-normal turn sequences (base1,candidate1,candidate2,base2).

python3 scripts/summarize_body_normals_look.py PREFIX CANDIDATE.json OUTPUT.json
Each PREFIX-RUN.json is a Playwright report; PREFIX-RUN contains its copied PNGs.
Motion is a controlled camera sweep with frozen waves, not real-time/FPS validation.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from summarize_frame_cost import attachments, srgb_lab


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('prefix')
    parser.add_argument('candidate')
    parser.add_argument('output')
    args = parser.parse_args()
    candidate = json.loads(Path(args.candidate).read_text())
    runs = ['base1', 'candidate1', 'candidate2', 'base2']
    metadata, images, digests = {}, {}, {}
    for run in runs:
        path = Path(f'{args.prefix}-{run}.json')
        raw = path.read_text()
        report = json.loads(raw[raw.index('{'):])
        assert not report['errors']
        assert report['stats']['expected'] == 2
        assert all(report['stats'][key] == 0 for key in ['unexpected', 'skipped', 'flaky'])
        items = attachments(path, 'body-normals-look')
        assert len(items) == 2
        metadata[run] = {item['view']: item for item in items}
        assert set(metadata[run]) == {'condensation', 'water'}
        images[run] = {p.name: p for p in Path(f'{args.prefix}-{run}').rglob('*.png')}
        assert len(images[run]) == 150
        digests[run] = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in images[run].items()}
        for view, item in metadata[run].items():
            assert not item['errors']
            assert item['hashes']['public/models/sauna.glb'] == candidate['inputSha256']
            model = item['bodyCandidate']
            if run.startswith('candidate'):
                assert model['sha256'] == candidate['outputSha256'] and model['requests'] == 1
            else:
                assert model is None
            assert len(item['samples']) == 75
            assert len({s['file'] for s in item['samples']}) == 75
            for lighting in ['day', 'evening', 'night']:
                frames = [s for s in item['samples'] if s['lighting'] == lighting]
                assert [s['step'] for s in frames] == list(range(25))
                assert [s['offset'] for s in frames] == list(range(13)) + list(range(11, -1, -1))
                assert all(b['count'] == a['count'] + 1 for a, b in zip(frames, frames[1:]))
            for s in item['samples']:
                assert s['file'] in images[run]
                assert s['metrics']['temporal'] == 'on'
                assert s['metrics']['quality'] == item['quality']
                assert float(s['metrics']['pixelRatio']) == item['dpr']
            first = metadata['base1'][view]
            for key in ['quality', 'dpr', 'browser', 'hashes', 'camera']:
                assert item[key] == first[key], (run, view, key)
            assert [(s['file'], s['step'], s['offset']) for s in item['samples']] == [(s['file'], s['step'], s['offset']) for s in first['samples']]
    assert metadata['base1']['water']['dpr'] == metadata['base1']['condensation']['dpr']
    outpath = Path(args.output)
    outpath.parent.mkdir(parents=True, exist_ok=True)
    output = {'candidate': candidate, 'captures': metadata, 'comparisons': {}, 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    cache = {}
    def load(run, name):
        image = Image.open(images[run][name]).convert('RGB')
        dpr = metadata[run]['water']['dpr']
        assert image.size == (int(1200 * dpr), int(800 * dpr))
        return np.asarray(image, dtype=np.float32)
    for label, a, b in [('firstPair', 'base1', 'candidate1'), ('secondPair', 'base2', 'candidate2'), ('baseReplay', 'base1', 'base2'), ('candidateReplay', 'candidate1', 'candidate2')]:
        result = {}
        for view in ['condensation', 'water']:
            for lighting in ['day', 'evening', 'night']:
                names = [f'{view}-{lighting}-{step:02}.png' for step in range(25)]
                signature = tuple((digests[a][name], digests[b][name]) for name in names)
                if signature in cache:
                    result[f'{view}-{lighting}'] = cache[signature]
                    continue
                identical = all(left == right for left, right in signature)
                records, previous, worst = [], None, None
                for step in range(25):
                    name = f'{view}-{lighting}-{step:02}.png'
                    if identical:
                        # Byte-identical PNGs imply pixel equality; do not repeat Lab conversion.
                        # Decode size is still checked by load() for every image below.
                        load(a, name)
                        load(b, name)
                        records.append({'step': step, 'meanDeltaE': 0.0, 'over2': 0.0, 'over5': 0.0, 'changedPixels': 0, 'errorChangeMeanL': None if step == 0 else 0.0, 'errorChangeOver2L': None if step == 0 else 0.0})
                        if worst is None:
                            worst = (0.0, name)
                        continue
                    left, right = load(a, name), load(b, name)
                    error = srgb_lab(right) - srgb_lab(left)
                    de = np.linalg.norm(error, axis=-1)
                    change = None if previous is None else np.abs(error[..., 0] - previous)
                    records.append({'step': step, 'meanDeltaE': float(de.mean()), 'over2': float((de > 2).mean()), 'over5': float((de > 5).mean()), 'changedPixels': int(np.any(left != right, axis=-1).sum()), 'errorChangeMeanL': None if change is None else float(change.mean()), 'errorChangeOver2L': None if change is None else float((change > 2).mean())})
                    previous = error[..., 0]
                    if worst is None or de.mean() > worst[0]:
                        worst = (float(de.mean()), name)
                result[f'{view}-{lighting}'] = {'frames': records, 'meanDeltaE': float(np.mean([r['meanDeltaE'] for r in records])), 'maxMeanDeltaE': max(r['meanDeltaE'] for r in records), 'maxOver2': max(r['over2'] for r in records), 'maxErrorChangeMeanL': max(r['errorChangeMeanL'] or 0 for r in records), 'worst': worst[1]}
                cache[signature] = result[f'{view}-{lighting}']
                if label == 'firstPair':
                    # Whole view plus same 256 px crop through five successive frames at the
                    # largest local error, for inspecting new bands/tears rather than just a mean.
                    left, right = load(a, worst[1]), load(b, worst[1])
                    de = np.linalg.norm(srgb_lab(right) - srgb_lab(left), axis=-1)
                    tile = 128
                    scores = [(float(de[y:y+tile, x:x+tile].mean()), x, y) for y in range(0, de.shape[0]-tile, tile) for x in range(0, de.shape[1]-tile, tile)]
                    _, x, y = max(scores)
                    x, y = min(x, de.shape[1]-256), min(y, de.shape[0]-256)
                    sheet = Image.new('RGB', (1280, 800), '#202020')
                    draw = ImageDraw.Draw(sheet)
                    for col, run in enumerate([a, b]):
                        shot = Image.open(images[run][worst[1]]).convert('RGB')
                        shot.thumbnail((600, 400))
                        sheet.paste(shot, (col*640, 25))
                        draw.text((col*640+5, 5), f'{run} {worst[1]}', fill='white')
                    peak = int(worst[1][-6:-4])
                    for col, step in enumerate(range(max(0, min(20, peak-2)), max(0, min(20, peak-2))+5)):
                        name = f'{view}-{lighting}-{step:02}.png'
                        for row, run in enumerate([a, b]):
                            crop = Image.open(images[run][name]).crop((x,y,x+256,y+256)).resize((192,192))
                            sheet.paste(crop, (col*256, 400+row*200))
                        draw.text((col*256+195,405), str(step), fill='white')
                    sheet.save(outpath.with_name(f'{outpath.stem}-{view}-{lighting}.jpg'))
        output['comparisons'][label] = result
    # Ensure the camera sequence actually changes pixels; a frozen renderer is invalid evidence.
    for run in runs:
        for view in ['condensation', 'water']:
            for lighting in ['day', 'evening', 'night']:
                a = load(run, f'{view}-{lighting}-00.png')
                b = load(run, f'{view}-{lighting}-12.png')
                assert np.any(a != b, axis=-1).mean() > .05, 'Camera did not move'
    outpath.write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({label: {k: {m:v[m] for m in ['meanDeltaE', 'maxOver2', 'maxErrorChangeMeanL']} for k,v in values.items()} for label,values in output['comparisons'].items()}, indent=2))


if __name__ == '__main__':
    main()
