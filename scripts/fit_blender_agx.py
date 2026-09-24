"""Fit the constants of src/components/3d/agx.ts to Blender's AgX view transform.

1. Blender -b --python scripts/fit_blender_agx.py -- <samples.npz>
   Evaluates Blender's bundled OCIO config (Linear Rec.709 -> sRGB display, AgX view, look None)
   for 204,000 scene-linear colors spanning 20 stops and writes them to <samples.npz>.
2. python3 scripts/fit_blender_agx.py <samples.npz>   (requires NumPy, SciPy)
   Fits the model of agx.ts by least squares on the display values and prints the constants
   and the held-out error.

Blender 4.x forms AgX with a 57^3 LUT in a 25-stop E-Gamut log encoding; three's AgXToneMapping
is an earlier formulation that maps 18% grey to 0.50 instead of 0.46. The model keeps three's
structure: matrix, log2 over [-12.47, +4.03] stops, a per-channel curve (a 32-point table), a
matrix, power 2.4 and a matrix to linear Rec.709.
"""
import sys
import numpy as np

LO, HI, KNOTS = -12.47393, 4.026069, 32

try:
    import bpy  # noqa: F401
except ImportError:
    bpy = None

if bpy is not None:
    import PyOpenColorIO as OCIO
    out = sys.argv[sys.argv.index('--') + 1]
    config = OCIO.Config.CreateFromFile(
        str(__import__('pathlib').Path(bpy.utils.resource_path('LOCAL')) / 'datafiles/colormanagement/config.ocio'))
    processor = config.getProcessor(
        OCIO.DisplayViewTransform(src='Linear Rec.709', display='sRGB', view='AgX')).getDefaultCPUProcessor()
    rng = np.random.default_rng(0)
    n = 200_000
    luminance = 2.0 ** rng.uniform(-13, 7, n)
    # Neutral to fully saturated colors, primaries included.
    weights = rng.dirichlet([0.6, 0.6, 0.6], n) * 3
    saturation = rng.uniform(0, 1, n)[:, None] ** 0.7
    x = luminance[:, None] * ((1 - saturation) + saturation * weights)
    grey = 2.0 ** np.linspace(-14, 8, 4000)
    x = np.concatenate([x, np.stack([grey] * 3, 1)]).astype(np.float32)
    y = x.copy()
    processor.applyRGB(y)
    np.savez(out, x=x, y=y, ocio=OCIO.__version__, blender=bpy.app.version_string)
    print('AGX_SAMPLES', out, x.shape, flush=True)
    sys.exit(0)

from scipy.optimize import least_squares

data = np.load(sys.argv[1])
X, Y = data['x'].astype(np.float64), data['y'].astype(np.float64)
knots = np.linspace(0, 1, KNOTS)


def oetf(v):
    v = np.clip(v, 0, 1)
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * v ** (1 / 2.4) - 0.055)


def model(p, x):
    inset, outset, to709, curve = p[:9].reshape(3, 3), p[9:18].reshape(3, 3), p[18:27].reshape(3, 3), p[27:]
    u = np.clip((np.log2(np.maximum(x @ inset.T, 2.0 ** -24)) - LO) / (HI - LO), 0, 1)
    return oetf(np.maximum(np.interp(u, knots, curve) @ outset.T, 0) ** 2.4 @ to709.T)


def columns(*cols):
    return np.array(cols).T


# three 0.186's AgX constants as the starting point (GLSL mat3 arguments are columns).
srgb_to_2020 = columns([0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956])
rec2020_to_srgb = columns([1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187])
three_inset = columns([0.856627153315983, 0.137318972929847, 0.11189821299995],
                      [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
                      [0.0482516061458583, 0.101439036467562, 0.811302368396859])
three_outset = columns([1.1271005818144368, -0.1413297634984383, -0.14132976349843826],
                       [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
                       [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405])
sigmoid = np.polyval([15.5, -40.14, 31.96, -6.868, 0.4298, 0.1191, -0.00232], knots)
p0 = np.concatenate([(three_inset @ srgb_to_2020).ravel(), three_outset.ravel(), rec2020_to_srgb.ravel(), sigmoid])

rng = np.random.default_rng(1)
train = rng.choice(len(X), 40_000, replace=False)
test = np.setdiff1d(np.arange(len(X)), train)
# The neutral axis (the last 4,000 samples) is weighted so that greys land on Blender's curve.
weight = np.where(train >= len(X) - 4000, 4.0, 1.0)[:, None]
fit = least_squares(lambda p: (weight * (model(p, X[train]) - Y[train])).ravel(), p0, max_nfev=300, x_scale='jac')
for name, p in (('three AgX', p0), ('fit', fit.x)):
    error = np.abs(model(p, X[test]) - Y[test])
    print(f'{name}: held-out display error mean {error.mean():.5f} p99 {np.percentile(error, 99):.5f} max {error.max():.5f}')
greys = X[-4000:]
print('grey error max %.5f' % np.abs(model(fit.x, greys) - Y[-4000:]).max())
print('grey 0.18 -> %.4f, 1.0 -> %.4f' % tuple(model(fit.x, np.array([[0.18] * 3, [1.0] * 3]))[:, 0]))


def glsl_mat(m):
    # mat3( column0, column1, column2 )
    return ',\n\t\t'.join('vec3( ' + ', '.join(f'{v:.7f}' for v in m[:, i]) + ' )' for i in range(3))


inset, outset, to709, curve = fit.x[:9].reshape(3, 3), fit.x[9:18].reshape(3, 3), fit.x[18:27].reshape(3, 3), fit.x[27:]
print('INSET\n\t\t' + glsl_mat(inset))
print('OUTSET\n\t\t' + glsl_mat(outset))
print('TO_709\n\t\t' + glsl_mat(to709))
print('CURVE', ', '.join(f'{v:.6f}' for v in curve))
