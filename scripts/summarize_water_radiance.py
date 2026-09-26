"""Summarize local HDR shading reuse error; no claim of full-image accuracy."""
import argparse
from collections import defaultdict
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def summarize(report):
    samples = defaultdict(dict)
    for render in report['renders']:
        if render.get('valid_position'):
            samples[(render['scene'], render['index'], render['mode'])][render['seed']] = render
    means, noise = {}, []
    component_noise = defaultdict(list)
    for key, seeds in samples.items():
        if set(seeds) != set(report['seeds']):
            continue
        means[key] = {part: np.mean([r['colors'][part] for r in seeds.values()], axis=0)
                      for part in ('diffuse_emission', 'glossy', 'combined')}
        a, b = [np.array(seeds[s]['colors']['combined']) for s in report['seeds']]
        denominator = max(1e-8, np.sum((a+b)/2))
        noise.append(float(np.sum(np.abs(a-b)) / denominator))
        for part in ('diffuse_emission', 'glossy'):
            values = [np.array(seeds[s]['colors'][part]) for s in report['seeds']]
            component_noise[part].append(float(np.sum(np.abs(values[0]-values[1])) / denominator))
    comparisons = []
    for (scene, index, mode), candidate in means.items():
        path = means.get((scene, index, 'path'))
        if mode == 'path' or path is None:
            continue
        denominator = max(1e-8, float(sum(path['combined'])))
        row = {'scene': scene, 'index': index, 'group': report['selected'][index]['group'], 'mode': mode}
        for part in ('combined', 'diffuse_emission', 'glossy'):
            row[part + '_rgb_l1_over_path_total'] = float(np.sum(np.abs(candidate[part] - path[part])) / denominator)
        row['path_glossy_fraction'] = float(sum(path['glossy']) / denominator)
        # Optimistic hybrid: capture DE + exact path glossy; no practical way to
        # obtain the latter is implemented. This isolates residual diffuse error.
        comparisons.append(row)
    aggregates = {}
    for mode in ('camera', 'overhead', 'normal'):
        rows = [r for r in comparisons if r['mode'] == mode]
        aggregates[mode] = {'count': len(rows)}
        for part in ('combined', 'diffuse_emission', 'glossy'):
            values = [r[part + '_rgb_l1_over_path_total'] for r in rows]
            aggregates[mode][part] = dict(zip(('median', 'p90', 'max'), map(float, np.percentile(values, [50,90,100])))) if values else None
    summary = {'selected_points': len(report['selected']),
               'rendered_exrs': sum('colors' in r for r in report['renders']),
               'skipped_directions': sum('skipped' in r for r in report['renders']),
               'invalid_positions': sum(not r['valid_position'] for r in report['renders'] if 'colors' in r),
               'position_error_max_m': max(r['position_error_m'] for r in report['renders'] if 'colors' in r),
               'pass_reconstruction_max_abs': max(r['reconstruction_max_abs'] for r in report['renders'] if 'colors' in r),
               'two_seed_total_rgb_difference': dict(zip(('median','p90','max'), map(float,np.percentile(noise,[50,90,100])))),
               'two_seed_component_difference_over_total': {k: dict(zip(('median','p90','max'), map(float,np.percentile(v,[50,90,100])))) for k,v in component_noise.items()},
               'aggregates': aggregates, 'comparisons': comparisons}
    return summary, means


def unavailable_reason(report, scene, index, mode):
    renders = [r for r in report['renders'] if (r['scene'], r['index'], r['mode']) == (scene, index, mode)]
    if any('skipped' in r for r in renders):
        return 'grazing / backface'
    if any('colors' in r and not r['valid_position'] for r in renders):
        return 'position > 0.1 mm'
    return 'unavailable'


def swatches(report, means, path):
    # Fixed linear->sRGB transform (no exposure adjustment or per-swatch scaling).
    def srgb(v):
        v = np.maximum(0, v)
        v = np.where(v <= 0.0031308, 12.92*v, 1.055*v**(1/2.4)-0.055)
        return tuple(np.clip(np.round(v*255),0,255).astype(int))
    rows = len(report['selected']) * 2
    image = Image.new('RGB', (1140, 70+rows*36), '#181d24')
    draw = ImageDraw.Draw(image)
    draw.text((12,10), 'Local endpoint colors | total / diffuse+emission / glossy | fixed sRGB, no tone mapping', fill='white')
    modes = ['path','camera','overhead','normal']
    for m,mode in enumerate(modes):
        draw.text((365+m*190, 38),mode,fill='white')
    for row, (scene,index) in enumerate((s,i) for s in ('day','evening') for i in range(len(report['selected']))):
        y = 68+row*36
        point = report['selected'][index]
        draw.text((12,y+6),f"{scene:7} {index:02} {point['group']} {point['pixel']}",fill='white')
        for col,mode in enumerate(modes):
            colors = means.get((scene,index,mode))
            if colors:
                for k,part in enumerate(('combined','diffuse_emission','glossy')):
                    x=365+col*190+k*55
                    draw.rectangle((x,y,x+49,y+27),fill=srgb(colors[part]))
            else:
                draw.text((365+col*190,y+6),unavailable_reason(report,scene,index,mode),fill='#aaaaaa')
    image.save(path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',type=Path)
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    report=json.loads(args.input.read_text())
    args.out.mkdir(parents=True,exist_ok=True)
    summary,means=summarize(report)
    (args.out/'radiance.json').write_text(json.dumps(report,indent=2)+'\n')
    (args.out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    swatches(report,means,args.out/'swatches.png')
    print(json.dumps({k:v for k,v in summary.items() if k!='comparisons'},indent=2))


if __name__=='__main__':
    main()
