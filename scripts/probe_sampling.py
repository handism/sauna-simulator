"""CPU mirror of irradiance.ts probe interpolation for surface diagnostics (NumPy).

This samples the shipped float16 coefficients; it does not change or bake lighting.
Positions and normals use glTF axes. Keep grid blending and SH bands in sync with irradiance.ts.
"""
import hashlib
import json
from pathlib import Path

import numpy as np


BANDS = np.array([np.pi, *([2 * np.pi / 3] * 3), *([np.pi / 4] * 5)])


def basis(normal):
    x, y, z = normal
    return np.array([.282095, .488603 * y, .488603 * z, .488603 * x,
                     1.092548 * x * y, 1.092548 * y * z, .315392 * (3 * z * z - 1),
                     1.092548 * x * z, .546274 * (x * x - y * y)])


def evaluate(coefficients, normal):
    return np.maximum((coefficients * (basis(normal) * BANDS)[:, None]).sum(axis=0), 0)


def interpolate(values, coordinate):
    """Clamped trilinear interpolation of (z,y,x,9,3) coefficients at grid coordinates."""
    res = np.array(values.shape[:3][::-1])
    c = np.clip(coordinate, 0, res - 1)
    lower = np.floor(c).astype(int)
    upper = np.minimum(lower + 1, res - 1)
    fraction = c - lower
    result = np.zeros((9, 3))
    for z in (0, 1):
        for y in (0, 1):
            for x in (0, 1):
                bits = np.array([x, y, z])
                ix, iy, iz = np.where(bits, upper, lower)
                weight = np.prod(np.where(bits, fraction, 1 - fraction))
                result += weight * values[iz, iy, ix]
    return result


def stencil(resolution, coordinate):
    """Nonzero trilinear corners, including clamped boundaries, in xyz order."""
    res = np.asarray(resolution)
    c = np.clip(coordinate, 0, res - 1)
    lower = np.floor(c).astype(int)
    fraction = c - lower
    for z in (0, 1):
        for y in (0, 1):
            for x in (0, 1):
                bits = np.array([x, y, z])
                weight = float(np.prod(np.where(bits, fraction, 1 - fraction)))
                if weight > 0:
                    yield np.minimum(lower + bits, res - 1), weight


def fill_invalid(values, valid, res):
    """Replaces invalid probes by the mean of valid face neighbors, growing inward."""
    nx, ny, nz = res
    values = values.reshape(nz, ny, nx, -1).copy()
    valid = valid.reshape(nz, ny, nx).copy()
    rounds = 0
    while not valid.all():
        rounds += 1
        total = np.zeros_like(values)
        count = np.zeros(valid.shape)
        for axis in range(3):
            for step in (-1, 1):
                shifted = np.roll(values * valid[..., None], step, axis=axis)
                mask = np.roll(valid, step, axis=axis).astype(float)
                edge = [slice(None)] * 3
                edge[axis] = 0 if step == 1 else -1
                shifted[tuple(edge)] = 0
                mask[tuple(edge)] = 0
                total += shifted
                count += mask
        grow = ~valid & (count > 0)
        assert grow.any(), 'no valid probe in the grid'
        values[grow] = total[grow] / count[grow][:, None]
        valid |= grow
    return values.reshape(nx * ny * nz, -1), rounds


