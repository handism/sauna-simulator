"""Validate isolated before/after/after/before room frame-interval diagnostics."""
import base64
import hashlib
import json
from pathlib import Path
import sys


def read(path):
    raw = path.read_text()
    report = json.loads(raw[raw.index('{'):])
    assert all(report['stats'][k] == 0 for k in ('unexpected', 'flaky', 'skipped'))
    values = []
    def walk(s):
        for spec in s.get('specs', []):
            for t in spec['tests']:
                assert len(t['results']) == 1 and t['results'][0]['status'] == 'passed'
                for a in t['results'][0]['attachments']:
                    if a['name'] == 'room-cost.json':
                        values.append(json.loads(base64.b64decode(a['body'])))
        for child in s.get('suites', []):
            walk(child)
    for s in report['suites']:
        walk(s)
    assert len(values) == report['stats']['expected']
    assert all(v['variant'] in ('warmup', 'product') for v in values)
    products = [v for v in values if v['variant'] == 'product']
    assert len(products) == 1
    return products[0]


def main(paths, output):
    runs = [read(p) for p in paths]
    assert len(runs) == 4
    assert runs[0]['source'] == runs[3]['source'] and runs[1]['source'] == runs[2]['source']
    assert runs[0]['source'] != runs[1]['source']
    assert len({r['browser'] for r in runs}) == 1
    expected = [(v, t) for v in ('seated', 'rear') for t in ('day', 'night')]
    for r in runs:
        assert not r['errors'] and r['repeat'] == 3 and r['dpr'] == 1 and r['size'] == [1280, 800]
        assert [(s['view'], s['lighting']) for s in r['samples']] == expected
        assert all(s['frames'] > 20 and s['intervalMeanMs'] > 0 and s['metrics']['quality'] == 'standard'
                   and s['metrics']['garden'] == 'ready' and s['metrics']['pixelRatio'] == '1' for s in r['samples'])
    views = []
    for i, (v, t) in enumerate(expected):
        times = [r['samples'][i]['intervalMeanMs'] for r in runs]
        views.append(dict(view=v, lighting=t, before_ms=[times[0], times[3]], after_ms=[times[1], times[2]],
                          ratios=[times[1]/times[0], times[2]/times[3]],
                          before_metrics=runs[0]['samples'][i]['metrics'], after_metrics=runs[1]['samples'][i]['metrics']))
    result = dict(order=['before','after','after','before'], browser=runs[0]['browser'], views=views,
                  reports=[dict(file=p.name, sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in paths],
                  scope='fixed-resolution standard DPR1; mean drawn-frame intervals divided by three; not pure GPU time or device FPS')
    output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps([dict(view=r['view'], lighting=r['lighting'], ratios=r['ratios']) for r in views], indent=2))


if __name__ == '__main__':
    main([Path(p) for p in sys.argv[1:5]], Path(sys.argv[5]))
