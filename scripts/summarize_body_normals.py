"""Summarize the four settled + four close captures and two memory runs.

Usage: python3 scripts/summarize_body_normals.py /tmp/sauna-body candidate.json out.json
Candidate generation and browser commands are in docs/3d-qa/body-attributes/README.md.
"""
import base64
import hashlib
import json
import sys
from pathlib import Path

from summarize_frame_cost import image_delta, image_runs


def attachment(path, name):
    text = Path(path).read_text()
    # bun's Vite output precedes Playwright's JSON.
    report = json.loads(text[text.index('\n{') + 1:] if not text.startswith('{') else text)
    assert not report['errors']
    assert report['stats']['unexpected'] == report['stats']['skipped'] == report['stats']['flaky'] == 0
    assert report['stats']['expected'] > 0
    results = []

    def visit(suites):
        for suite in suites:
            visit(suite.get('suites', []))
            for spec in suite.get('specs', []):
                for test in spec['tests']:
                    assert test['status'] == 'expected'
                    for result in test['results']:
                        assert result['status'] == 'passed'
                        for item in result['attachments']:
                            if item['name'] == name:
                                results.append(json.loads(base64.b64decode(item['body'])))
    visit(report['suites'])
    assert len(results) == 1, (path, name)
    return results[0], report['stats']


prefix, candidate_path, output = sys.argv[1:]
candidate = json.loads(Path(candidate_path).read_text())
out = {'candidate': candidate, 'captures': {}, 'images': {}, 'memory': {}}
for group, attachments in [('settled', ['cycles-compare', 'stage-compare']), ('close', ['body-normals'])]:
    metas = {}
    for run in ['base1', 'candidate1', 'candidate2', 'base2']:
        captures = {}
        for name in attachments:
            data, stats = attachment(f'{prefix}-{group}-{run}.json', name)
            assert stats['expected'] == (2 if group == 'settled' else 1)
            assert len(data['samples']) == {'cycles-compare': 18, 'stage-compare': 12, 'body-normals': 3}[name]
            substitute = data.get('bodyCandidate')
            if run.startswith('candidate'):
                assert substitute['sha256'] == candidate['outputSha256']
            else:
                assert substitute is None
            if 'hashes' in data:
                assert data['hashes']['sauna.glb'] == candidate['inputSha256']
            if 'sourceSha256' in data:
                assert data['sourceSha256'] == candidate['inputSha256']
            for sample in data['samples']:
                assert sample['metrics']['quality'] == 'standard'
                assert sample['metrics']['pixelRatio'] == '1.5'
            captures[name] = {'stats': stats, 'metadata': data}
        metas[run] = captures
    for name in attachments:
        baseline = metas['base1'][name]['metadata']['samples']
        for run in ['candidate1', 'candidate2', 'base2']:
            other = metas[run][name]['metadata']['samples']
            for a, b in zip(baseline, other):
                assert a['file'] == b['file']
                for key in ['stage', 'lighting', 'refractionMaterials', 'refractionTriangles']:
                    assert a['metrics'].get(key) == b['metrics'].get(key), (run, name, key)
    out['captures'][group] = metas
    root = lambda run: f'{prefix}-{group}-{run}'
    out['images'][group] = {
        'firstPair': image_delta(root('base1'), root('candidate1')),
        'secondPair': image_delta(root('base2'), root('candidate2')),
        'baseReplay': image_delta(root('base1'), root('base2')),
        'candidateReplay': image_delta(root('candidate1'), root('candidate2')),
        'replayHashes': image_runs([root('base1'), root('base2')], [root('candidate1'), root('candidate2')]),
    }

memory_rows = {}
for run in ['base', 'candidate']:
    data, stats = attachment(f'{prefix}-memory-{run}.json', 'gpu-memory')
    if run == 'candidate':
        assert data['bodyCandidate']['sha256'] == candidate['outputSha256']
    else:
        assert data['bodyCandidate'] is None
    values = {}
    for sample in data['samples']:
        if sample['label'] == 'loaded':
            continue
        key = sample['stage'] + '/' + sample['quality']
        memory = sample['memory']
        row = {**memory['bytes'], 'drawingBuffer': memory['drawingBufferBytes']}
        row['total'] = sum(row.values())
        assert key not in values or values[key] == row
        values[key] = row
    assert len(values) == 9
    assert all(context['lost'] for context in data['released'])
    memory_rows[run] = values
    out['memory'][run] = {'stats': stats, 'bodyCandidate': data['bodyCandidate'], 'values': values,
                          'releasedContexts': len(data['released'])}
out['memory']['savedBytes'] = {key: {field: memory_rows['base'][key][field] - memory_rows['candidate'][key][field]
                                   for field in memory_rows['base'][key]}
                             for key in memory_rows['base']}
out['summaryScriptSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
out['captureScriptSha256'] = {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in
                            ['e2e/scene-capture.ts', 'e2e/model-candidate.ts', 'e2e/cycles-compare.visual.ts',
                             'e2e/stage-compare.visual.ts', 'e2e/body-normals.visual.ts', 'e2e/gpu-memory.e2e.ts']}
out['scope'] = 'Static Chrome captures; WebGL allocation-call estimates, not driver memory or GPU time. No motion, mobile or listening verification.'
Path(output).write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
for group, comparisons in out['images'].items():
    print(group, json.dumps(comparisons['firstPair'], ensure_ascii=False))
print('memory saved bytes', out['memory']['savedBytes'])
