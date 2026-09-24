"""python3 scripts/refill_enclosed_probes.py <enclosure.json> [--threshold T] [--write <dir>]

Rejected candidate, kept to reproduce the record: mark probes whose mean free distance
(survey_probe_enclosure.py) is below T probe spacings invalid, refill them from valid face
neighbors with the bake's fill_invalid, and print the luminance ratio to the near-surface cosine
integrals at the 14 fixture points. --write puts candidate irradiance.json/.bin into <dir> (a
scratch copy of the app, never public/models). The refill starts from the shipped, already
filled coefficients, whose original invalid probes are not recorded.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from probe_sampling import ProbeSampler, fill_invalid

ROOT = Path(__file__).resolve().parents[1]
LUMA = np.array([.2126, .7152, .0722])


def refilled(base, enclosure, threshold):
    sampler = ProbeSampler.__new__(ProbeSampler)
    sampler.header = base.header
    data = base.data.copy()
    counts = {}
    for grid in base.header['grids']:
        survey = enclosure['grids'][grid['name']]
        count = int(np.prod(grid['resolution']))
        enclosed = np.array(survey['mean_free_m']) < threshold * survey['limit_m']
        counts[grid['name']] = int(enclosed.sum())
        for scene in base.header['scenes']:
            start = grid['offset'][scene]
            values = data[start:start + count * 27].reshape(count, 27)
            data[start:start + count * 27] = fill_invalid(values, ~enclosed, grid['resolution'])[0].ravel()
    sampler.data = data
    return sampler, counts


def ratios(sampler, measured):
    rows = []
    for scene in sampler.header['scenes']:
        for sample in measured['scenes'][scene]['samples']:
            value = LUMA @ sampler.sample(scene, sample['position'], sample['normal'])
            for m in sample['measured']:
                rows.append(dict(scene=scene, label=sample['label'], offset_m=m['offset_m'],
                                 ratio=float(value / (LUMA @ m['cosine_rgb']))))
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('enclosure', type=Path)
    parser.add_argument('--threshold', type=float, default=.4)
    parser.add_argument('--measured', type=Path, default=ROOT / 'docs/3d-qa/probe-sampling/surface-sampling.json')
    parser.add_argument('--write', type=Path)
    args = parser.parse_args()
    base = ProbeSampler(ROOT / 'public/models')
    enclosure = json.loads(args.enclosure.read_text())
    measured = json.loads(args.measured.read_text())
    if not base.header['input_sha256'] == enclosure['input_sha256'] == measured['input_sha256']:
        raise ValueError('probes, survey and measurements must come from the same blend')
    if enclosure['probe_bin_sha256'] != base.header['bin_sha256']:
        raise ValueError('survey was made for different probes')
    sampler, counts = refilled(base, enclosure, args.threshold)
    before, after = ratios(base, measured), ratios(sampler, measured)
    print('enclosed probes', counts)
    for a, b in zip(before, after):
        if abs(b['ratio'] / a['ratio'] - 1) > .01:
            print(f"  {a['scene']} {a['label']} {a['offset_m']}: {a['ratio']:.3f} -> {b['ratio']:.3f}")
    print('mean |log2 ratio|', round(float(np.mean([abs(np.log2(r['ratio'])) for r in before])), 3), '->',
          round(float(np.mean([abs(np.log2(r['ratio'])) for r in after])), 3))
    if args.write:
        if args.write.resolve() == (ROOT / 'public/models').resolve():
            raise ValueError('write candidates to a scratch copy, not the shipped models')
        binary = sampler.data.astype('<f2').tobytes()
        header = dict(base.header, bin_sha256=hashlib.sha256(binary).hexdigest())
        (args.write / 'irradiance.bin').write_bytes(binary)
        (args.write / 'irradiance.json').write_text(json.dumps(header))
        print('wrote', args.write, header['bin_sha256'])


if __name__ == '__main__':
    main()
