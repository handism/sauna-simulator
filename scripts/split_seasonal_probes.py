"""Cuts a season's rebake down to the outdoor grids the browser swaps in (seasonalProbes.ts).

Run: python3 scripts/split_seasonal_probes.py <season> <irradiance-out-dir> <reflection-out-dir>
Each dir is the --out of bake_irradiance_probes.py -- --season <season> --grids courtyard,outer
[--reflection]. Writes public/models/seasons/<season>-irradiance.{json,bin} and
<season>-reflection.{json,bin} (the courtyard and outer grids only, the same layout and float16
packing as the shipped files) and docs/3d-qa/seasonal-probes/<season>-bake.json (the bake reports).
Checks the bakes' season, input and layout against the shipped summer files. Needs NumPy.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
GRIDS = ('courtyard', 'outer')
SCENES = ('day', 'evening', 'night')


def split(season, kind, source):
    header = json.loads((source / f'{kind}.json').read_text())
    data = np.frombuffer((source / f'{kind}.bin').read_bytes(), dtype='<f2')
    report = json.loads((source / f'{kind}-report.json').read_text())
    shipped = json.loads((ROOT / f'public/models/{kind}.json').read_text())
    if report.get('season', {}).get('name') != season or report['mode'] != kind:
        raise SystemExit(f'{source}: not a {season} {kind} bake')
    if sorted(report['season']['rebaked_grids']) != sorted(GRIDS):
        raise SystemExit(f'{source}: rebaked {report["season"]["rebaked_grids"]}')
    if header['input_sha256'] != shipped['input_sha256'] or hashlib.sha256(data.tobytes()).hexdigest() != header['bin_sha256']:
        raise SystemExit(f'{source}: another input or a damaged binary')
    chunks, grids, offset = [], [], 0
    for name in GRIDS:
        grid = next(g for g in header['grids'] if g['name'] == name)
        summer = next(g for g in shipped['grids'] if g['name'] == name)
        if [grid[k] for k in ('min', 'max', 'resolution')] != [summer[k] for k in ('min', 'max', 'resolution')]:
            raise SystemExit(f'{source}: {name} layout differs from the shipped grid')
        count = int(np.prod(grid['resolution'])) * 27
        entry = dict(name=name, min=grid['min'], max=grid['max'], resolution=grid['resolution'], offset={})
        for scene in SCENES:
            values = data[grid['offset'][scene]:grid['offset'][scene] + count]
            if not np.isfinite(values.astype(np.float32)).all():
                raise SystemExit(f'{source}: {name} {scene} not finite')
            entry['offset'][scene] = offset
            offset += count
            chunks.append(values)
        grids.append(entry)
    binary = np.concatenate(chunks).astype('<f2').tobytes()
    out = ROOT / 'public/models/seasons'
    out.mkdir(parents=True, exist_ok=True)
    (out / f'{season}-{kind}.bin').write_bytes(binary)
    (out / f'{season}-{kind}.json').write_text(json.dumps(dict(
        season=season, input_sha256=header['input_sha256'], format=header['format'], scenes=list(SCENES),
        grids=grids, bin_sha256=hashlib.sha256(binary).hexdigest()), indent=2) + '\n')
    return report


def main():
    season, irradiance, reflection = sys.argv[1:]
    if season not in ('spring', 'autumn', 'winter'):
        raise SystemExit(season)
    reports = {kind: split(season, kind, Path(source)) for kind, source in (('irradiance', irradiance), ('reflection', reflection))}
    qa = ROOT / 'docs/3d-qa/seasonal-probes'
    qa.mkdir(parents=True, exist_ok=True)
    (qa / f'{season}-bake.json').write_text(json.dumps(reports, indent=2) + '\n')
    for kind in reports:
        print(season, kind, (ROOT / f'public/models/seasons/{season}-{kind}.bin').stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
