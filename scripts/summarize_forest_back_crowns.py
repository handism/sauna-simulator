"""ABBA static comparison / independent-build cost for the added far forest crowns.

visual: report.json captures-root out
cost: --cost before1.json after1.json after2.json before2.json out
"""
import argparse
import base64
import hashlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

RUNS = ['before1', 'after1', 'after2', 'before2']


def read_report(path, attachment, expected):
    report = json.loads(Path(path).read_text())
    stats = report['stats']
    if stats['expected'] != expected or report['errors'] or any(stats[k] for k in ['unexpected','skipped','flaky']):
        raise ValueError(f'{path}: incomplete/unsuccessful report')
    def walk(suite):
        for spec in suite.get('specs', []):
            for test in spec['tests']:
                for result in test['results']:
                    for a in result.get('attachments', []):
                        if a['name'] == attachment:
                            yield json.loads(base64.b64decode(a['body']))
        for child in suite.get('suites', []):
            yield from walk(child)
    bodies = [body for suite in report['suites'] for body in walk(suite)]
    if len(bodies) != expected:
        raise ValueError('Missing/duplicate attachment')
    return bodies


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cost(paths, out):
    bodies=[]
    for i,path in enumerate(paths):
        captures=read_report(path,'forest-cost',2 if i<2 else 1)
        bodies.extend(b for b in captures if b['run'] != 'warmup')
    if [b['run'] for b in bodies] != RUNS:
        raise ValueError('Wrong ABBA order')
    ref=bodies[0]
    for b in bodies:
        if b['errors'] or b['inputs'] != ref['inputs'] or b['browser'] != ref['browser']:
            raise ValueError('Different inputs/browser or console errors')
        if not b.get('forestBuild') or b['forestBuild']['bundleHash'] != b['bundleHash'] or b['forestBuild']['sourceHash'] != b['sourceHash'] or b['forestBuild']['baseline'] != b['baseline']:
            raise ValueError('Actual served build does not match the cost metadata')
        if b['baseline'] != b['run'].startswith('before') or len(b['samples']) != 6:
            raise ValueError('Wrong variant or missing view')
        if (b['repeat'],b['dpr'],b['size'],b['heading']) != (3,1,[1280,800],20):
            raise ValueError('Different timing settings')
    for a,b in [(bodies[0],bodies[3]),(bodies[1],bodies[2])]:
        if a['sourceHash'] != b['sourceHash'] or a['bundleHash'] != b['bundleHash']:
            raise ValueError('Different same-variant build')
    if bodies[0]['sourceHash'] == bodies[1]['sourceHash']:
        raise ValueError('Cost needs the actual original geometry, not a fragment discard')
    comparisons=[]
    for a,b in [(bodies[0],bodies[1]),(bodies[3],bodies[2])]:
        for old,new in zip(a['samples'],b['samples'],strict=True):
            if (old['stage'],old['lighting']) != (new['stage'],new['lighting']):
                raise ValueError('Different timing views')
            for key in ['drawCalls','geometries','textures']:
                if old['metrics'][key] != new['metrics'][key]:
                    raise ValueError(f'Unexpected resource/draw change: {key}')
            delta = int(new['metrics']['triangles']) - int(old['metrics']['triangles'])
            if delta != 2592:raise ValueError('Unexpected far-crown triangle delta')
            comparisons.append(dict(stage=old['stage'],lighting=old['lighting'],pair=[a['run'],b['run']],
                beforeMs=old['intervalMeanMs'],afterMs=new['intervalMeanMs'],
                ratio=new['intervalMeanMs']/old['intervalMeanMs'],triangleDelta=delta,
                calls=old['metrics']['drawCalls'],geometries=old['metrics']['geometries'],textures=old['metrics']['textures']))
    result=dict(note='Issued rendering callback interval / repeat, not GPU time or device FPS.',
                reports={str(p):digest(p) for p in paths},captures=bodies,comparisons=comparisons)
    (out/'cost.json').write_text(json.dumps(result,indent=2)+'\n')
    print('cost ratios',min(r['ratio'] for r in comparisons),max(r['ratio'] for r in comparisons))


