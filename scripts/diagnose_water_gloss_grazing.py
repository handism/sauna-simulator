"""The dusk fill's tile gloss seen straight down through the plunge, from its image in the x side (no Blender).

python3 scripts/diagnose_water_gloss_grazing.py --out docs/3d-qa/water-gloss-grazing
  [--scene blender/diagnostics/water-gloss-scene] [--capture <water-gloss-capture.visual.ts PNGs>]
  [--points <file>]

The near half of the dusk disks (seen straight, not through a side) gets its tile gloss from the
fill's image in the x side (docs/3d-qa/water-gloss-capture). Per 5×5 block of that part of each crop
the floor point and air view come from the flat water box (summarize_water_gloss_scene.flat_view),
and the highlight is
- `exact`: integrated over the directions whose refracted paths, folded at the side, meet the disk
  (the side's Fresnel, both faces' transmission, the exit inside the water and over the coping; no
  tint, no occlusion);
- `round`: waterBottom.ts (shipped): the refracted path's direction to the center, a point light
  with GGX α'² = α² + DISK_WIDENING (r/d)²;
- `aniso`: the candidate: the same widened by (r/d)² / (l·h)² across the plane of the light and the
  view, the visibility term at the tile's α (not adopted, see the README).
They are compared with the Cycles tile gloss of diagnose_water_gloss_scene.py (`source`, and `rim`
/ `bare` without the objects outside the tub / also the coping) and, with --capture, the browser's.
On the floor grid of diagnose_water_floor_disk.py the direct highlight is scored the same way.
grazing.json holds the results; --points writes floor points of the part for
diagnose_water_gloss_image_occluders.py.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from diagnose_water_floor_disk import ALPHA, F0, LIGHTS, WIDENING, disk_frame, exact_direction, exact_integral, \
    floor_grid, ggx, run, score, single
from diagnose_water_gloss_scene import LUMINANCE, STRIDE
from diagnose_water_gloss_slab import fresnel
from summarize_water_gloss_capture import CROPS, blocks, linear, side_bounces
from summarize_water_gloss_scene import BOX, ROOT, camera_rays, flat_view, inside_fresnel
from water_gloss import IOR, LEVEL

RIM = 1.035
FILL = 'V10 lounge dusk fill'
LOW, HIGH = np.array([BOX[0], BOX[2]]), np.array([BOX[1], BOX[3]])


def fold(p, v, center, axes):
    """The floor point and view mirrored in the sides away from the light (glTF axes 0 = x, 2 = z)."""
    p, v, planes = np.array(p, float), np.array(v, float), {}
    for axis in axes:
        i = 0 if axis == 0 else 1
        plane = LOW[i] if center[axis] > p[axis] else HIGH[i]
        p[axis], v[axis], planes[axis] = 2 * plane - p[axis], -v[axis], plane
    return p, v, planes


def aniso_ggx(l, v, alpha, spread):
    """three's BRDF_GGX (F0 0.04) of a disk of angular radius `spread`, widened across the l–v plane by 1/(l·h)²."""
    n = np.array([0.0, 1.0, 0.0])
    h = (l + v) / np.linalg.norm(l + v)
    t = np.cross(l, v)
    t = t - n * (t @ n)
    t = t / np.linalg.norm(t) if np.linalg.norm(t) > 1e-9 else np.array([1.0, 0.0, 0.0])
    b = np.cross(n, t)
    widening = WIDENING * spread * spread
    across = alpha * alpha + widening / max(l @ h, 0.05) ** 2
    along = alpha * alpha + widening
    d = (h @ t) ** 2 / across + (h @ b) ** 2 / along + (h @ n) ** 2
    a2 = alpha * alpha
    nl, nv = max(l[1], 1e-6), max(v[1], 1e-6)
    visibility = 0.5 / (nl * math.sqrt(a2 + (1 - a2) * nv * nv) + nv * math.sqrt(a2 + (1 - a2) * nl * nl))
    return (F0 + (1 - F0) * (1 - max(v @ h, 0)) ** 5) * visibility / (math.pi * math.sqrt(across * along) * d * d)


def exits(p, d):
    """Where paths from floor point `p` along air directions `d` (…, 3) leave the flat surface (x, z)."""
    sine = np.clip(np.hypot(d[..., 0], d[..., 2]), 1e-9, 1 - 1e-9)
    r = run(sine, p[1])
    return p[[0, 2]] + np.stack([d[..., 0], d[..., 2]], -1) / sine[..., None] * r[..., None]


