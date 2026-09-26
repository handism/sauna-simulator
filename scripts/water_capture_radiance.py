"""Colour lookups in a Cycles equirectangular capture; NumPy, Blender axes (Z up).

The probe camera of diagnose_water_capture_radiance.py is Cycles' equirectangular
panorama rotated by (pi/2, 0, 0), as in bake_irradiance_probes.py. A Cycles
render of the Generated texture coordinate (2026-09-26) gives: the top row looks
up (+Z), and the azimuth atan2(y, x) is -pi/2 at the left edge and decreases to
the right. Images are indexed [row from the top, column, channel].
"""
import math

import numpy as np


def equirect_uv(direction):
    """(u, v) in [0, 1): u from the left edge, v from the top edge."""
    x, y, z = np.moveaxis(np.asarray(direction, dtype=np.float64), -1, 0)
    length = np.sqrt(x * x + y * y + z * z)
    u = np.mod((-math.pi / 2 - np.arctan2(y, x)) / (2 * math.pi), 1.0)
    v = (math.pi / 2 - np.arcsin(np.clip(z / length, -1, 1))) / math.pi
    return u, v


def equirect_directions(height, width):
    """Unit direction at every texel centre, shape (height, width, 3)."""
    u = (np.arange(width) + 0.5) / width
    v = (np.arange(height) + 0.5) / height
    azimuth = -math.pi / 2 - 2 * math.pi * u
    latitude = math.pi / 2 - math.pi * v
    cos_lat = np.cos(latitude)[:, None]
    return np.stack([cos_lat * np.cos(azimuth)[None, :], cos_lat * np.sin(azimuth)[None, :],
                     np.broadcast_to(np.sin(latitude)[:, None], (height, width))], axis=-1)


def texel_solid_angles(height, width):
    """Solid angle of each row's texels (sums to 4 pi over the image)."""
    edges = math.pi / 2 - math.pi * np.arange(height + 1) / height
    band = (np.sin(edges[:-1]) - np.sin(edges[1:])) * 2 * math.pi / width
    return np.broadcast_to(band[:, None], (height, width))


def lookup(image, direction, bilinear=True):
    """Sample an equirectangular image along directions (..., 3); wraps in azimuth."""
    height, width = image.shape[:2]
    u, v = equirect_uv(direction)
    if not bilinear:
        col = np.minimum((u * width).astype(int), width - 1)
        row = np.minimum((v * height).astype(int), height - 1)
        return image[row, col]
    x, y = u * width - 0.5, np.clip(v * height - 0.5, 0, height - 1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    y1 = np.minimum(y0 + 1, height - 1)
    x0w, x1w = np.mod(x0, width), np.mod(x0 + 1, width)
    top = image[y0, x0w] * (1 - fx) + image[y0, x1w] * fx
    bottom = image[y1, x0w] * (1 - fx) + image[y1, x1w] * fx
    return top * (1 - fy) + bottom * fy


def downsample(image, factor):
    """Box average by an integer factor: the mean radiance of each coarser texel, weighted by solid angle."""
    if factor == 1:
        return image
    height, width = image.shape[:2]
    if height % factor or width % factor:
        raise ValueError('factor must divide the image size')
    weights = texel_solid_angles(height, width)[..., None]
    shape = (height // factor, factor, width // factor, factor, -1)
    total = (image * weights).reshape(shape).sum(axis=(1, 3))
    return total / weights.reshape(shape).sum(axis=(1, 3))


def vmf_prefilter(image, kappas, chunk=512):
    """Convolve an equirectangular image with von Mises-Fisher lobes exp(kappa (cos - 1)).

    Brute force over all texel pairs; meant for small images (a few thousand texels).
    Returns one image per kappa.
    """
    height, width, channels = image.shape
    directions = equirect_directions(height, width).reshape(-1, 3)
    weights = texel_solid_angles(height, width).reshape(-1)
    source = image.reshape(-1, channels)
    results = []
    for kappa in kappas:
        out = np.empty_like(source)
        for start in range(0, len(directions), chunk):
            cosine = directions[start:start + chunk] @ directions.T
            kernel = np.exp(kappa * (cosine - 1)) * weights
            out[start:start + chunk] = kernel @ source / kernel.sum(axis=1, keepdims=True)
        results.append(out.reshape(height, width, channels))
    return results


def vmf_kappa(directions, weights):
    """Concentration of a weighted set of unit directions (Banerjee et al. 2005); inf for a single direction."""
    directions = np.asarray(directions, dtype=np.float64)
    weights = np.asarray(weights, dtype=np.float64)
    resultant = (directions * weights[:, None]).sum(axis=0)
    r = np.linalg.norm(resultant) / weights.sum()
    mean = resultant / np.linalg.norm(resultant)
    if r >= 1 - 1e-9:
        return mean, math.inf
    return mean, r * (3 - r * r) / (1 - r * r)


def relative_error(estimate, truth):
    """Sum of absolute RGB differences over the RGB sum of the truth."""
    estimate, truth = np.asarray(estimate, dtype=np.float64), np.asarray(truth, dtype=np.float64)
    return float(np.abs(estimate - truth).sum() / truth.sum())


def luminance(rgb):
    """Rec.709 luminance of scene-linear RGB."""
    return np.asarray(rgb, dtype=np.float64) @ np.array([0.2126, 0.7152, 0.0722])