def visual(report, captures, out):
    bodies=read_report(report,'far-crowns',4)
    if [b['run'] for b in bodies] != RUNS:
        raise ValueError('Wrong ABBA order')
    ref=bodies[0]
    folders={}
    identity=lambda s:tuple(s.get(k) for k in ['file','stage','lighting','heading','season'])
    for b in bodies:
        if b['inputs'] != ref['inputs'] or b['browser'] != ref['browser'] or b['errors']:
            raise ValueError('Different input/browser or errors')
        if not b.get('forestBuild') or b['forestBuild'] != ref['forestBuild'] or b['forestBuild']['baseline']:
            raise ValueError('Same-build visual control was not validated')
        if bool(b['controls']) != b['run'].startswith('before'):
            raise ValueError('Missing/invalid shader control')
        if len(b['captures']) != 29 or [identity(s) for s in b['captures']] != [identity(s) for s in ref['captures']]:
            raise ValueError('Missing or different capture conditions')
        matches=[p for p in captures.iterdir() if p.is_dir() and p.name.endswith('-'+b['run'])]
        if len(matches)!=1:raise ValueError('Missing/ambiguous capture folder')
        folders[b['run']]=matches[0]
    hashes={run:{} for run in RUNS}
    comparisons=[]
    headings={}
    for sample in ref['captures']:
        name=sample['file']
        images={}
        for run,folder in folders.items():
            path=folder/name
            hashes[run][name]=digest(path)
            image=Image.open(path).convert('RGB')
            if image.size!=(1280,800):raise ValueError('Wrong screenshot size')
            images[run]=np.asarray(image,dtype=np.int16)
        if 'season' not in sample:
            key=(sample['stage'],sample['lighting'])
            if key in headings:
                old_heading, old_image=headings[key]
                if sample['heading'] <= old_heading or np.any(np.abs(images['before1']-old_image)>1,axis=2).sum()<10240:
                    raise ValueError('Heading input did not change the view enough; check focus')
            headings[key]=(sample['heading'],images['before1'])
        row=dict(file=name,stage=sample['stage'],lighting=sample['lighting'],heading=sample['heading'])
        for key,a,b in [('change1','before1','after1'),('change2','before2','after2'),
                        ('beforeReplay','before1','before2'),('afterReplay','after1','after2')]:
            d=np.abs(images[a]-images[b]);mask=np.any(d>1,axis=2)
            row[key]=dict(meanRGB=float(d.mean()),maxRGB=int(d.max()),pixelsOver1=int(mask.sum()))
        comparisons.append(row)
        if sample['stage']=='totonou' and sample['lighting']=='day':
            sheet=Image.new('RGB',(1280,1600))
            sheet.paste(Image.fromarray(images['before1'].astype(np.uint8)),(0,0))
            sheet.paste(Image.fromarray(images['after1'].astype(np.uint8)),(0,800))
            sheet.save(out/('compare-'+name))
    result=dict(note='Pixel differences and same-variant replays are not a quality percentage.',
                reportSHA256=digest(report),inputs=ref['inputs'],browser=ref['browser'],
                comparisons=comparisons,pngSHA256=hashes)
    (out/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    print('changed pixel range',min(r['change1']['pixelsOver1'] for r in comparisons),max(r['change1']['pixelsOver1'] for r in comparisons))
    print('replay max RGB',max(r[k]['maxRGB'] for r in comparisons for k in ['beforeReplay','afterReplay']))


def motion(root):
    reports={run:root/run/'report.json' for run in RUNS}
    bodies={run:read_report(path,'resolution-shimmer',1)[0] for run,path in reports.items()}
    ref=bodies['before1']
    for run,b in bodies.items():
        if not b.get('forestBuild') or b['forestBuild']['baseline'] != run.startswith('before'):
            raise ValueError('Actual served forest build was not validated')
        for key in ['query','quality','headingSteps','controlledFrames','fixedResolution','framesPerStep','yawPerStep','samples','sourceHash','browser']:
            if b[key]!=ref[key]:raise ValueError(f'Different motion {key}')
        if not b['controlledFrames'] or b['headingSteps']!=60 or '&camera=review' not in b['query']:
            raise ValueError('Wrong motion settings')
    for a,b in [('before1','before2'),('after1','after2')]:
        if bodies[a]['forestBuild']!=bodies[b]['forestBuild']:raise ValueError('Different same-variant build')
    def measure(run):
        candidates=[p for p in (root/run/'captures').iterdir() if p.is_dir()]
        if len(candidates)!=1:raise ValueError('Ambiguous motion capture folder')
        subprocess.run([sys.executable,str(Path(__file__).with_name('summarize_resolution_shimmer.py')),
                        str(reports[run]),str(candidates[0]),str(root/run/'summary')],check=True,stdout=subprocess.DEVNULL)
    with ThreadPoolExecutor(max_workers=2) as executor:list(executor.map(measure,RUNS))
    rows={run:json.loads((root/run/'summary/shimmer.json').read_text())['sequences'] for run in RUNS}
    comparisons=[]
    replay=[]
    for label,pairs,output in [('change',[('before1','after1'),('before2','after2')],comparisons),
                               ('replay',[('before1','before2'),('after1','after2')],replay)]:
        for a,b in pairs:
            for old,new in zip(rows[a],rows[b],strict=True):
                output.append(dict(stage=old['stage'],lighting=old['lighting'],pair=[a,b],
                    relative={k:new[k]/old[k] for k in ['pixel','tile','tileP99']}))
    result=dict(note='Controlled rotation-compensated residual; not perceptual flicker or FPS.',
                reports={run:digest(path) for run,path in reports.items()},
                inputs={run:b['forestBuild'] for run,b in bodies.items()},comparisons=comparisons,replay=replay)
    # Verify the added rank is actually visible, even if its smooth shading leaves the
    # rounded whole-frame residual unchanged. Indoor occlusion is recorded separately.
    coverage=[]
    folders={run:next(p for p in (root/run/'captures').iterdir() if p.is_dir()) for run in ['before1','after1']}
    for sample in ref['samples']:
        if sample['step'] not in [0,12]:continue
        name=sample['file']
        a=np.asarray(Image.open(folders['before1']/name).convert('RGB'),dtype=np.int16)
        b=np.asarray(Image.open(folders['after1']/name).convert('RGB'),dtype=np.int16)
        coverage.append(dict(file=name,stage=sample['stage'],lighting=sample['lighting'],
            pixelsOver1=int(np.any(np.abs(a-b)>1,axis=2).sum())))
    if len({r['stage'] for r in coverage if r['pixelsOver1']>100})<2:
        raise ValueError('Added far crowns were not visible in the motion comparison')
    result['visibleChange']=coverage
    result['pngSHA256']={run:{p.name:digest(p) for p in next(d for d in (root/run/'captures').iterdir() if d.is_dir()).glob('*.png')} for run in RUNS}
    (root/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
    print('motion tile ratios',min(x['relative']['tile'] for x in comparisons),max(x['relative']['tile'] for x in comparisons))


def main():
    parser=argparse.ArgumentParser(__doc__)
    parser.add_argument('--cost',action='store_true')
    parser.add_argument('--motion',action='store_true')
    parser.add_argument('paths',nargs='+')
    args=parser.parse_args()
    out=Path(args.paths[-1]);out.mkdir(parents=True,exist_ok=True)
    if args.motion:
        if len(args.paths)!=1:parser.error('motion root required')
        motion(out)
        return
    if args.cost:
        if len(args.paths)!=5:parser.error('four reports and output required')
        cost(args.paths[:-1],out)
    else:
        if len(args.paths)!=3:parser.error('report, captures, output required')
        visual(args.paths[0],Path(args.paths[1]),out)


if __name__=='__main__':main()