def image_integral(p0, v0, light, axes, steps=121):
    """The highlight per unit radiance over the disk seen from `p0` along paths folded at `axes`."""
    center, facing, radius = light
    center = np.array(center, float)
    n, _, _ = disk_frame(facing)
    p, v, planes = fold(p0, v0, center, axes)
    c = exact_direction(p, center)
    u = np.cross(c, [0.0, 1.0, 0.0])
    u /= np.linalg.norm(u)
    w = np.cross(c, u)
    span = 1.8 * np.arctan(radius / np.linalg.norm(center - p)) + 0.05
    g = np.linspace(-span, span, steps)
    x, y = np.meshgrid(g, g)
    d = c + x[..., None] * u + y[..., None] * w
    length = np.linalg.norm(d, axis=-1)
    d = d / length[..., None]
    ex = exits(p, d)
    ok = (d[..., 1] > 0) & np.all((ex > LOW) & (ex < HIGH), -1)
    side = np.ones(d.shape[:-1])
    for axis, plane in planes.items():
        i = 0 if axis == 0 else 1
        ok &= (ex[..., i] - plane) * (center[axis] - plane) > 0
        side *= np.vectorize(inside_fresnel)(np.abs(d[..., axis]) / IOR)
    reach = np.full(d.shape[:-1], 1e6)
    for i, axis in enumerate((0, 2)):
        da = d[..., axis]
        moving = np.abs(da) > 1e-9
        t = np.where(moving, (np.where(da > 0, HIGH[i], LOW[i]) - ex[..., i]) / np.where(moving, da, 1), 1e6)
        reach = np.minimum(reach, np.maximum(t, 0))
    ok &= LEVEL + reach * d[..., 1] >= RIM
    exit3 = np.stack([ex[..., 0], np.full(ex.shape[:-1], LEVEL), ex[..., 1]], -1)
    toward = d @ n
    t = ((center - exit3) @ n) / np.where(toward < 0, toward, -1.0)
    ok &= (np.linalg.norm(exit3 + t[..., None] * d - center, axis=-1) < radius) & (toward < 0) & (t > 0)
    weight = ok * (g[1] - g[0]) ** 2 / length ** 3 * d[..., 1] * (1 - fresnel(d[..., 1], IOR)) ** 2 * side
    return float((weight * ggx(d, v, ALPHA)).sum())


def image_point(p0, v0, light, axes, method):
    """The point-light estimates of the same (`round` shipped, `aniso` the candidate), per unit radiance."""
    center, facing, radius = light
    center = np.array(center, float)
    n, _, _ = disk_frame(facing)
    p, v, planes = fold(p0, v0, center, axes)
    c = exact_direction(p, center)
    ex = exits(p, c)
    if not np.all((ex > LOW) & (ex < HIGH)):
        return 0.0
    side = 1.0
    for axis, plane in planes.items():
        i = 0 if axis == 0 else 1
        if (ex[i] - plane) * (center[axis] - plane) <= 0:
            return 0.0
        side *= inside_fresnel(abs(c[axis]) / IOR)
    distance = np.linalg.norm(center - p)
    facing_cos = max(-(center - p) / distance @ n, 0.0)
    # Shipped: the disk's spread from the floor point itself.
    spread = radius / np.linalg.norm(center - p0)
    if method == 'round':
        brdf = float(ggx(c[None], v, math.sqrt(ALPHA ** 2 + WIDENING * spread ** 2))[0])
    else:
        brdf = aniso_ggx(c, v, ALPHA, spread)
    power = math.pi * radius ** 2 * facing_cos / distance ** 2
    return brdf * c[1] * power * (1 - fresnel(c[1], IOR)) ** 2 * side


def direct_aniso(p, v, light, refracted):
    center, facing, radius = light
    center = np.array(center, float)
    n, _, _ = disk_frame(facing)
    distance = np.linalg.norm(center - p)
    straight = (center - p) / distance
    l = exact_direction(p, center) if refracted else straight
    return aniso_ggx(l, v, ALPHA, radius / distance) * straight[1] * max(0.0, -straight @ n) / (np.pi * distance ** 2)


