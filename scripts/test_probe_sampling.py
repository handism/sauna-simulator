"""Run: python3 -m unittest discover -s scripts -p 'test_probe_sampling.py'."""
import unittest

import numpy as np

from probe_sampling import ProbeSampler, backface, chebyshev, evaluate, fill_invalid, interpolate, reweight, stencil


class ProbeSamplingTests(unittest.TestCase):
    def test_stencil_boundaries_and_linear_reconstruction(self):
        z, y, x = np.mgrid[:4, :3, :2]
        values = np.broadcast_to((x + 10 * y + 100 * z)[..., None, None], (4, 3, 2, 9, 3))
        for coordinate in ([.25, 1.5, 2.25], [-5, 5, 10], [1, 2, 3]):
            corners = list(stencil([2, 3, 4], coordinate))
            self.assertAlmostEqual(sum(w for _, w in corners), 1)
            self.assertEqual(len({tuple(i) for i, _ in corners}), len(corners))
            reconstructed = sum(w * values[i[2], i[1], i[0]] for i, w in corners)
            np.testing.assert_allclose(reconstructed, interpolate(values, coordinate))

    def test_contributors_reconstruct_shipped_sampling(self):
        sampler = ProbeSampler('public/models')
        # Includes room, courtyard, both-grid transition, clamped outer grid and the water wall.
        for scene in ('day', 'evening'):
            for p in ([-3, 1, -2], [0, -.2, 0], [8.25, 1, 0], [40, 15, 40], [2.5, .4, -1]):
                for n in ([0, 1, 0], [0, -1, 0], [1, 0, 0]):
                    rows = sampler.contributors(scene, p, n)
                    rgb = np.zeros(3)
                    for grid in {r['grid'] for r in rows}:
                        group = [r for r in rows if r['grid'] == grid]
                        self.assertAlmostEqual(sum(r['weight'] for r in group), 1)
                        signed = sum(r['weight'] * np.array(r['signed_rgb']) for r in group)
                        rgb += group[0]['grid_weight'] * np.maximum(signed, 0)
                    np.testing.assert_allclose(rgb, sampler.sample(scene, p, n), atol=1e-12)

    def test_constant_radiance_integrates_to_pi(self):
        coefficients = np.zeros((9, 3))
        coefficients[0] = np.array([1, 2, 3]) / .282095
        for n in ([1, 0, 0], [0, 1, 0], [0, 0, -1]):
            np.testing.assert_allclose(evaluate(coefficients, n), np.pi * np.array([1, 2, 3]))

    def test_linear_field_and_boundary_clamping(self):
        z, y, x = np.mgrid[:4, :3, :2]
        values = np.broadcast_to((x + 10 * y + 100 * z)[..., None, None], (4, 3, 2, 9, 3))
        np.testing.assert_allclose(interpolate(values, [.25, 1.5, 2.25]), 240.25)
        np.testing.assert_allclose(interpolate(values, [-5, 5, 10]), 320)

    def test_normal_changes_directional_band_sign(self):
        coefficients = np.zeros((9, 3))
        coefficients[0] = 20
        coefficients[1] = 1
        self.assertGreater(evaluate(coefficients, [0, 1, 0])[0], evaluate(coefficients, [0, -1, 0])[0])

    def test_surface_bias_uses_half_spacing_and_keeps_evaluation_normal(self):
        sampler = ProbeSampler.__new__(ProbeSampler)
        sampler.header = {'grids': [{'min': [0, 0, 0], 'max': [2, 4, 6],
                                    'resolution': [2, 2, 2], 'offset': {'day': 0}}]}
        z, y, x = np.mgrid[:2, :2, :2]
        values = np.zeros((2, 2, 2, 9, 3))
        values[..., 0, :] = (1 + y)[..., None] / (.282095 * np.pi)
        sampler.data = values.ravel()
        p, n = np.array([1., 0., 3.]), np.array([0., 1., 0.])
        np.testing.assert_allclose(sampler.grid(0, 'day', p, n, 0), 1)
        np.testing.assert_allclose(sampler.grid(0, 'day', p, n, .5), 1.5)

    def test_room_selection_and_outer_transition(self):
        sampler = ProbeSampler('public/models')
        sampler.grid = lambda index, *_: np.full(3, index + 1.)
        np.testing.assert_allclose(sampler.sample('day', [-3, 1, -2], [0, 1, 0]), 1)
        np.testing.assert_allclose(sampler.sample('day', [0, 1, 0], [0, 1, 0]), 2)
        np.testing.assert_allclose(sampler.sample('day', [30, 1, 0], [0, 1, 0]), 3)
        np.testing.assert_allclose(sampler.sample('day', [8.25, 1, 0], [0, 1, 0]), 2.5)
        # Below the plunge surface only (the tiles lie on the water volume's faces).
        np.testing.assert_allclose(sampler.sample('day', [1.18, .215, -2.5], [0, 1, 0]), 4)
        np.testing.assert_allclose(sampler.sample('day', [1.18, .9, -2.5], [0, 1, 0]), 2)

    def test_chebyshev_is_one_in_front_and_falls_off_behind(self):
        self.assertEqual(chebyshev(.5, 1., 1.1), 1)
        self.assertEqual(chebyshev(1., 1., 1.1), 1)
        near, far = chebyshev(1.2, 1., 1.01), chebyshev(2., 1., 1.01)
        self.assertGreater(1, near)
        self.assertGreater(near, far)
        self.assertAlmostEqual(chebyshev(2., 1., 1.01, power=1), .01 / 1.01)

    def test_backface_weight_range(self):
        n = np.array([0., 1, 0])
        self.assertAlmostEqual(backface([0, 2, 0], np.zeros(3), n), 1.2)
        self.assertAlmostEqual(backface([0, -2, 0], np.zeros(3), n), .2)
        self.assertAlmostEqual(backface([2, 0, 0], np.zeros(3), n), .45)
        self.assertAlmostEqual(backface(np.zeros(3), np.zeros(3), n), 1.2)

    def test_reweight_regularization_falls_back_to_trilinear(self):
        rows = [dict(grid='g', grid_weight=1., weight=.999, signed_rgb=[0, 0, 0], v=0.),
                dict(grid='g', grid_weight=1., weight=.001, signed_rgb=[9, 9, 9], v=1.)]
        np.testing.assert_allclose(reweight(rows, 'v'), 9)
        self.assertLess(reweight(rows, 'v', .1)[0], .1)
        for r in rows:
            r['v'] = 1.
        np.testing.assert_allclose(reweight(rows, 'v', .1), .009)
        for r in rows:
            r['v'] = 0.
        self.assertIsNone(reweight(rows, 'v'))
        np.testing.assert_allclose(reweight(rows, 'v', .1), .009)

    def test_reweight_clamps_each_grid_then_blends(self):
        rows = [dict(grid='a', grid_weight=.5, weight=1., signed_rgb=[-1, 2, 4], v=1.),
                dict(grid='b', grid_weight=.5, weight=1., signed_rgb=[3, 2, 0], v=1.)]
        np.testing.assert_allclose(reweight(rows, 'v'), [1.5, 2, 2])

    def test_fill_invalid_grows_from_valid_face_neighbors(self):
        # res (x, y, z) = (3, 1, 1): only the middle probe is invalid.
        values = np.array([[1., 10], [99, 99], [3, 30]])
        filled, rounds = fill_invalid(values, np.array([True, False, True]), (3, 1, 1))
        np.testing.assert_allclose(filled, [[1, 10], [2, 20], [3, 30]])
        self.assertEqual(rounds, 1)
        filled, rounds = fill_invalid(np.arange(4.)[:, None], np.array([True, False, False, False]), (4, 1, 1))
        np.testing.assert_allclose(filled[:, 0], 0)
        self.assertEqual(rounds, 3)


if __name__ == '__main__':
    unittest.main()
