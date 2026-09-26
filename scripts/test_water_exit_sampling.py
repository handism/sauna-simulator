import math
import random
import unittest

from diagnose_water_paths import IOR
from water_exit_sampling import (UP, box_entry, exit_samples, flat_normal, hammersley, radical_inverse, water_exits,
                                 wave_normal)
from water_reflection_trace import dot, fresnel_dielectric

LOWER, UPPER = (0.0, 0.0, 0.0), (2.0, 2.0, 1.0)
BOXES = [((0.0, 0.0, 0.0), (2.0, 2.0, 1.2)), ((-5.0, -5.0, 0.0), (5.0, 5.0, 10.0))]
PROBE = (1.0, 1.0, 1.1)
NORMAL_T = 1 - ((IOR - 1) / (IOR + 1)) ** 2


class WaterExitsTest(unittest.TestCase):
    def test_vertical_ray_passes_straight(self):
        (point, direction, weight), = water_exits((1, 1, 0.5), UP, LOWER, UPPER)
        self.assertEqual(point, (1, 1, 1.0))
        self.assertAlmostEqual(direction[2], 1.0)
        self.assertAlmostEqual(weight, NORMAL_T, places=9)

    def test_snell_fresnel_and_the_reflected_branch(self):
        theta = math.radians(30)
        d = (math.sin(theta), 0.0, math.cos(theta))
        exits = water_exits((0.2, 1, 0.9), d, LOWER, UPPER)
        _, out, weight = exits[0]
        self.assertAlmostEqual(out[0], IOR * math.sin(theta), places=9)
        f = fresnel_dielectric(math.cos(theta), IOR)
        self.assertAlmostEqual(weight, 1 - f, places=12)
        # The reflected part loses 98 % at the bottom and is dropped below 1e-3.
        self.assertEqual(len(exits), 1)

    def test_total_reflection_at_a_side_then_the_top(self):
        # Beyond the critical angle at the +x side, then 30 degrees from vertical at the top.
        d = (math.sin(math.radians(30)), 0.0, math.cos(math.radians(30)))
        exits = water_exits((1.9, 1, 0.2), d, LOWER, UPPER)
        self.assertGreater(len(exits), 0)
        _, out, weight = exits[0]
        self.assertLess(out[0], 0)  # mirrored by the side
        self.assertAlmostEqual(weight, 1 - fresnel_dielectric(math.cos(math.radians(30)), IOR), places=9)

    def test_total_reflection_at_the_top_brings_nothing_until_it_returns(self):
        theta = math.radians(60)  # beyond the critical angle of 48.6 degrees
        exits = water_exits((0.05, 1, 0.95), (math.sin(theta), 0, math.cos(theta)), LOWER, UPPER, max_events=1)
        self.assertEqual(exits, [])

    def test_side_transmission_is_lost(self):
        # Nearly normal to the +x side: almost everything leaves through it and nothing reaches the top.
        exits = water_exits((1.5, 1, 0.5), (1.0, 0.0, 0.0), LOWER, UPPER)
        self.assertEqual(exits, [])

    def test_entry_from_below_the_bottom(self):
        entered = water_exits((1, 1, -0.01), UP, LOWER, UPPER)
        (_, direction, weight), = entered
        self.assertAlmostEqual(direction[2], 1.0)
        self.assertAlmostEqual(weight, NORMAL_T * NORMAL_T, places=9)
        self.assertIsNone(box_entry((1, 1, -0.01), (0, 0, -1), LOWER, UPPER))
        self.assertEqual(box_entry((1, 1, -0.01), UP, LOWER, UPPER)[1], (0, 0, -1))
        self.assertEqual(box_entry((-0.1, 1, 0.5), (1, 0, 0), LOWER, UPPER)[1], (-1, 0, 0))

    def test_tilted_top_changes_the_refraction(self):
        tilted = lambda x, y: (math.sin(0.1), 0.0, math.cos(0.1))
        (_, flat, _), = water_exits((1, 1, 0.5), UP, LOWER, UPPER, flat_normal, max_events=1)
        (_, wave, _), = water_exits((1, 1, 0.5), UP, LOWER, UPPER, tilted, max_events=1)
        self.assertLess(wave[0], -1e-3)  # bends away from the normal, towards -x
        self.assertAlmostEqual(flat[0], 0.0)

    def test_wave_normal_is_unit_and_nearly_up(self):
        for x, y in ((0.0, 1.0), (1.18, 3.99), (2.5, 4.0), (1.2, 3.9)):
            n = wave_normal(x, y)
            self.assertAlmostEqual(dot(n, n), 1.0, places=12)
            self.assertGreater(n[2], 0.95)


class ExitSamplesTest(unittest.TestCase):
    def test_smooth_floor_reflects_one_vertical_sample(self):
        samples = exit_samples((1, 1, 0.5), UP, UP, 1e-6, 0.04, [(0.3, 0.7)], LOWER, UPPER, PROBE, BOXES)
        weight, lookup = samples[0]
        self.assertAlmostEqual(weight, 0.04 * NORMAL_T, places=6)
        self.assertAlmostEqual(lookup[2], 1.0, places=6)  # the box top straight above the probe

    def test_surface_facing_down_brings_only_the_bottom_reflection(self):
        down = (0.0, 0.0, -1.0)
        samples = exit_samples((1, 1, 0.5), down, down, 0.01, 0.04, hammersley(16), LOWER, UPPER, PROBE, BOXES)
        self.assertEqual(len(samples), 16)
        bottom = (1 - NORMAL_T) * NORMAL_T  # reflected by the bottom, then through the top
        for weight, _ in samples:
            self.assertLess(weight, 0.05 * bottom)

    def test_endpoint_above_level_is_not_refracted(self):
        samples = exit_samples((1, 1, 1.05), UP, UP, 1e-6, 0.04, [(0.3, 0.7)], LOWER, UPPER, PROBE, BOXES)
        self.assertAlmostEqual(samples[0][0], 0.04, places=6)


class HammersleyTest(unittest.TestCase):
    def test_radical_inverse(self):
        self.assertEqual([radical_inverse(i) for i in range(5)], [0.0, 0.5, 0.25, 0.75, 0.125])

    def test_points_are_stratified_after_rotation(self):
        shift = (random.Random(3).random(), random.Random(4).random())
        for count in (1, 2, 8, 64):
            points = hammersley(count, shift)
            self.assertEqual(len(points), count)
            self.assertEqual(sorted(int(u * count) for u, _ in points), list(range(count)))
            self.assertEqual(sorted(int(v * count) for _, v in points), list(range(count)))


if __name__ == '__main__':
    unittest.main()
