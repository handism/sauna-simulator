import math
import unittest

import numpy as np

from diagnose_water_floor_disk import (
    CAMERA,
    FLOOR,
    LIGHTS,
    disk_points,
    exact_direction,
    exact_integral,
    newton_direction,
    single,
    summed,
)

FILL = LIGHTS['V10 lounge dusk fill']


class WaterFloorDiskTest(unittest.TestCase):
    def test_integral_of_a_small_disk_without_water_is_the_point_light(self):
        small = (FILL[0], FILL[1], 0.05)
        p = np.array([1.0, FLOOR, -3.0])
        v = exact_direction(p, CAMERA, ior=1.0)
        exact = exact_integral(p, v, small, steps=161, ior=1.0)
        self.assertAlmostEqual(single(p, v, small, False) / exact, 1.0, delta=0.03)

    def test_newton_reaches_the_exact_direction(self):
        p = np.array([1.2, FLOOR, -2.5])
        for center, _, _ in LIGHTS.values():
            q = np.array(center)
            exact = exact_direction(p, q)
            self.assertLess(math.acos(min(1.0, newton_direction(p, q, 2) @ exact)), 1e-3)
            # Lower than the straight line.
            self.assertLess(exact[1], ((q - p) / np.linalg.norm(q - p))[1])

    def test_ring_splits_the_disk_into_equal_areas(self):
        points, _, radius, count = disk_points(FILL, 1)
        self.assertEqual(count, 7)
        ring = np.linalg.norm(points[1] - points[0])
        self.assertAlmostEqual(ring, radius * math.sqrt(4 / 7), places=9)
        # The ring's points sit where the annulus outside the center's seventh splits in half.
        inner = radius / math.sqrt(7)
        self.assertAlmostEqual(ring**2 - inner**2, radius**2 - ring**2, places=9)

    def test_the_sum_follows_the_refracted_highlight(self):
        # Where the dusk fill's highlight is strong the straight line misses much of it.
        p = np.array([2.2, FLOOR, -1.66])
        v = exact_direction(p, CAMERA)
        exact = exact_integral(p, v, FILL)
        self.assertAlmostEqual(summed(p, v, FILL) / exact, 1.0, delta=0.15)
        self.assertLess(single(p, v, FILL, False) / exact, 0.7)


if __name__ == '__main__':
    unittest.main()
