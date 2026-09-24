"""Fit the waves of the source plunge surface for src/components/3d/waterEffects.ts (WAVES).

Two steps, like fit_blender_agx.py:
  Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/fit_water_waves.py -- <heights.npz>
      samples the top of `V4 rippled spring water volume` on a 1 cm grid with downward rays
      (Blender meters, z up; the blend is not saved).
  python3 scripts/fit_water_waves.py <heights.npz>
      fits rings around the spout plus one plane wave (NumPy, SciPy) and prints the constants in
      glTF axes (x, −y) with R² and the residual.
The npz stays out of Git.
"""
import sys

WATER = 'V4 rippled spring water volume'


def sample(out):
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    obj = bpy.data.objects[WATER]
    tree = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
    world = obj.matrix_world
    local = world.inverted()
    normal = world.to_3x3().inverted().transposed()
    xs = np.linspace(-0.155, 2.515, 267)
    ys = np.linspace(0.905, 4.095, 319)
    heights = np.full((len(ys), len(xs)), np.nan)
    down = (local.to_3x3() @ Vector((0, 0, -1))).normalized()
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            hit, n, _, _ = tree.ray_cast(local @ Vector((x, y, 1.5)), down)
            if hit is not None and (normal @ n).normalized().z > 0.5:
                heights[j, i] = (world @ hit).z
    np.savez(out, heights=heights, xs=xs, ys=ys)
    print('WATER_HEIGHTS', out, np.nanmean(heights), flush=True)


def fit(path):
    import numpy as np
    from scipy.optimize import least_squares

    data = np.load(path)
    grid_x, grid_y = np.meshgrid(data['xs'], data['ys'])
    valid = ~np.isnan(data['heights'])
    x, y, h = grid_x[valid], grid_y[valid], data['heights'][valid]

    def model(p):
        cx, cy, a, decay, k, phase, b, kx, ky, q, level = p
        r = np.hypot(x - cx, y - cy)
        return level + a * np.exp(-decay * r) * np.sin(k * r + phase) + b * np.sin(kx * x + ky * y + q)

    # The rings are centered near the spout; the plane wave's vector comes from the residual's spectrum.
    best = min(
        (least_squares(lambda p: model(p) - h, [1.18, 3.99, -0.0057, 1.7, 34, 3.12, 0.0006, 15, 9.8, q, 0.765])
         for q in np.linspace(0, 6, 7)),
        key=lambda r: r.cost,
    )
    p = best.x
    residual = model(p) - h
    print('level', round(p[10], 5), 'mean', round(h.mean(), 5))
    print('rings center (glTF x, z)', round(p[0], 4), round(-p[1], 4))
    # a·sin(kr + φ) with φ ≈ π is −a·sin(kr).
    print('rings amplitude', round(-p[2] if abs(p[5] - np.pi) < 0.1 else p[2], 6), 'decay', round(p[3], 4),
          'number', round(p[4], 3), 'phase', round(p[5], 4))
    print('plane amplitude', round(p[6], 8), 'vector (glTF x, z)', round(p[7], 3), round(-p[8], 3), 'phase', round(p[9] % (2 * np.pi), 4))
    print('R2', round(1 - residual.var() / h.var(), 4), 'residual rms (m)', residual.std())


if __name__ == '__main__':
    if '--' in sys.argv:
        sample(sys.argv[sys.argv.index('--') + 1])
    else:
        fit(sys.argv[1])
