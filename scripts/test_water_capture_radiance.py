import math
import unittest

import numpy as np

from water_capture_radiance import (downsample, equirect_directions, equirect_uv, lookup, relative_error,
                                    texel_solid_angles, vmf_kappa, vmf_prefilter)


class MappingTest(unittest.TestCase):
    def test_calibrated_axes(self):
        # Cycles render of the Generated coordinate: top looks up, the left edge looks along -Y,
        # and the azimuth decreases to the right (-X a quarter of the way across).
        u, v = equirect_uv(np.array([[0, 0, 1], [0, -1, 0], [-1, 0, 0], [0, 1, 0], [1, 0, 0]], dtype=float))
        self.assertAlmostEqual(v[0], 0)
        np.testing.assert_allclose(u[1:], [0, 0.25, 0.5, 0.75], atol=1e-12)
        np.testing.assert_allclose(v[1:], 0.5)

    def test_texel_directions_round_trip(self):
        directions = equirect_directions(8, 16)
        np.testing.assert_allclose(np.linalg.norm(directions, axis=-1), 1)
        u, v = equirect_uv(directions)
        np.testing.assert_allclose(u * 16, np.broadcast_to(np.arange(16) + 0.5, (8, 16)))
        np.testing.assert_allclose(v * 8, np.broadcast_to(np.arange(8)[:, None] + 0.5, (8, 16)))

    def test_solid_angles(self):
        self.assertAlmostEqual(float(texel_solid_angles(32, 64).sum()), 4 * math.pi)


class LookupTest(unittest.TestCase):
    def test_nearest_and_bilinear_at_texel_centres(self):
        image = np.random.default_rng(1).random((8, 16, 3))
        directions = equirect_directions(8, 16)
        np.testing.assert_allclose(lookup(image, directions, bilinear=False), image)
        np.testing.assert_allclose(lookup(image, directions), image, atol=1e-9)

    def test_bilinear_wraps_in_azimuth(self):
        image = np.zeros((4, 8, 1))
        image[:, 0] = 1.0
        image[:, 7] = 3.0
        # The seam between the last and the first column (u = 0) blends both.
        seam = np.array([0.0, -1.0, 0.0])
        self.assertAlmostEqual(float(lookup(image, seam)[0]), 2.0)

    def test_downsample_keeps_the_solid_angle_mean(self):
        image = np.random.default_rng(2).random((16, 32, 3))
        small = downsample(image, 4)
        total = (image * texel_solid_angles(16, 32)[..., None]).sum(axis=(0, 1))
        np.testing.assert_allclose((small * texel_solid_angles(4, 8)[..., None]).sum(axis=(0, 1)), total)
        with self.assertRaises(ValueError):
            downsample(image, 3)


class PrefilterTest(unittest.TestCase):
    def test_constant_stays_constant(self):
        image = np.full((8, 16, 3), 0.7)
        for blurred in vmf_prefilter(image, [1.0, 50.0]):
            np.testing.assert_allclose(blurred, 0.7)

    def test_blur_spreads_a_point_and_keeps_energy(self):
        image = np.zeros((16, 32, 1))
        image[4, 10] = 1.0
        weights = texel_solid_angles(16, 32)[..., None]
        sharp, wide = vmf_prefilter(image, [400.0, 4.0])
        self.assertGreater(sharp[4, 10, 0], wide[4, 10, 0])
        self.assertGreater(wide[12, 26, 0], sharp[12, 26, 0])
        # A normalised symmetric kernel keeps the integral up to discretisation.
        self.assertAlmostEqual(float((wide * weights).sum()), float((image * weights).sum()),
                               delta=0.03 * float(weights[4, 10, 0]))

    def test_kappa(self):
        mean, kappa = vmf_kappa([[0, 0, 1], [0, 0, 1]], [1, 2])
        np.testing.assert_allclose(mean, [0, 0, 1])
        self.assertTrue(math.isinf(kappa))
        # Two directions 90 degrees apart: resultant length 1/sqrt(2).
        mean, kappa = vmf_kappa([[1, 0, 0], [0, 1, 0]], [1, 1])
        r = 1 / math.sqrt(2)
        np.testing.assert_allclose(mean, [r, r, 0])
        self.assertAlmostEqual(kappa, r * (3 - r * r) / (1 - r * r))

    def test_relative_error(self):
        self.assertAlmostEqual(relative_error([1.1, 2, 3], [1, 2, 3]), 0.1 / 6)


if __name__ == '__main__':
    unittest.main()
