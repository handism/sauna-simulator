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
