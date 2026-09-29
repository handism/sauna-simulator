"""How well the plunge floor's highlight of V9 and the lounge dusk fill sums their disks (no Blender).

python3 scripts/diagnose_water_floor_disk.py --out docs/3d-qa/water-floor-disk

The floor lies in the air under the source water's flat bottom; a light reaches it along refracted
paths (water_gloss.py). On a 40×48 grid over the floor, seen from the plunge camera (the view in the
air gap is the camera's air direction, parallel faces), the tile's GGX highlight (roughness 0.3,
F0 0.04, three's BRDF_GGX) per unit power is integrated exactly over the directions whose refracted
paths meet the disk (a 121² grid of directions around its center; no occlusion, no Fresnel of the
water, which every method shares), and compared with:

- `current`: waterBottom.ts (shipped), the straight line to the center, α'² = α² + 0.25 (r/d)²;
- `center`: the same with the refracted path's direction to the center;
- `product`: the candidate tried on 2026-09-30 (not adopted): the center and a ring of 6 of equal area, each along its refracted path (2 Newton
  steps from the straight line), with the straight line's falloff and α'² = α² + 0.25 (r/d)² / 7;
- `product-1step`, `ring2-exact` (19 points, bisection): the same with fewer steps / more points.

disk.json holds, per light and method, the grid sum's ratio to the exact one (all and the top 20%
of points), the L1 error relative to the exact sum and the correlation.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

from water_gloss import BOTTOM, IOR, LEVEL

FLOOR = 0.202
# glTF axes (y up).
CAMERA = np.array([1.18, 1.12, -2.7])
BOX = (-0.155, 2.515, -4.095, -0.905)
ALPHA = 0.09
F0 = 0.04
WIDENING = 0.25
# Center, the direction the disk faces, radius (glossyLights.ts).
LIGHTS = {
    'V9 lounge patch of sunlight': ((3.8, 6.8, 1.5), (0.13, -0.9176, -0.3757), 0.625),
    'V10 lounge dusk fill': ((5.9, 2.8, 1.4), (-0.3142, -0.6569, -0.6854), 1.0),
}


def run(sine, floor=FLOOR, ior=IOR):
    """Horizontal run from the floor to the surface of a path whose air direction has `sine`."""
    water = sine / ior
    return (BOTTOM - floor) * sine / np.sqrt(1 - sine * sine) + (LEVEL - BOTTOM) * water / np.sqrt(1 - water * water)


def exact_direction(p, q, ior=IOR):
    """The air direction of the refracted path from floor point `p` to `q` above the surface."""
    d = q - p
    h = np.hypot(d[0], d[2])
    above = q[1] - LEVEL
    low, high = 0.0, 1 - 1e-12
    for _ in range(60):
        s = (low + high) / 2
        if run(s, p[1], ior) + above * s / np.sqrt(1 - s * s) < h:
            low = s
        else:
            high = s
    return np.array([d[0] / h * low, np.sqrt(1 - low * low), d[2] / h * low])


def newton_direction(p, q, steps):
    """The candidate's Newton steps on the air direction's sine, from the straight line's."""
    d = q - p
    h = np.hypot(d[0], d[2])
    depth = LEVEL - BOTTOM
    air = d[1] - depth
    s = h / np.linalg.norm(d)
    for _ in range(steps):
        c2 = 1 - s * s
        w = s / IOR
        w2 = 1 - w * w
        f = air * s / np.sqrt(c2) + depth * w / np.sqrt(w2) - h
        s = min(0.999, s - f / (air / c2**1.5 + depth / IOR / w2**1.5))
    return np.array([d[0] / h * s, np.sqrt(1 - s * s), d[2] / h * s])


def ggx(l, v, alpha):
    """three's BRDF_GGX on a floor facing up, Schlick F0 0.04."""
    h = l + v
    h = h / np.linalg.norm(h, axis=-1, keepdims=True)
    nl = np.clip(l[..., 1], 1e-6, 1)
    nv = max(v[1], 1e-6)
    nh = np.clip(h[..., 1], 0, 1)
    vh = np.clip((h * v).sum(-1), 0, 1)
    a2 = alpha * alpha
    d = a2 / (np.pi * (nh * nh * (a2 - 1) + 1) ** 2)
    f = F0 + (1 - F0) * (1 - vh) ** 5
    return f * 0.5 / (nl * np.sqrt(a2 + (1 - a2) * nv * nv) + nv * np.sqrt(a2 + (1 - a2) * nl * nl)) * d


def disk_frame(facing):
    n = np.array(facing, float)
    n /= np.linalg.norm(n)
    u = np.cross(n, [0.0, 1.0, 0.0])
    u /= np.linalg.norm(u)
    return n, u, np.cross(n, u)


