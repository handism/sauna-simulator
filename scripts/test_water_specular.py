"""Run: python3 -m unittest discover -s scripts -p 'test_water_specular.py'."""
import unittest

import numpy as np

from diagnose_water_specular import (WaterProbes, browser_specular, load_dfg, material_parameters,
                                     multiscattering, sample_dfg, to_gltf)


def constant_probes(value):
    """A water grid whose radiance is `value` in every direction (DC coefficient only)."""
    probes = WaterProbes.__new__(WaterProbes)
    values = np.zeros((2, 2, 2, 9, 3))
    values[..., 0, :] = value / .282095
    grid = {'min': np.zeros(3), 'max': np.ones(3), 'res': np.array([2, 2, 2]), 'values': {'day': values}}
    probes.grids = {'irradiance': grid, 'reflection': grid}
    return probes


class WaterSpecularTests(unittest.TestCase):
    def test_dfg_lut_decodes_three_texels(self):
        lut = load_dfg()
        self.assertEqual(lut.shape, (16, 16, 2))
        np.testing.assert_allclose(sample_dfg(lut, 0, 1), [1, 0], atol=1e-3)
        # Texel centres return the stored texel; the rows are dot(N, V).
        np.testing.assert_allclose(sample_dfg(lut, 2.5 / 16, 5.5 / 16), lut[5, 2])

    def test_white_furnace_multiscattering_conserves_energy(self):
        for fab in ([.9, .05], [.5, .2], [.3, .1]):
            single, multiple = multiscattering(np.array(fab), np.ones(3), 1.)
            np.testing.assert_allclose(single + multiple, 1)

    def test_material_parameters_follow_three(self):
        standard = material_parameters({'pbrMetallicRoughness': {'roughnessFactor': .01, 'metallicFactor': 0}})
        self.assertEqual(standard['roughness'], .0525)
        np.testing.assert_allclose(standard['f0'], .04)
        self.assertEqual(standard['f90'], 1)
        physical = material_parameters({'pbrMetallicRoughness': {'metallicFactor': 0},
                                        'extensions': {'KHR_materials_specular': {'specularFactor': .56}}})
        np.testing.assert_allclose(physical['f0'], .04 * .56)
        self.assertAlmostEqual(physical['f90'], .56)

    def test_constant_light_returns_its_value_for_a_white_mirror(self):
        probes = constant_probes(np.array([.5, 1., 2.]))
        material = material_parameters({'pbrMetallicRoughness': {'roughnessFactor': .3, 'metallicFactor': 1,
                                                                 'baseColorFactor': [1, 1, 1, 1]}})
        for view in ([0, 1, 0], [.6, .8, 0], [0, .2, .98]):
            specular, terms = browser_specular(probes, load_dfg(), 'day', material, np.full(3, .5),
                                               np.array([0., 1, 0]), np.array(view, float))
            np.testing.assert_allclose(terms['radiance'], [.5, 1, 2], rtol=1e-6)
            np.testing.assert_allclose(terms['irradiance'], np.pi * np.array([.5, 1, 2]), rtol=1e-6)
            np.testing.assert_allclose(specular, [.5, 1, 2], rtol=1e-6)

    def test_double_sided_surface_shades_the_side_facing_the_eye(self):
        probes = constant_probes(np.ones(3))
        material = material_parameters({'pbrMetallicRoughness': {'roughnessFactor': .3, 'metallicFactor': 0}})
        args = (probes, load_dfg(), 'day', material, np.full(3, .5))
        view = np.array([.3, .9, .1])
        front, _ = browser_specular(*args, np.array([0., 1, 0]), view)
        back, _ = browser_specular(*args, np.array([0., -1, 0]), view)
        np.testing.assert_allclose(front, back)

    def test_axes_match_the_gltf_export(self):
        np.testing.assert_allclose(to_gltf([1, 2, 3]), [1, 3, -2])


if __name__ == '__main__':
    unittest.main()
