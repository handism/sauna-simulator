"""Compare local atlas interpolation against independent surface measurements.

python3 scripts/check_room_irradiance.py <bake-dir> <surface-sampling.json> <out.json>
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np


def check(directory, measured_path, output):
    header = json.loads((directory / 'room-irradiance.json').read_text())
    binary = (directory / 'room-irradiance.bin').read_bytes()
    assert hashlib.sha256(binary).hexdigest() == header['bin_sha256']
    measured = json.loads(measured_path.read_text())
    assert header['input_sha256'] == measured['input_sha256']
    depth = 8 if header['version'] == 2 else 6
    atlas = np.frombuffer(binary, dtype='<f2').astype(float).reshape(depth, header['height'], header['width'], 4)
    rows, excluded = [], []
    for si, key in enumerate(header['scenes']):
        for sample in measured['scenes'][key]['samples']:
            p, n = np.array(sample['position']), np.array(sample['normal'])
            pi = 0 if n[1] > .99 else 1
            plane = header['surfaces'][pi]
            q = p[[0, 2]] if pi == 0 else p[[0, 1]]
            q = (q - plane['min']) / (np.array(plane['max']) - plane['min'])
            if np.any(q < 0) or np.any(q > 1):
                continue
            coordinate = q * (np.array([plane['width'], plane['height']]) - 1)
            lo = np.floor(coordinate).astype(int)
            fraction = coordinate - lo
            fine = np.zeros(4)
            for j in (0, 1):
                for i in (0, 1):
                    xy = np.minimum(lo + [i, j], [plane['width'] - 1, plane['height'] - 1])
                    fine += np.prod(np.where([i, j], fraction, 1 - fraction)) * atlas[si * 2 + pi, xy[1], xy[0]]
            coarse = np.array(sample['grid_half_spacing_rgb'])
            fine_rgb = coarse * (1 - fine[3]) + fine[:3]
            for value in sample['measured']:
                reference = np.array(value['cosine_rgb'])
                if value['backface_cosine'] >= .25:
                    excluded.append(dict(scene=key, label=sample['label'], offset_m=value['offset_m'],
                                         backface_cosine=value['backface_cosine']))
                    continue
                luma = lambda v: float(v @ [.2126, .7152, .0722])
                rows.append(dict(scene=key, label=sample['label'], offset_m=value['offset_m'],
                                 valid=float(fine[3]), coarse_rgb=coarse.tolist(), fine_rgb=fine_rgb.tolist(),
                                 reference_rgb=reference.tolist(),
                                 coarse_ratio=luma(coarse) / luma(reference), fine_ratio=luma(fine_rgb) / luma(reference),
                                 coarse_rgb_error=float(np.abs(coarse-reference).mean()),
                                 fine_rgb_error=float(np.abs(fine_rgb-reference).mean())))
    summary = []
    for distance in (.02, .05):
        subset = [r for r in rows if r['offset_m'] == distance]
        summary.append(dict(offset_m=distance, points=len(subset),
                            coarse_error=float(np.mean([r['coarse_rgb_error'] for r in subset])),
                            fine_error=float(np.mean([r['fine_rgb_error'] for r in subset])),
                            improved=sum(r['fine_rgb_error'] < r['coarse_rgb_error'] for r in subset)))
    result = dict(input_sha256=header['input_sha256'], bake_sha256=header['bin_sha256'],
                  diagnostic_sha256=hashlib.sha256(measured_path.read_bytes()).hexdigest(), rows=rows, excluded=excluded, summary=summary,
                  scope='held-out local surface irradiance; not an image-quality percentage')
    output.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    check(*(Path(p) for p in sys.argv[1:]))
