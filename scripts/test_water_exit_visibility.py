import math
import unittest

import numpy as np

from water_exit_visibility import (Grid, bin_sums, corrected_ratio, fibonacci_sphere, horizon_elevation, horizon_visible,
                                   interpolate_horizon, octahedral_bin, octahedral_bins)
from water_reflection_trace import dot


class DirectionsTest(unittest.TestCase):
    def test_fibonacci_directions_are_unit_and_balanced(self):
        directions = fibonacci_sphere(2048)
        for d in directions:
            self.assertAlmostEqual(dot(d, d), 1.0, places=12)
        mean = np.mean(directions, axis=0)
        self.assertLess(np.abs(mean).max(), 1e-3)
        # Even in area: a cap of height h holds a share h / 2.
        self.assertAlmostEqual(sum(d[2] > 0.5 for d in directions) / 2048, 0.25, places=2)

    def test_octahedral_bins_cover_the_sphere_evenly(self):
        directions = fibonacci_sphere(4096)
        for size in (1, 2, 4, 8):
            counts = np.bincount([octahedral_bin(d, size) for d in directions], minlength=size * size)
            self.assertEqual(len(counts), size * size)
            self.assertTrue((counts > 0).all())
        # A 2 x 2 map splits by the signs of x and y (both hemispheres fold onto the same quadrant).
        self.assertEqual(octahedral_bin((0.3, 0.4, 0.8), 2), octahedral_bin((0.3, 0.4, -0.8), 2))
        self.assertNotEqual(octahedral_bin((0.3, 0.4, 0.8), 2), octahedral_bin((-0.3, 0.4, 0.8), 2))
        # Up and down are the centre and the corners.
        self.assertEqual(octahedral_bin((0, 0, 1), 3), 4)
        self.assertIn(octahedral_bin((1e-9, 1e-9, -1), 3), (0, 2, 6, 8))

    def test_vectorised_bins_match(self):
        directions = fibonacci_sphere(1000) + [(0.6, -0.8, 0.0), (-0.2, 0.3, -0.9)]
        for size in (1, 2, 4, 8):
            self.assertEqual(list(octahedral_bins(directions, size)), [octahedral_bin(d, size) for d in directions])

    def test_bin_sums(self):
        directions = [(0, 0, 1), (0, 0, -1), (0.5, 0.5, math.sqrt(0.5))]
        self.assertEqual(bin_sums(directions, [1, 2, 3], 1), [6])
        self.assertAlmostEqual(sum(bin_sums(directions, [1, 2, 3], 4)), 6)


class GridTest(unittest.TestCase):
    def setUp(self):
        self.grid = Grid((0, 0, 0), (1, 0.5, 0.25), 0.25)

    def test_counts_and_cell_centres(self):
        self.assertEqual(self.grid.counts, (4, 2, 1))
        self.assertEqual(self.grid.node((0, 1, 0)), (0.125, 0.375, 0.125))

    def test_trilinear_weights_reproduce_a_linear_field(self):
        field = lambda p: 2 * p[0] - p[1] + 0.3
        for point in [(0.3, 0.2, 0.1), (0.125, 0.125, 0.0), (0.6, 0.3, 0.2)]:
            corners = self.grid.corners(point)
            self.assertAlmostEqual(sum(w for _, w in corners), 1.0, places=12)
            value = sum(w * field(self.grid.node(k)) for k, w in corners)
            self.assertAlmostEqual(value, field(point), places=12)

    def test_points_outside_clamp_to_the_edge_nodes(self):
        corners = self.grid.corners((-1.0, 0.1, 5.0))
        self.assertEqual(corners, [((0, 0, 0), 1.0)])
        corners = dict(self.grid.corners((2.0, 0.25, 0.0)))
        self.assertEqual(set(corners), {(3, 0, 0), (3, 1, 0)})
        self.assertAlmostEqual(corners[(3, 0, 0)], 0.5)


class RatioTest(unittest.TestCase):
    def test_premultiplied_ratio_and_invalid_corners(self):
        corners = [('a', 0.25), ('b', 0.75)]
        traced = {'a': [1.0, 0.0], 'b': [0.2, 0.5]}
        boxed = {'a': [2.0, 0.0], 'b': [1.0, 0.0]}
        ratio = corrected_ratio(corners, traced, boxed, {'a': True, 'b': True})
        self.assertAlmostEqual(ratio[0], (0.25 + 0.15) / (0.5 + 0.75))
        # No box exit in the bin: no correction, whatever was traced.
        self.assertEqual(ratio[1], 1.0)
        # An invalid corner (inside solid geometry) is dropped, the rest renormalise.
        ratio = corrected_ratio(corners, traced, boxed, {'a': False, 'b': True})
        self.assertAlmostEqual(ratio[0], 0.2)
        self.assertEqual(corrected_ratio(corners, traced, boxed, {'a': False, 'b': False}), [1.0, 1.0])


class HorizonTest(unittest.TestCase):
    HORIZON = [10.0, 30.0, 0.0, 50.0]  # at azimuths 0, 90, 180, 270 degrees

    def test_azimuth_interpolation_wraps(self):
        self.assertAlmostEqual(horizon_elevation(self.HORIZON, 0.0), 10.0)
        self.assertAlmostEqual(horizon_elevation(self.HORIZON, math.radians(45)), 20.0)
        self.assertAlmostEqual(horizon_elevation(self.HORIZON, math.radians(315)), 30.0)
        self.assertAlmostEqual(horizon_elevation(self.HORIZON, math.radians(-45)), 30.0)

    def test_visibility_against_the_scalar_interpolation(self):
        directions = fibonacci_sphere(500)
        visible = horizon_visible(directions, [self.HORIZON] * len(directions))
        for d, v in zip(directions, visible):
            limit = horizon_elevation(self.HORIZON, math.atan2(d[1], d[0]))
            self.assertEqual(v, float(math.degrees(math.asin(d[2])) > limit))
        # Straight up is always visible, straight down never.
        self.assertEqual(list(horizon_visible([(0, 0, 1), (0, 0, -1)], [self.HORIZON] * 2)), [1.0, 0.0])

    def test_bilinear_mix_skips_missing_floor(self):
        corners = [('a', 0.5), ('b', 0.25), ('c', 0.25)]
        mixed = interpolate_horizon(corners, {'a': [0.0, 40.0], 'b': [20.0, 0.0], 'c': None})
        self.assertAlmostEqual(mixed[0], 20.0 * 0.25 / 0.75)
        self.assertAlmostEqual(mixed[1], 40.0 * 0.5 / 0.75)
        self.assertIsNone(interpolate_horizon(corners, {'a': None, 'b': None, 'c': None}))


if __name__ == '__main__':
    unittest.main()
