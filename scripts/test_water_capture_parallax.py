import math
import unittest

from water_capture_parallax import (angle_degrees, axis_box, box_lookup, compare, grid_probes, nearest,
                                    nested_box_lookup, weighted_quantile)


class GeometryTest(unittest.TestCase):
    def test_angle(self):
        self.assertAlmostEqual(angle_degrees((1, 0, 0), (0, 2, 0)), 90)
        self.assertAlmostEqual(angle_degrees((1, 1, 0), (1, 1, 0)), 0)

    def test_grid_and_nearest(self):
        probes = grid_probes((0, 0), (2, 4), 2, 2, 1.0)
        self.assertEqual(sorted(probes), [(0.5, 1, 1), (0.5, 3, 1), (1.5, 1, 1), (1.5, 3, 1)])
        self.assertEqual(nearest((1.9, 0.2, 0.8), probes), (1.5, 1, 1))

    def test_axis_box(self):
        walls = {(1, 0, 0): 2.0, (-1, 0, 0): 1.0, (0, 1, 0): 3.0, (0, -1, 0): None, (0, 0, 1): 0.5}
        lower, upper = axis_box((0, 0, 1), lambda c, d: walls[d], 0.2)
        self.assertEqual(lower, (-1, -50, 0.2))
        self.assertEqual(upper, (2, 3, 1.5))

    def test_box_lookup_matches_true_hit_on_the_box(self):
        # A room that is exactly the proxy box: the corrected lookup from the
        # probe must land on the point the segment reaches.
        box = ((-2, -2, 0), (2, 2, 2))
        center, origin = (0, 0, 1), (1.5, -1, 0.5)
        direction = (0.0, 0.6, 0.8)
        lookup = box_lookup(origin, direction, center, box)
        t = min((2 - origin[1]) / direction[1], (2 - origin[2]) / direction[2])
        target = tuple(o + d * t for o, d in zip(origin, direction))
        expected = tuple(p - c for p, c in zip(target, center))
        self.assertAlmostEqual(angle_degrees(lookup, expected), 0, places=5)
        self.assertIsNone(box_lookup((3, 0, 1), direction, center, box))

    def test_nested_boxes(self):
        # A low tub (walls up to z=1) inside a tall courtyard (walls at x=+-5).
        tub, court = ((-2, -2, 0), (2, 2, 1)), ((-5, -5, 0), (5, 5, 10))
        center, origin = (0, 0, 1.1), (0, 0, 0.5)
        # Steep ray over the tub wall reaches the courtyard wall at x=5, z=0.5+5*1.25.
        steep = (0.6246950475544243, 0, 0.7808688094430304)
        lookup = nested_box_lookup(origin, steep, center, [tub, court])
        target = (5, 0, 0.5 + 5 * steep[2] / steep[0])
        self.assertAlmostEqual(angle_degrees(lookup, tuple(p - c for p, c in zip(target, center))), 0, places=5)
        # A shallow ray stays on the tub wall, as with a single box.
        shallow = (0.98, 0, 0.19899748742132398)
        self.assertEqual(nested_box_lookup(origin, shallow, center, [tub, court]),
                         box_lookup(origin, shallow, center, tub))
        # An origin outside the tub still uses the courtyard; outside both gives None.
        self.assertIsNotNone(nested_box_lookup((3, 0, 0.5), steep, center, [tub, court]))
        self.assertIsNone(nested_box_lookup((6, 0, 0.5), steep, center, [tub, court]))

    def test_infinite_capture_error_shrinks_with_distance(self):
        # Direction-only lookup from a probe offset by b sees a wall at distance D
        # at an offset b along the wall: the angular error is about b/D.
        offset = 0.5
        for wall in (2.0, 20.0):
            error = angle_degrees((wall, 0, 0), (wall, -offset, 0))
            self.assertAlmostEqual(math.radians(error), math.atan(offset / wall))

    def test_compare(self):
        hit = {'object': 'a', 'position': (0, 0, 0)}
        self.assertTrue(compare(hit, {'object': 'a', 'position': (0.05, 0, 0)}, 0.1))
        self.assertFalse(compare(hit, {'object': 'b', 'position': (0, 0, 0)}, 0.1))
        self.assertFalse(compare(hit, None, 0.1))
        self.assertTrue(compare(None, None, 0.1))

    def test_weighted_quantile(self):
        self.assertEqual(weighted_quantile([3, 1, 2], [1, 1, 2], 0.5), 2)
        self.assertEqual(weighted_quantile([3, 1, 2], [1, 1, 2], 0.9), 3)
        self.assertIsNone(weighted_quantile([], [], 0.5))


if __name__ == '__main__':
    unittest.main()
