"""CPU versions of the plunge's bump (src/components/3d/waterEffects.ts WATER_BUMP_GLSL) and of the
edge measure used by summarize_water_bump.py. NumPy only.

fbm() mirrors FBM_GLSL in src/components/3d/noiseColor.ts (Blender's Perlin noise and normalized
FBM, without the pixel footprint fade); test_water_bump.py checks it against
e2e/fixtures/blender-noise.json.
"""
import numpy as np

U = np.uint32
BUMP = {'scale': 55.0, 'detail': 2.0, 'roughness': 0.5, 'lacunarity': 2.0, 'distance': 0.0006, 'strength': 0.08}
STEP = 0.0004


def _rot(x, k):
    return ((x << U(k)) | (x >> U(32 - k))).astype(U)


def _hash(kx, ky, kz):
    with np.errstate(over='ignore'):
        a = np.full(kx.shape, U(0xDEADBEEF + 25), U)
        b, c = a.copy(), a.copy()
        c = c + kz.astype(np.int64).astype(U)
        b = b + ky.astype(np.int64).astype(U)
        a = a + kx.astype(np.int64).astype(U)
        c ^= b; c -= _rot(b, 14); a ^= c; a -= _rot(c, 11)  # noqa: E702
        b ^= a; b -= _rot(a, 25); c ^= b; c -= _rot(b, 16)  # noqa: E702
        a ^= c; a -= _rot(c, 4); b ^= a; b -= _rot(a, 14)  # noqa: E702
        c ^= b; c -= _rot(b, 24)  # noqa: E702
    return c


def _grad(cx, cy, cz, x, y, z):
    h = _hash(cx, cy, cz) & U(15)
    u = np.where(h < 8, x, y)
    v = np.where(h < 4, y, np.where((h == 12) | (h == 14), x, z))
    return np.where(h & 1, -u, u) + np.where(h & 2, -v, v)


def perlin(p):
    """Blender's signed 3D Perlin noise at points p (..., 3)."""
    floor = np.floor(p)
    c = floor.astype(np.int64)
    f = p - floor
    w = f * f * f * (f * (f * 6 - 15) + 10)

    def g(i, j, k):
        return _grad(c[..., 0] + i, c[..., 1] + j, c[..., 2] + k, f[..., 0] - i, f[..., 1] - j, f[..., 2] - k)

    def lerp(a, b, t):
        return a + (b - a) * t

    x00 = lerp(g(0, 0, 0), g(1, 0, 0), w[..., 0])
    x10 = lerp(g(0, 1, 0), g(1, 1, 0), w[..., 0])
    x01 = lerp(g(0, 0, 1), g(1, 0, 1), w[..., 0])
    x11 = lerp(g(0, 1, 1), g(1, 1, 1), w[..., 0])
    return 0.982 * lerp(lerp(x00, x10, w[..., 1]), lerp(x01, x11, w[..., 1]), w[..., 2])


def fbm(p, detail, roughness, lacunarity):
    """Blender's normalized FBM (the Noise Texture's Fac) at noise-space points p."""
    fscale, amp, maxamp, total = 1.0, 1.0, 0.0, 0.0
    octaves = int(np.floor(detail))
    for _ in range(octaves + 1):
        total = total + perlin(p * fscale) * amp
        maxamp += amp
        amp *= roughness
        fscale *= lacunarity
    rmd = detail - octaves
    if rmd:
        more = total + perlin(p * fscale) * amp
        return (1 - rmd) * (0.5 * total / maxamp + 0.5) + rmd * (0.5 * more / (maxamp + amp) + 0.5)
    return 0.5 * total / maxamp + 0.5


def bump_slopes(x, y, z):
    """|tan| of the bumped normal from straight up at Blender points (x, y, z), as WATER_BUMP_GLSL
    (forward differences of STEP, a level surface)."""

    def height(dx, dy):
        p = np.stack([x + dx, y + dy, z], -1) * BUMP['scale']
        return fbm(p, BUMP['detail'], BUMP['roughness'], BUMP['lacunarity'])

    h = height(0, 0)
    gradient = np.hypot(height(STEP, 0) - h, height(0, STEP) - h) / STEP
    tilt = np.arctan(BUMP['distance'] * gradient)
    s = BUMP['strength']
    return s * np.sin(tilt) / (1 - s + s * np.cos(tilt))


def edge_roughness(luma, threshold=150, sigma=5):
    """Pixels where the bright mask differs from its Gaussian-smoothed self, per pixel of its edge.
    A relative measure: a smooth disk of radius 40 px scores about 0.3, frayed outlines more."""
    from scipy import ndimage

    mask = ndimage.binary_opening(luma > threshold, iterations=1)
    smooth = ndimage.gaussian_filter(mask.astype(float), sigma) > 0.5
    edge = mask ^ ndimage.binary_erosion(mask)
    return float((mask ^ smooth).sum() / max(edge.sum(), 1))