class ProbeSampler:
    def __init__(self, directory):
        directory = Path(directory)
        self.header = json.loads((directory / 'irradiance.json').read_text())
        binary = (directory / 'irradiance.bin').read_bytes()
        if hashlib.sha256(binary).hexdigest() != self.header['bin_sha256']:
            raise ValueError('irradiance binary hash does not match header')
        self.data = np.frombuffer(binary, dtype='<f2').astype(float)

    def grid(self, index, scene, position, normal, offset):
        grid = self.header['grids'][index]
        lo, hi, res = (np.array(grid[k]) for k in ('min', 'max', 'resolution'))
        count = int(np.prod(res)) * 27
        start = grid['offset'][scene]
        values = self.data[start:start + count].reshape(*res[::-1], 9, 3)
        coordinate = (position + normal * offset * (hi - lo) / (res - 1) - lo) / (hi - lo) * (res - 1)
        return evaluate(interpolate(values, coordinate), normal)

    def grid_weights(self, position):
        position = np.asarray(position)
        if np.all((position >= [-6.15, 0, -4.59]) & (position <= [-.5, 3.36, -.25])):
            return [(0, 1.)]
        grid = self.header['grids'][1]
        lo, hi = np.array(grid['min']), np.array(grid['max'])
        inside = np.minimum(position - lo, hi - position)
        smooth = lambda t: (lambda v: v * v * (3 - 2 * v))(np.clip(t, 0, 1))
        weight = smooth(min(inside[0], inside[2]) / 1.5) * (1 - smooth((position[1] - hi[1]) / 1.5))
        return [(i, float(w)) for i, w in ((1, weight), (2, 1 - weight)) if w > 0]

    def sample(self, scene, position, normal, offset=.5):
        position, normal = np.asarray(position), np.asarray(normal)
        return sum(weight * self.grid(i, scene, position, normal, offset)
                   for i, weight in self.grid_weights(position))

    def contributors(self, scene, position, normal, offset=.5):
        """Trace the shipped interpolation, retaining signed SH until each grid is clamped."""
        position, normal = np.asarray(position), np.asarray(normal)
        rows = []
        for i, grid_weight in self.grid_weights(position):
            grid = self.header['grids'][i]
            lo, hi, res = (np.array(grid[k]) for k in ('min', 'max', 'resolution'))
            spacing = (hi - lo) / (res - 1)
            coordinate = (position - lo) / spacing + normal * offset
            for index, weight in stencil(res, coordinate):
                x, y, z = index
                start = int(grid['offset'][scene] + (x + res[0] * (y + res[1] * z)) * 27)
                coefficients = self.data[start:start + 27].reshape(9, 3)
                rgb = (coefficients * (basis(normal) * BANDS)[:, None]).sum(axis=0)
                rows.append(dict(grid=grid['name'], grid_weight=grid_weight,
                                 index=index.tolist(), position=(lo + index * spacing).tolist(),
                                 weight=weight, signed_rgb=rgb.tolist()))
        return rows


# Candidate corner weights for diagnostics only (irradiance.ts does not use them).

def chebyshev(distance, mean, mean_square, power=3):
    """DDGI-style visibility from the depth moments a probe sees toward the shaded point."""
    if distance <= mean:
        return 1.
    variance = max(mean_square - mean * mean, 1e-6)
    return (variance / (variance + (distance - mean) ** 2)) ** power


def backface(probe, point, normal):
    """DDGI's wrap weight: probes behind the surface keep 0.2 of their trilinear weight."""
    direction = np.asarray(probe, float) - point
    length = np.linalg.norm(direction)
    cosine = 1. if length < 1e-9 else float(np.dot(direction / length, normal))
    return ((cosine + 1) / 2) ** 2 + .2


def reweight(rows, key, regularization=0.):
    """Per grid, sum(t*v*c + eps*t*c) / (sum(t*v) + eps), clamped like the shipped sampler.

    t is the trilinear weight, v = row[key] and eps the regularization: with a small visible
    mass the result falls back to plain trilinear interpolation instead of amplifying the few
    visible corners. Returns None when a grid has no visible mass and no regularization.
    """
    result = np.zeros(3)
    for grid in sorted({r['grid'] for r in rows}):
        subset = [r for r in rows if r['grid'] == grid]
        mass = sum(r['weight'] * r[key] for r in subset) + regularization
        if mass < 1e-8:
            return None
        value = sum(r['weight'] * (r[key] + regularization) * np.array(r['signed_rgb']) for r in subset) / mass
        result += subset[0]['grid_weight'] * np.maximum(value, 0)
    return result
