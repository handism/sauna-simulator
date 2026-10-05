"""Validate ABBA garden-motion reports and record moving/still frame costs and garden load times."""
import base64
import hashlib
import json
import statistics
import sys
from pathlib import Path

report_path, candidate_path, output = map(Path, sys.argv[1:])
raw = report_path.read_text()
report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
assert not report['errors']
assert report['stats']['expected'] == 4
assert all(report['stats'][key] == 0 for key in ['unexpected', 'skipped', 'flaky'])
candidate = json.loads(candidate_path.read_text())
order = ['original', 'candidate', 'candidate', 'original']
views = [(s, l) for s in ['sauna', 'water', 'totonou'] for l in ['day', 'evening', 'night']]
runs = []


def visit(suites):
    for suite in suites:
        visit(suite.get('suites', []))
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                assert test['status'] == 'expected' and len(test['results']) == 1
                result = test['results'][0]
                assert result['status'] == 'passed'
                metas = [item for item in result['attachments'] if item['name'] == 'garden-motion']
                assert len(metas) == 1
                meta = json.loads(base64.b64decode(metas[0]['body']))
                assert meta['index'] == len(runs) and meta['variant'] == order[len(runs)]
                assert meta['originalSha256'] == candidate['inputSha256']
                assert meta['candidateSha256'] == candidate['outputSha256']
                expected = candidate['outputSha256' if meta['variant'] == 'candidate' else 'inputSha256']
                assert meta['modelSha256'] == expected and meta['requests'] == 1 and not meta['errors']
                assert meta['quality'] == 'standard' and meta['dpr'] == 1
                assert [(r['stage'], r['lighting']) for r in meta['rows']] == views
                for row in meta['rows']:
                    assert row['metrics']['quality'] == 'standard' and float(row['metrics']['pixelRatio']) == 1
                    assert row['still']['frames'] > 10 and row['moving']['frames'] > 10
                assert len(meta['loadRuns']) == meta['loads']
                for load in meta['loadRuns']:
                    assert (load['stage'], load['lighting'], load['quality']) == ('sauna', 'day', 'standard')
                runs.append(meta)


visit(report['suites'])
assert len(runs) == 4 and len({r['browser'] for r in runs}) == 1
assert len({(r['repeat'], r['loads']) for r in runs}) == 1
assert all(r['inputHashes'] == runs[0]['inputHashes'] for r in runs)
for path, digest in runs[0]['inputHashes'].items():
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest, ('Changed input', path)

pairs = [(0, 1), (3, 2)]  # (original, candidate) in time order around each switch
rows = []
for i, (stage, lighting) in enumerate(views):
    each = [run['rows'][i] for run in runs]
    for base, changed in pairs:
        assert int(each[changed]['metrics']['drawCalls']) - int(each[base]['metrics']['drawCalls']) == 4
    entry = {'stage': stage, 'lighting': lighting,
             'drawCalls': [r['metrics']['drawCalls'] for r in each],
             'mirrorCallsMoving': [r['moving']['mirror']['calls'] for r in each]}
    for mode in ['still', 'moving']:
        entry[mode + 'IntervalMeanMs'] = [r[mode]['intervalMeanMs'] for r in each]
        entry[mode + 'Ratio'] = [each[c][mode]['intervalMeanMs'] / each[b][mode]['intervalMeanMs'] for b, c in pairs]
    # The added cost of a moving view (mirror redrawn every frame) over the still one.
    entry['movingExtraMs'] = [r['moving']['intervalMeanMs'] - r['still']['intervalMeanMs'] for r in each]
    entry['movingExtraDifferenceMs'] = [entry['movingExtraMs'][c] - entry['movingExtraMs'][b] for b, c in pairs]
    rows.append(entry)

load_keys = ['loadMs', 'gardenPhaseMs', 'firstCallbackMs', 'firstIntervalMs']
loads = []
for run in runs:
    loads.append({'variant': run['variant'], **{key: {'median': statistics.median(l[key] for l in run['loadRuns']),
                                                     'values': [l[key] for l in run['loadRuns']]} for key in load_keys}})
load_by_variant = {variant: {key: statistics.median(l[key] for run in runs if run['variant'] == variant for l in run['loadRuns'])
                             for key in load_keys} for variant in ['original', 'candidate']}

summary = {
    'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'browser': runs[0]['browser'], 'stats': report['stats'], 'repeat': runs[0]['repeat'], 'loads': runs[0]['loads'],
    'candidate': {key: candidate[key] for key in ['inputSha256', 'outputSha256']},
    'views': rows,
    'ratioRange': {mode: [min(min(r[mode + 'Ratio']) for r in rows), max(max(r[mode + 'Ratio']) for r in rows)] for mode in ['still', 'moving']},
    'loadRuns': loads, 'loadMedians': load_by_variant,
    'runs': runs,
    'note': 'Drawn-frame mean intervals / repeat under added GPU load; moving = a 1 CSS px drag after every drawn frame, '
            'alternating, so the mirror is redrawn every frame. Static shadow maps are redrawn only by the garden\'s '
            'addition (firstCallbackMs: CPU time of the first callback drawing the garden, with its buffer uploads) '
            'and quality changes. Not GPU-only time, display FPS, a real device or driver allocation.',
}
output.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: summary[key] for key in ['browser', 'ratioRange', 'loadMedians']}, indent=2))
for r in rows:
    print(r['stage'], r['lighting'], 'still', [round(x, 4) for x in r['stillRatio']], 'moving', [round(x, 4) for x in r['movingRatio']],
          'extra', [round(x, 2) for x in r['movingExtraMs']], 'mirror', r['mirrorCallsMoving'])
