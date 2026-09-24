"""Run: python3 -m unittest discover -s scripts -p 'test_probe_sampling.py'."""
import unittest

import numpy as np

from probe_sampling import ProbeSampler, evaluate, interpolate, stencil


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
        # Includes room, courtyard, both-grid transition, and clamped outer grid.
        for scene in ('day', 'evening'):
            for p in ([-3, 1, -2], [0, -.2, 0], [8.25, 1, 0], [40, 15, 40]):
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


if __name__ == '__main__':
    unittest.main()
