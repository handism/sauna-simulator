"""Validate ABBA garden-index reports and record images, allocated bytes and timer observations."""
import base64
import hashlib
import json
import sys
from pathlib import Path

from summarize_frame_cost import image_delta
import numpy as np
from PIL import Image

report_path, candidate_path, output = map(Path, sys.argv[1:])
raw = report_path.read_text()
report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
assert not report['errors']
assert report['stats']['expected'] == 4
assert all(report['stats'][key] == 0 for key in ['unexpected', 'skipped', 'flaky'])
candidate = json.loads(candidate_path.read_text())
runs = []
root = output.parent / 'captures'

def visit(suites):
    for suite in suites:
        visit(suite.get('suites', []))
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert test['status'] == 'expected'
                assert len(test['results']) == 1
                result = test['results'][0]
                assert result['status'] == 'passed'
                attachments = result['attachments']
                metas = [item for item in attachments if item['name'] == 'garden-indices']
                assert len(metas) == 1
                meta = json.loads(base64.b64decode(metas[0]['body']))
                assert meta['index'] == len(runs)
                assert meta['variant'] == ['original', 'candidate', 'candidate', 'original'][len(runs)]
                assert meta['originalSha256'] == candidate['inputSha256']
                assert meta['candidateSha256'] == candidate['outputSha256']
                expected_hash = candidate['outputSha256' if meta['variant'] == 'candidate' else 'inputSha256']
                assert meta['modelSha256'] == expected_hash and meta['requests'] == 1
                assert meta['quality'] == 'standard' and meta['dpr'] == 1 and not meta['errors']
                assert len(meta['rows']) == 9
                assert [(r['stage'], r['lighting']) for r in meta['rows']] == [(s, l) for s in ['sauna', 'water', 'totonou'] for l in ['day', 'evening', 'night']]
                directory = root / str(meta['index'])
                directory.mkdir(parents=True, exist_ok=True)
                images = [item for item in attachments if item['contentType'] == 'image/png']
                assert len(images) == 9
                for row in meta['rows']:
                    item, = [item for item in images if item['name'] == f"{row['stage']}-{row['lighting']}"]
                    image = Path(item['path']).read_bytes() if 'path' in item else base64.b64decode(item['body'])
                    assert hashlib.sha256(image).hexdigest() == row['imageSha256']
                    (directory / f"{item['name']}.png").write_bytes(image)
                    assert row['frames'] > 10 and not row['memory']['unknownFormats']
                    assert row['metrics']['quality'] == 'standard' and float(row['metrics']['pixelRatio']) == 1
                runs.append(meta)

visit(report['suites'])
assert len(runs) == 4 and len({r['browser'] for r in runs}) == 1
assert all(r['repeat'] == 4 for r in runs)
assert all(r['inputHashes'] == runs[0]['inputHashes'] for r in runs)
for path, digest in runs[0]['inputHashes'].items():
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, ('Changed input', path)
views = []
for i in range(9):
    rows = [run['rows'][i] for run in runs]
    assert len({r['metrics']['triangles'] for r in rows}) == 1
    assert rows[0]['memory']['bytes']['buffer'] == rows[3]['memory']['bytes']['buffer']
    assert rows[1]['memory']['bytes']['buffer'] == rows[2]['memory']['bytes']['buffer']
    for base, changed in [(rows[0], rows[1]), (rows[3], rows[2])]:
        assert base['memory']['bytes']['buffer'] - changed['memory']['bytes']['buffer'] == candidate['decodedBeforeBytes'] - candidate['decodedAfterBytes']
        assert int(changed['metrics']['drawCalls']) - int(base['metrics']['drawCalls']) == 4
        for kind in ['texture', 'renderbuffer']:
            assert base['memory']['bytes'][kind] == changed['memory']['bytes'][kind]
    views.append({
        'stage': rows[0]['stage'], 'lighting': rows[0]['lighting'],
        'bufferBytes': [r['memory']['bytes']['buffer'] for r in rows],
        'drawCalls': [r['metrics']['drawCalls'] for r in rows],
        'triangles': [r['metrics']['triangles'] for r in rows],
        'intervalMeanMs': [r['intervalMeanMs'] for r in rows],
        'gpuTimerMedianMs': [r['gpuMs']['median'] for r in rows],
    })
pixel_comparisons = {}
for name, a, b in [('firstPair', 0, 1), ('secondPair', 3, 2), ('originalReplay', 0, 3), ('candidateReplay', 1, 2)]:
    pixel_comparisons[name] = []
    for path in sorted((root / str(a)).glob('*.png')):
        first = np.asarray(Image.open(path).convert('RGB'), dtype=np.int16)
        second = np.asarray(Image.open(root / str(b) / path.name).convert('RGB'), dtype=np.int16)
        assert first.shape == second.shape == (800, 1200, 3)
        difference = np.abs(first - second)
        pixel_comparisons[name].append({'image': path.name, 'changedPixels': int(np.any(difference, axis=-1).sum()), 'maxChannelDifference': int(difference.max())})
summary = {'pixelComparisons': pixel_comparisons, 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'candidate': candidate, 'browser': runs[0]['browser'], 'stats': report['stats'], 'views': views,
           'images': {name: image_delta(str(root / str(a)), str(root / str(b))) for name, a, b in [('firstPair', 0, 1), ('secondPair', 3, 2), ('originalReplay', 0, 3), ('candidateReplay', 1, 2)]},
           'runs': runs, 'note': 'Four-repeat drawn-frame mean intervals divided by four estimate throughput under added GPU load. Query timers may include waiting/display intervals on ANGLE Metal. No driver allocation or full-surround/real-motion approval.'}
output.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({'browser': summary['browser'], 'views': views, 'images': summary['images']}, indent=2))
