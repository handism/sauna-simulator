import math
import unittest

from water_gloss import BOTTOM, IOR, LEVEL, exact_exit, product_exit, run


class WaterGlossTest(unittest.TestCase):
    def test_run_follows_snell_in_the_gap_and_the_water(self):
        sine = 0.8
        water = sine / IOR
        expected = (BOTTOM - 0.202) * sine / 0.6 + (LEVEL - BOTTOM) * water / math.sqrt(1 - water * water)
        self.assertAlmostEqual(run(0.202, sine), expected, places=12)
        self.assertEqual(run(0.202, 0.0), 0.0)
        # Steeper in the water than the straight line.
        self.assertLess(run(0.202, sine), (LEVEL - 0.202) * sine / 0.6)

    def test_exact_exit_leaves_along_a_line_through_the_light(self):
        floor, light = (1.2, 2.5, 0.202), (5.9, -1.4, 2.8)
        q = exact_exit(floor, light)
        self.assertAlmostEqual(q[2], LEVEL)
        # The air direction below equals the one from the exit to the light (parallel faces).
        h = math.hypot(q[0] - floor[0], q[1] - floor[1])
        sine = math.hypot(light[0] - q[0], light[1] - q[1]) / math.dist(light, q)
        self.assertAlmostEqual(run(floor[2], sine), h, places=9)

    def test_product_exit_falls_short_of_the_exact_one(self):
        floor, light = (1.2, 2.5, 0.202), (5.9, -1.4, 2.8)
        approx, exact = product_exit(floor, light), exact_exit(floor, light)
        # The straight line is steeper than the path's air direction, so its run is shorter.
        self.assertLess(math.dist(approx, floor), math.dist(exact, floor))
        self.assertLess(math.dist(approx, exact), 0.2)

    def test_straight_up_stays_above_the_floor(self):
        self.assertEqual(product_exit((1.0, 2.0, 0.2), (1.0, 2.0, 3.0)), (1.0, 2.0, LEVEL))
        self.assertEqual(exact_exit((1.0, 2.0, 0.2), (1.0, 2.0, 3.0)), (1.0, 2.0, LEVEL))


if __name__ == '__main__':
    unittest.main()