def exact_integral(p, v, light, steps=121, ior=IOR):
    """The highlight per unit power over the directions whose refracted paths meet the disk."""
    center, facing, radius = light
    center = np.array(center, float)
    n, _, _ = disk_frame(facing)
    c = exact_direction(p, center, ior)
    u = np.cross(c, [0.0, 1.0, 0.0])
    u /= np.linalg.norm(u)
    w = np.cross(c, u)
    span = 1.8 * np.arctan(radius / np.linalg.norm(center - p)) + 0.05
    g = np.linspace(-span, span, steps)
    x, y = np.meshgrid(g, g)
    d = c + x[..., None] * u + y[..., None] * w
    length = np.linalg.norm(d, axis=-1, keepdims=True)
    d = d / length
    solid = (g[1] - g[0]) ** 2 / length[..., 0] ** 3
    sine = np.clip(np.hypot(d[..., 0], d[..., 2]), 1e-9, 0.999999)
    r = run(sine, p[1], ior)
    exit_ = np.stack([p[0] + d[..., 0] / sine * r, np.full_like(sine, LEVEL), p[2] + d[..., 2] / sine * r], -1)
    toward = d @ n
    t = ((center - exit_) @ n) / np.where(toward < 0, toward, -1)
    hit = exit_ + t[..., None] * d
    inside = (np.linalg.norm(hit - center, axis=-1) < radius) & (toward < 0) & (d[..., 1] > 0)
    return float((ggx(d, v, ALPHA) * d[..., 1] * inside * solid).sum() / (np.pi**2 * radius * radius))


def disk_points(light, rings):
    """The center and rings of 6k points of equal area (rings=1: the candidate)."""
    center, facing, radius = light
    center = np.array(center, float)
    n, u, w = disk_frame(facing)
    count = 1 + sum(6 * k for k in range(1, rings + 1))
    points = [center]
    for k in range(1, rings + 1):
        r = np.sqrt((1 + sum(6 * j for j in range(1, k)) + 3 * k) / count) * radius
        for i in range(6 * k):
            a = 2 * np.pi * (i + 0.5 * (k % 2)) / (6 * k)
            points.append(center + u * r * np.cos(a) + w * r * np.sin(a))
    return points, n, radius, count


def summed(p, v, light, rings=1, steps=2):
    """The candidate's sum (steps < 0: the exact direction of each point)."""
    points, n, radius, count = disk_points(light, rings)
    total = 0.0
    for q in points:
        distance = np.linalg.norm(q - p)
        straight = (q - p) / distance
        falloff = -straight @ n
        if falloff <= 0:
            continue
        l = exact_direction(p, q) if steps < 0 else newton_direction(p, q, steps)
        alpha = np.sqrt(ALPHA**2 + WIDENING * (radius / distance) ** 2 / count)
        total += ggx(l, v, alpha) * straight[1] * falloff / (np.pi * distance**2)
    return total / count


def single(p, v, light, refracted):
    center, facing, radius = light
    center = np.array(center, float)
    n, _, _ = disk_frame(facing)
    distance = np.linalg.norm(center - p)
    straight = (center - p) / distance
    l = exact_direction(p, center) if refracted else straight
    alpha = np.sqrt(ALPHA**2 + WIDENING * (radius / distance) ** 2)
    return ggx(l, v, alpha) * straight[1] * max(0.0, -straight @ n) / (np.pi * distance**2)


METHODS = {
    'current': lambda p, v, light: single(p, v, light, False),
    'center': lambda p, v, light: single(p, v, light, True),
    'product': lambda p, v, light: summed(p, v, light),
    'product-1step': lambda p, v, light: summed(p, v, light, steps=1),
    'ring2-exact': lambda p, v, light: summed(p, v, light, rings=2, steps=-1),
}


def floor_grid(nx=40, nz=48):
    x0, x1, z0, z1 = BOX
    points = []
    for x in np.linspace(x0 + 0.035, x1 - 0.045, nx):
        for z in np.linspace(z0 + 0.025, z1 - 0.025, nz):
            p = np.array([x, FLOOR, z])
            points.append((p, exact_direction(p, CAMERA)))
    return points


def score(values, exact):
    top = exact > np.percentile(exact, 80)
    return {
        'sum': round(float(values.sum() / exact.sum()), 4),
        'sumTop20': round(float(values[top].sum() / exact[top].sum()), 4),
        'l1': round(float(np.abs(values - exact).sum() / exact.sum()), 4),
        'correlation': round(float(np.corrcoef(values, exact)[0, 1]), 4),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    grid = floor_grid()
    report = {'grid': [40, 48], 'camera': CAMERA.tolist(), 'alpha': ALPHA, 'lights': {}}
    for name, light in LIGHTS.items():
        exact = np.array([exact_integral(p, v, light) for p, v in grid])
        report['lights'][name] = {
            method: score(np.array([f(p, v, light) for p, v in grid]), exact) for method, f in METHODS.items()
        }
        print(name, json.dumps(report['lights'][name]), flush=True)
    here = Path(__file__).resolve().parent
    report['scripts'] = {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in (Path(__file__).resolve(), here / 'water_gloss.py')
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'disk.json').write_text(json.dumps(report, indent=1) + '\n')


if __name__ == '__main__':
    main()
