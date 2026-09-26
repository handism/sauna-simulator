"""A baked, direction-binned correction of the water box walk for underwater occlusion; Blender axes.

The box walk of water_exit_sampling.py lets every lobe sample reach the water
top unless the box sides or bottom stop it. In the source scene the plinth
recess, steps and the air gap under the water stop or add light. Here that is
corrected by a table baked at cell-centred grid nodes: for a fixed set of
directions, the traced exit weight T (both Fresnel branches through the source
water and scene) and the box walk's exit weight B, summed per octahedral
direction bin. A lobe sample in direction d at position p is scaled by
sum_c w_c T_c[bin(d)] / sum_c w_c B_c[bin(d)] over the trilinear corners c of
p, skipping nodes inside solid geometry. A 1 x 1 octahedral map is a scalar
per node. Premultiplied sums keep bins with no box exit at a node harmless.

A floor horizon map is the other candidate: per floor texel, the highest
occluded elevation at K azimuths; a lobe sample below the bilinearly mixed,
azimuthally interpolated horizon is dropped.
"""
import math

import numpy as np

GOLDEN = math.pi * (3 - math.sqrt(5))


def fibonacci_sphere(count):
    """Unit directions spread evenly over the sphere."""
    result = []
    for i in range(count):
        z = 1 - (2 * i + 1) / count
        r = math.sqrt(max(0.0, 1 - z * z))
        result.append((r * math.cos(GOLDEN * i), r * math.sin(GOLDEN * i), z))
    return result


def octahedral_bin(direction, size):
    """Index of the direction's texel in a size x size octahedral map of the whole sphere (Z up)."""
    x, y, z = direction
    norm = abs(x) + abs(y) + abs(z)
    u, v = x / norm, y / norm
    if z < 0:
        u, v = (1 - abs(v)) * math.copysign(1, u), (1 - abs(u)) * math.copysign(1, v)
    column = min(size - 1, int((u + 1) / 2 * size))
    row = min(size - 1, int((v + 1) / 2 * size))
    return row * size + column


def octahedral_bins(directions, size):
    """octahedral_bin for an (N, 3) array."""
    d = np.asarray(directions, dtype=np.float64)
    d = d / np.abs(d).sum(axis=1, keepdims=True)
    u, v = d[:, 0].copy(), d[:, 1].copy()
    lower = d[:, 2] < 0
    u[lower] = (1 - np.abs(d[lower, 1])) * np.where(d[lower, 0] >= 0, 1, -1)
    v[lower] = (1 - np.abs(d[lower, 0])) * np.where(d[lower, 1] >= 0, 1, -1)
    column = np.minimum(size - 1, ((u + 1) / 2 * size).astype(int))
    row = np.minimum(size - 1, ((v + 1) / 2 * size).astype(int))
    return row * size + column


class Grid:
    """Cell-centred nodes: origin + (index + 0.5) * spacing, with counts along x, y, z."""

    def __init__(self, lower, upper, spacing):
        self.lower, self.spacing = tuple(lower), spacing
        self.counts = tuple(max(1, math.ceil((hi - lo) / spacing - 1e-9)) for lo, hi in zip(lower, upper))

    def node(self, index):
        return tuple(lo + (i + 0.5) * self.spacing for lo, i in zip(self.lower, index))

    def corners(self, point):
        """[(node index, trilinear weight)] with the point clamped to the node centres, as a clamped texture."""
        axes = []
        for lo, n, p in zip(self.lower, self.counts, point):
            f = min(max((p - lo) / self.spacing - 0.5, 0.0), n - 1.0)
            i = min(int(math.floor(f)), n - 2) if n > 1 else 0
            t = f - i if n > 1 else 0.0
            axes.append(((i, 1 - t), (i + 1, t)) if n > 1 else ((0, 1.0),))
        result = []
        for ix, wx in axes[0]:
            for iy, wy in axes[1]:
                for iz, wz in axes[2]:
                    if wx * wy * wz > 0:
                        result.append(((ix, iy, iz), wx * wy * wz))
        return result


def bin_sums(directions, values, size):
    """Per-bin sums of values over the fixed direction set."""
    sums = [0.0] * (size * size)
    for d, v in zip(directions, values):
        sums[octahedral_bin(d, size)] += v
    return sums


def corrected_ratio(corners, traced, boxed, valid, fallback=1.0):
    """Per-bin ratio sum w T / sum w B over the valid corners; fallback where no valid corner has box exit."""
    bins = len(next(iter(traced.values())))
    usable = [(key, w) for key, w in corners if valid[key]]
    ratio = []
    for b in range(bins):
        t = sum(w * traced[key][b] for key, w in usable)
        box = sum(w * boxed[key][b] for key, w in usable)
        ratio.append(t / box if box > 1e-9 else fallback)
    return ratio


def horizon_elevation(horizon, azimuth):
    """Horizon (degrees) at an azimuth (radians), linear between the K bins centred at 2 pi k / K."""
    count = len(horizon)
    t = (azimuth / (2 * math.pi) * count) % count
    k = int(math.floor(t)) % count
    f = t - math.floor(t)
    return (1 - f) * horizon[k] + f * horizon[(k + 1) % count]


def horizon_visible(directions, horizons):
    """Per row: 1 where the direction rises above its row's horizon (degrees, (N, K)), else 0."""
    d = np.asarray(directions, dtype=np.float64)
    h = np.asarray(horizons, dtype=np.float64)
    count = h.shape[1]
    t = np.mod(np.arctan2(d[:, 1], d[:, 0]) / (2 * math.pi) * count, count)
    k = np.floor(t).astype(int) % count
    f = t - np.floor(t)
    rows = np.arange(len(d))
    limit = (1 - f) * h[rows, k] + f * h[rows, (k + 1) % count]
    elevation = np.degrees(np.arcsin(np.clip(d[:, 2] / np.linalg.norm(d, axis=1), -1, 1)))
    return (elevation > limit).astype(np.float64)


def interpolate_horizon(corners, horizons):
    """Bilinear mix of the corners' horizons, skipping corners without one; None if none has one."""
    usable = [(key, w) for key, w in corners if horizons.get(key) is not None]
    total = sum(w for _, w in usable)
    if total <= 0:
        return None
    count = len(horizons[usable[0][0]])
    return [sum(w * horizons[key][k] for key, w in usable) / total for k in range(count)]
