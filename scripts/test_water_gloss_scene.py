"""The per-pixel analysis and score of diagnose_water_gloss_scene.py, without Blender."""
import unittest

import numpy as np

from diagnose_water_gloss_scene import STRIDE, analysis, gltf, score
from diagnose_water_gloss_slab import fresnel, slab_integral
from summarize_water_gloss_scene import BOX, IOR, camera_rays, flat_view

LIGHT = (np.array([5.9, 2.8, 1.4]), np.array([-0.3142, -0.6569, -0.6854]), 1.0)
RADIANCE = np.array([1.0, 0.7, 0.39])


def maps(size=10):
    """A floor seen straight on at every pixel, in Blender axes (z up)."""
    weight = np.full((size, size, 3), 0.8)
    weight[..., 2] = 0.6
    position = np.zeros((size, size, 3))
    position[..., 0] = np.linspace(0.5, 1.5, size)[None, :]
    position[..., 1] = np.linspace(1.5, 2.5, size)[:, None]
    position[..., 2] = 0.2025
    incoming = np.zeros((size, size, 3))
    incoming[..., 0] = 0.6
    incoming[..., 2] = 0.8
    return {'weight': weight.mean(-1), 'weightRGB': weight, 'position': position, 'incoming': incoming}


class SceneAnalysisTests(unittest.TestCase):
    def test_axes(self):
        np.testing.assert_array_equal(gltf((1.0, 2.0, 3.0)), [1.0, 3.0, -2.0])

    def test_point_is_throughput_times_slab_integral(self):
        m = maps()
        points = analysis(m, LIGHT, RADIANCE, 41)
        self.assertEqual(len(points), (10 // STRIDE) ** 2)
        y, x, weight, value = points[0]
        self.assertEqual((y, x), (STRIDE // 2, STRIDE // 2))
        p = gltf(m['position'][y, x])
        p[1] = 0.202
        expected = m['weightRGB'][y, x] * slab_integral(p, gltf(m['incoming'][y, x]), LIGHT, 41) * RADIANCE
        np.testing.assert_allclose(value, expected)
        self.assertAlmostEqual(weight, m['weight'][y, x])
        # Channels keep their own throughput.
        self.assertAlmostEqual(value[2] / value[0], 0.6 / 0.8 * 0.39)

    def test_skips_uncovered_off_floor_and_downward_pixels(self):
        m = maps()
        c = STRIDE // 2
        m['weight'][c, c] = 0.01
        m['position'][c, c + STRIDE, 2] = 0.24
        m['incoming'][c + STRIDE, c] = (0.6, 0.0, -0.8)
        points = analysis(m, LIGHT, RADIANCE, 41)
        self.assertEqual([(y, x) for y, x, *_ in points], [(c + STRIDE, c + STRIDE)])

    def test_mixed_directions_are_skipped_and_short_ones_normalised(self):
        m = maps()
        c = STRIDE // 2
        m['incoming'][c, c] *= 0.5
        m['incoming'][c, c + STRIDE] *= 0.95
        points = analysis(m, LIGHT, RADIANCE, 41)
        self.assertNotIn((c, c), [(y, x) for y, x, *_ in points])
        unit = [v for y, x, _, v in points if (y, x) == (c + STRIDE, c + STRIDE)][0]
        short = [v for y, x, _, v in points if (y, x) == (c, c + STRIDE)][0]
        self.assertGreater(short[0], 0)
        self.assertAlmostEqual(short[0] / unit[0], 1, delta=0.2)

    def test_score_ratio_and_spot(self):
        points = [(2, 2, 1.0, np.array([1.0, 1.0, 1.0])), (2, 7, 1.0, np.array([2.0, 2.0, 2.0])),
                  (7, 2, 1.0, np.array([3.0, 3.0, 3.0]))]
        gloss = np.zeros((10, 10, 3))
        gloss[:5, :5] = 0.5
        gloss[:5, 5:] = 1.0
        gloss[5:, :5] = 1.5
        spot = np.zeros((10, 10), bool)
        spot[:5] = True
        s = score(gloss, spot, points)
        self.assertEqual((s['points'], s['spotPoints']), (3, 2))
        self.assertAlmostEqual(s['cyclesOverAnalysisAll'], 0.5)
        self.assertAlmostEqual(s['cyclesOverAnalysisSpot'], 0.5)
        self.assertAlmostEqual(s['correlationAll'], 1.0)

    def test_score_averages_a_stride_block(self):
        gloss = np.zeros((10, 10, 3))
        gloss[2, 2] = STRIDE * STRIDE
        s = score(gloss, np.ones((10, 10), bool), [(2, 2, 1.0, np.ones(3)), (7, 7, 1.0, 3 * np.ones(3))])
        self.assertAlmostEqual(s['cyclesOverAnalysisAll'], 0.25)


class FlatViewTests(unittest.TestCase):
    def test_straight_down(self):
        floor, v, throughput = flat_view((1.0, 1.2, -2.0), np.array([0.0, -1.0, 0.0]))
        np.testing.assert_allclose(floor, [1.0, 0.202, -2.0], atol=1e-12)
        np.testing.assert_allclose(v, [0.0, 1.0, 0.0], atol=1e-12)
        self.assertAlmostEqual(throughput, (1 - ((IOR - 1) / (IOR + 1)) ** 2) ** 2)

    def test_oblique_ray_leaves_parallel_and_matches_slab_mapping(self):
        ray = np.array([0.6, -0.8, 0.0])
        floor, v, throughput = flat_view((0.0, 1.2, -2.0), ray)
        np.testing.assert_allclose(v, -ray, atol=1e-12)
        self.assertAlmostEqual(throughput, (1 - float(fresnel(0.8, IOR))) ** 2)
        # Shallower in the water than a straight line through the same top point.
        straight = (1.2 - 0.202) * 0.6 / 0.8
        self.assertLess(floor[0], straight)
        self.assertGreater(floor[0], (1.2 - 0.765) * 0.6 / 0.8)

    def test_side_wall_folds_the_ray_back(self):
        # Grazing near the +x wall: the ray meets it before the bottom and is folded with its reflectance.
        ray = np.array([0.9, -np.sqrt(1 - 0.81), 0.0])
        start = (BOX[1] - 0.25, 0.8, -2.0)
        floor, v, throughput = flat_view(start, ray)
        self.assertLess(floor[0], BOX[1])
        # Folded: the path toward the viewer now heads +x again, to the mirror image of the camera.
        self.assertGreater(v[0], 0)
        self.assertLess(floor[0], start[0])
        self.assertLess(throughput, 1)

    def test_outside_the_box_or_upward_is_none(self):
        self.assertIsNone(flat_view((5.0, 1.2, -2.0), np.array([0.0, -1.0, 0.0])))
        self.assertIsNone(flat_view((1.0, 1.2, -2.0), np.array([0.0, 1.0, 0.0])))

    def test_center_pixel_is_the_forward_direction(self):
        view = {'position': [0.0, 1.0, 0.0], 'target': [0.0, 1.0, -5.0], 'fov': 60}
        ray = camera_rays(view, 0, 'level', np.array([[639.5, 399.5]]))[0]
        np.testing.assert_allclose(ray, [0.0, np.sin(-0.01), -np.cos(0.01)], atol=1e-12)
        top = camera_rays(view, 0, 'level', np.array([[639.5, -0.5]]))[0]
        self.assertAlmostEqual(np.degrees(np.arctan2(top[1], -top[2])) + np.degrees(0.01), 30, places=6)


if __name__ == '__main__':
    unittest.main()
