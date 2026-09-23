"""Compare test:browser:visual's Cycles-camera captures with blender/renders (requires Pillow, NumPy).

Usage: python3 scripts/cycles_tone_stats.py [capture dir, default test-results/visual]
Prints CIELAB lightness (mean, 10/50/90th percentiles) and chroma per camera, whole frame and
for green pixels. A calibration aid for exposure and light balance, not an equivalence test.
Blue-hour references of the daylight cameras from scripts/blender_bluehour_reference.py, when
present, are compared with the evening captures and summarized separately.
"""
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image
root = Path(__file__).resolve().parents[1]
cams = json.loads((root/'e2e/fixtures/cycles-cameras.json').read_text())['cameras']
cap = Path(sys.argv[1]) if len(sys.argv) > 1 else root/'test-results/visual'
def lab(path):
    a = np.asarray(Image.open(path).convert('RGB').resize((600, 400), Image.Resampling.BOX), dtype=np.float64) / 255
    lin = np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)
    xyz = lin @ np.array([[.4124, .3576, .1805], [.2126, .7152, .0722], [.0193, .1192, .9505]]).T / [.9505, 1, 1.089]
    f = np.where(xyz > .008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    L = 116 * f[..., 1] - 16; A = 500 * (f[..., 0] - f[..., 1]); B = 200 * (f[..., 1] - f[..., 2])
    return L, np.hypot(A, B), np.degrees(np.arctan2(B, A)) % 360
bluehour = root/'blender/renders/web-bluehour'
pairs = []
for c in cams:
    # 06 is camera 01 in the blue-hour scene.
    num = '01' if c['render'] == '06.png' else c['render'][:2]
    pairs.append((c['render'], c['lighting'], root/'blender/renders'/c['render'], num))
    if c['lighting'] == 'day' and (bluehour/c['render']).exists():
        pairs.append((f"bh-{num}", 'evening', bluehour/c['render'], num))
rows = []
for render, light, ref, num in pairs:
    web = list(cap.rglob(f'cycles-{num}-{light}.jpg'))
    if len(web) != 1: continue
    Lc, Cc, Hc = lab(ref); Lw, Cw, Hw = lab(web[0])
    green = lambda H, C: (H > 90) & (H < 150) & (C > 12)
    gc, gw = green(Hc, Cc), green(Hw, Cw)
    rows.append(dict(render=render, light=light,
        L=(Lc.mean(), Lw.mean()), C=(Cc.mean(), Cw.mean()),
        Lp=(np.percentile(Lc, [10, 50, 90]), np.percentile(Lw, [10, 50, 90])),
        greenL=(Lc[gc].mean() if gc.any() else np.nan, Lw[gw].mean() if gw.any() else np.nan),
        greenC=(Cc[gc].mean() if gc.any() else np.nan, Cw[gw].mean() if gw.any() else np.nan),
        greenFrac=(gc.mean(), gw.mean())))
print(f"{'render':8}{'light':8}{'L* cyc/web':>14}{'C* cyc/web':>14}{'L10/50/90 cyc':>18}{'L10/50/90 web':>18}{'grnL':>12}{'grnC':>12}")
for r in rows:
    f = lambda p: '/'.join(f'{v:.0f}' for v in p)
    print(f"{r['render']:8}{r['light']:8}{r['L'][0]:7.1f}/{r['L'][1]:<6.1f}{r['C'][0]:7.1f}/{r['C'][1]:<6.1f}{f(r['Lp'][0]):>18}{f(r['Lp'][1]):>18}"
          f"{r['greenL'][0]:6.0f}/{r['greenL'][1]:<5.0f}{r['greenC'][0]:6.0f}/{r['greenC'][1]:<5.0f}")
def summary(rows, label):
    if not rows: return
    d = np.array([[r['L'][1] - r['L'][0], r['C'][1] - r['C'][0]] for r in rows])
    P = np.array([np.abs(r['Lp'][1] - r['Lp'][0]) for r in rows])
    G = np.array([abs(r['greenC'][1] - r['greenC'][0]) for r in rows])
    print(label, 'mean dL*', d[:, 0].mean().round(2), 'mean |dL*|', np.abs(d[:, 0]).mean().round(2), 'mean dC*', d[:, 1].mean().round(2))
    print(label, 'percentile |dL| L10/L50/L90', P.mean(0).round(2), 'all', P.mean().round(2), '| green |dC|', np.nanmean(G).round(2))
# The seven source renders keep their earlier summary; blue-hour references are reported apart.
summary([r for r in rows if not r['render'].startswith('bh-')], 'source')
summary([r for r in rows if r['light'] == 'evening'], 'evening')
