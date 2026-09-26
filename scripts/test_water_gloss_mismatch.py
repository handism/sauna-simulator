import math
import unittest

import numpy as np

from diagnose_water_gloss_mismatch import SINGLE, VARIANTS
from diagnose_water_shading_normals import barycentric
from summarize_water_gloss_mismatch import exit_estimate
from water_capture_radiance import equirect_directions


class BarycentricTest(unittest.TestCase):
    def test_vertices_and_centroid(self):
        a, b, c = np.array([0.0, 0, 0]), np.array([2.0, 0, 0]), np.array([0.0, 1, 0])
        for point, expected in ((a, (1, 0, 0)), (b, (0, 1, 0)), (c, (0, 0, 1)), ((a + b + c) / 3, (1 / 3,) * 3)):
            np.testing.assert_allclose(barycentric(point, a, b, c), expected, atol=1e-12)

    def test_interpolates_corner_normals_like_a_smooth_strip(self):
        # A side strip whose top corners lean 45 degrees up and bottom corners 45 degrees down
        # (as the source water): the normal is horizontal only halfway down.
        a, b, c = np.array([0.0, 0, 1]), np.array([1.0, 0, 1]), np.array([0.0, 0, 0])
        s = math.sqrt(0.5)
        normals = [np.array([0, -s, s]), np.array([0, -s, s]), np.array([0, -s, -s])]
        for z, lean in ((0.5, 0.0), (0.75, 26.565), (1.0, 45.0)):
            weights = barycentric(np.array([0.2, 0, z]), a, b, c)
            n = sum(w * m for w, m in zip(weights, normals))
            n /= np.linalg.norm(n)
            self.assertAlmostEqual(math.degrees(math.atan2(n[2], -n[1])), lean, places=2)


class VariantsTest(unittest.TestCase):
    def test_model_combines_every_single_change(self):
        self.assertEqual(VARIANTS['base'], [])
        self.assertEqual(sorted(VARIANTS['model']), sorted(SINGLE))
        for name in SINGLE:
            self.assertEqual(VARIANTS[name], [name])


class ExitEstimateTest(unittest.TestCase):
    def test_constant_capture_returns_the_mean_weight(self):
        image = np.ones((16, 32, 3)) * 2.0
        terminals = [{'origin': [0.0, 0, 0], 'direction': [0.0, 0, 1], 'weight': 0.25},
                     {'origin': [0.0, 0, 0], 'direction': [1.0, 0, 0], 'weight': 0.5}]
        boxes = [[(-1, -1, -1), (1, 1, 1)]]
        np.testing.assert_allclose(exit_estimate(terminals, 4, image, (0, 0, 0), boxes), [0.375] * 3)
        np.testing.assert_allclose(exit_estimate([], 4, image, (0, 0, 0), boxes), [0, 0, 0])

    def test_lookup_follows_the_box_projection(self):
        # Radiance = z of the texel direction; a ray from beside the probe straight up
        # lands on the box top over its origin, not straight above the probe.
        height, width = 256, 512
        image = np.repeat(equirect_directions(height, width)[..., 2:3], 3, axis=-1)
        terminal = {'origin': [0.5, 0, 0], 'direction': [0.0, 0, 1], 'weight': 1.0}
        value = exit_estimate([terminal], 1, image, (0, 0, 0), [[(-1, -1, -1), (1, 1, 0.5)]])[0]
        self.assertAlmostEqual(value, 1 / math.sqrt(2), places=2)


if __name__ == '__main__':
    unittest.main()
