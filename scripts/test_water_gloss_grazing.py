"""The folding and the disk widening of diagnose_water_gloss_grazing.py."""
import math
import unittest

import numpy as np

from diagnose_water_floor_disk import ALPHA, WIDENING, exact_direction, ggx
from diagnose_water_gloss_grazing import BOX, LIGHTS, FILL, aniso_ggx, fold, image_integral, image_point


class GrazingTests(unittest.TestCase):
    def test_fold_mirrors_in_the_side_away_from_the_light(self):
        p, v = np.array([1.0, 0.202, -2.5]), np.array([0.3, 0.9, -0.2])
        image, view, planes = fold(p, v, np.array(LIGHTS[FILL][0]), [0])
        # The fill is at +x, so the image lies behind the low x side.
        self.assertAlmostEqual(image[0], 2 * BOX[0] - 1.0)
        self.assertEqual(planes, {0: BOX[0]})
        np.testing.assert_allclose(view, [-0.3, 0.9, -0.2])
        np.testing.assert_allclose(image[1:], p[1:])

    def test_widening_is_round_where_the_light_meets_the_half_vector(self):
        # Mirror directions about the normal, straight up: l·h = 1, both widenings agree.
        l = np.array([0.0, 1.0, 0.0])
        for spread in (0.0, 0.1, 0.3):
            round_ = float(ggx(l[None], l, math.sqrt(ALPHA ** 2 + WIDENING * spread ** 2))[0])
            self.assertAlmostEqual(aniso_ggx(l, l, ALPHA, spread), round_, delta=1e-9 * round_)

    def test_grazing_widening_lowers_the_peak_and_keeps_a_tiny_disk(self):
        l = np.array([math.sin(1.25), math.cos(1.25), 0.0])
        v = np.array([-l[0], l[1], 0.0])
        peak = lambda spread: float(ggx(l[None], v, math.sqrt(ALPHA ** 2 + WIDENING * spread ** 2))[0])
        self.assertLess(aniso_ggx(l, v, ALPHA, 0.14), 0.6 * peak(0.14))
        self.assertAlmostEqual(aniso_ggx(l, v, ALPHA, 1e-5), float(ggx(l[None], v, ALPHA)[0]), delta=1e-6 * peak(0))

    def test_point_estimate_follows_the_integral_along_the_image(self):
        # The floor point of the evening crops with the most image gloss, seen along the mirror of its
        # image's path to the fill (a 72° path).
        p = np.array([-0.13, 0.202, -1.97])
        center = np.array(LIGHTS[FILL][0])
        image, _, _ = fold(p, np.zeros(3), center, [0])
        c = exact_direction(image, center)
        v = np.array([c[0], c[1], -c[2]])
        exact = image_integral(p, v, LIGHTS[FILL], [0], steps=161)
        self.assertGreater(exact, 0)
        self.assertEqual(image_integral(p, v, LIGHTS[FILL], [2]), 0.0)
        for method, low, high in (('aniso', 0.75, 1.0), ('round', 1.6, 2.0)):
            ratio = image_point(p, v, LIGHTS[FILL], [0], method) / exact
            self.assertGreater(ratio, low, method)
            self.assertLess(ratio, high, method)

if __name__ == '__main__':
    unittest.main()
