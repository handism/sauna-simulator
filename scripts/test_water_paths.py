"""Physical and boundary checks for the water-path diagnostic, without Blender."""
import math
import unittest
from diagnose_water_paths import box_exit, classify, refract, IOR


class WaterPathsTest(unittest.TestCase):
    def test_normal_incidence(self):
        self.assertEqual(refract((0, 0, -1), (0, 0, 1), 1 / IOR), (0, 0, -1))

    def test_snell_and_unit_length(self):
        direction = refract((0.6, 0, -0.8), (0, 0, 1), 1 / IOR)
        self.assertAlmostEqual(direction[0] * IOR, 0.6)
        self.assertAlmostEqual(sum(x * x for x in direction), 1)

    def test_critical_angle(self):
        critical = math.asin(1 / IOR)
        for offset, tir in [(-0.001, False), (0.001, True)]:
            angle = critical + offset
            result = refract((math.sin(angle), 0, -math.cos(angle)), (0, 0, 1), IOR)
            self.assertEqual(result is None, tir)

    def test_bottom_and_parallel_axes(self):
        self.assertEqual(box_exit((0, 0, 0), (0, 0, -1), (-1, -1, -1), (1, 1, 1)), (1, (0, 0, -1)))
        self.assertEqual(classify((0, 0, -1), (0, 0, -1)), 'bottom')

    def test_nearest_side(self):
        distance, normal = box_exit((0.9, 0, 0), (0.6, 0, -0.8), (-1, -1, -1), (1, 1, 1))
        self.assertAlmostEqual(distance, 1 / 6)
        self.assertEqual(normal, (1, 0, 0))
        self.assertEqual(classify((0.6, 0, -0.8), normal), 'side_tir')
        self.assertEqual(classify((1, 0, 0), normal), 'side_transmit')

    def test_outside_origin_is_not_an_exit(self):
        self.assertIsNone(box_exit((2, 0, 0), (-1, 0, 0), (-1, -1, -1), (1, 1, 1)))

    def test_top_entry_does_not_exit_at_zero(self):
        self.assertEqual(box_exit((0, 0, 1), (0, 0, -1), (-1, -1, -1), (1, 1, 1)), (2, (0, 0, -1)))


if __name__ == '__main__':
    unittest.main()
