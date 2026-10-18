"""Compare changed bench, wall and ceiling pixels to independent Cycles renders."""
import hashlib
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from summarize_water_bump import lab

capture, reference, output = map(Path, sys.argv[1:])
refs = json.loads((reference / 'references.json').read_text())
rows = []
assert refs['input_sha256'] == json.loads(Path('public/models/room-irradiance.json').read_text())['input_sha256']
for view in ('bench', 'left', 'ceiling'):
    for lighting in ('day', 'evening', 'night'):
        paths = [capture / f'room-surfaces.visual.ts-room-surfaces-{run}-1' / f'{view}-{lighting}.png' for run in ('before', 'after')]
        ref_path = reference / f'{view}-{lighting}.png'
        expected = next(r for r in refs['captures'] if r['lighting'] == lighting and r['view'] == view)
        assert hashlib.sha256(ref_path.read_bytes()).hexdigest() == expected['sha256']
        ref = Image.open(ref_path).convert('RGB')
        assert ref.size == (640, 400)
        pair = [np.array(Image.open(p).convert('RGB').resize(ref.size, Image.Resampling.BOX), dtype=np.int16) for p in paths]
        mask = np.max(np.abs(pair[1] - pair[0]), axis=2) > 1
        changed = int(mask.sum())
        assert changed > 100 or lighting == 'day'
        region = 'changed pixels >1 RGB level'
        if changed <= 100:
            mask = np.ones(mask.shape, dtype=bool)
            region = 'whole frame; daytime correction disabled'
        truth = lab(np.asarray(ref))
        errors = [np.linalg.norm(lab(a) - truth, axis=2)[mask].mean() for a in pair]
        rows.append(dict(view=view, lighting=lighting, changed_pixels=changed, region=region, before_deltaE=float(errors[0]),
                         after_deltaE=float(errors[1]), reference_sha256=expected['sha256'],
                         browser_sha256=[hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]))
output.write_text(json.dumps(dict(references=refs, rows=rows,
    scope='local changed pixels, >1 RGB level after 2x box downsampling; source geometry/material differences remain; not overall image-quality improvement'), indent=2)+'\n')
print(json.dumps(rows, indent=2))