def stats(values, exact, cycles):
    return {
        'mean': float(values.mean()), 'max': float(values.max()),
        'sumOverExact': float(values.sum() / exact.sum()),
        'correlationExact': float(np.corrcoef(values, exact)[0, 1]),
        'correlationCyclesRim': float(np.corrcoef(values, cycles['rim'])[0, 1]),
        'correlationCyclesSource': float(np.corrcoef(values, cycles['source'])[0, 1]),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--scene', type=Path, default=ROOT / 'blender/diagnostics/water-gloss-scene')
    parser.add_argument('--capture', type=Path, help='a folder of gloss-{on,off}-<view>.png (browser, HEAD)')
    parser.add_argument('--points', type=Path, help='write floor points of the straight part here')
    args = parser.parse_args()
    view = json.loads((ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
    radiance = np.array(json.loads((args.scene / 'scene.json').read_text())['lightRadiance']) @ LUMINANCE
    light = LIGHTS[FILL]
    report, points = {'crops': {}}, []
    rng = np.random.default_rng(2)
    for heading, pitch, x0, x1, y0, y1 in CROPS:
        key = f'{heading}-{pitch}'
        h, w = (y1 - y0) // STRIDE, (x1 - x0) // STRIDE
        ys, xs = np.mgrid[:h, :w]
        pixels = np.stack([(xs * STRIDE + STRIDE // 2 + x0).ravel(), (ys * STRIDE + STRIDE // 2 + y0).ravel()], 1)
        rows = []
        for j, ray in enumerate(camera_rays(view, heading, pitch, pixels)):
            if side_bounces(view['position'], ray) != 0:
                continue
            traced = flat_view(view['position'], ray)
            if traced is None:
                continue
            floor, v, throughput = traced
            rows.append((j, floor, throughput * radiance * np.array([
                image_integral(floor, v, light, []), image_integral(floor, v, light, [0]),
                image_integral(floor, v, light, [2]), image_integral(floor, v, light, [0, 2]),
                image_point(floor, v, light, [0], 'round'), image_point(floor, v, light, [0], 'aniso')])))
        index = np.array([r[0] for r in rows])
        values = np.array([r[2] for r in rows])
        cycles = {c: blocks(np.load(args.scene / f'{c}-{key}.npz')['gloss'] @ LUMINANCE)[:h, :w].ravel()[index]
                  for c in ('source', 'rim', 'bare')}
        exact = values[:, :4].sum(1)
        crop = {
            'blocks': len(rows),
            'exactParts': {name: float(values[:, i].mean()) for i, name in enumerate(['direct', 'x', 'z', 'xz'])},
            'exact': stats(exact, exact, cycles),
            'round': stats(values[:, 4], exact, cycles),
            'aniso': stats(values[:, 5], exact, cycles),
            'cycles': {c: {'mean': float(a.mean()), 'max': float(a.max()),
                           'correlationExact': float(np.corrcoef(a, exact)[0, 1])} for c, a in cycles.items()},
        }
        if args.capture:
            load = lambda v: linear(args.capture / f'gloss-{v}-{key}.png', 0.5)[y0:y1, x0:x1]
            browser = blocks((load('on') - load('off')) @ LUMINANCE)[:h, :w].ravel()[index]
            crop['browser'] = stats(browser, exact, cycles)
        # Cycles over the exact integral by its quartiles and top decile.
        edges = [*np.quantile(exact, [0, 0.25, 0.5, 0.75, 0.9]), exact.max() + 1]
        crop['byExact'] = [{
            'blocks': int(m.sum()), 'exact': float(exact[m].mean()), 'round': float(values[m, 4].mean()),
            'aniso': float(values[m, 5].mean()), **{c: float(a[m].mean()) for c, a in cycles.items()},
        } for m in ((exact >= a) & (exact < b) for a, b in zip(edges[:-1], edges[1:]))]
        report['crops'][key] = crop
        pick = np.flatnonzero(cycles['rim'] > 0.01)
        for i in rng.choice(pick, 30, replace=False):
            points.append({'crop': key, 'floorGltf': rows[i][1].tolist(), 'exact': float(exact[i]),
                           'source': float(cycles['source'][i]), 'rim': float(cycles['rim'][i])})
        print(key, json.dumps({m: crop[m]['sumOverExact'] for m in ('round', 'aniso')}), flush=True)
    grid = floor_grid(20, 24)
    report['floorGrid'] = {}
    for name, lamp in LIGHTS.items():
        exact = np.array([exact_integral(p, v, lamp) for p, v in grid])
        methods = {
            'round': lambda p, v: single(p, v, lamp, False),
            'round-refracted': lambda p, v: single(p, v, lamp, True),
            'aniso': lambda p, v: direct_aniso(p, v, lamp, False),
            'aniso-refracted': lambda p, v: direct_aniso(p, v, lamp, True),
        }
        report['floorGrid'][name] = {m: score(np.array([f(p, v) for p, v in grid]), exact) for m, f in methods.items()}
        print(name, json.dumps(report['floorGrid'][name]), flush=True)
    digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    here = Path(__file__).resolve().parent
    report['inputs'] = {
        'scene': {f'{c}-{h}-{v}.npz': digest(args.scene / f'{c}-{h}-{v}.npz')
                  for c in ('source', 'rim', 'bare') for h, v, *_ in CROPS},
        'capture': {p.name: digest(p) for p in sorted(args.capture.glob('gloss-o*-*.png'))} if args.capture else None,
        'script_sha256': digest(here / 'diagnose_water_gloss_grazing.py'),
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'grazing.json').write_text(json.dumps(report, indent=1) + '\n')
    if args.points:
        args.points.write_text(json.dumps(points, indent=1) + '\n')


if __name__ == '__main__':
    main()
