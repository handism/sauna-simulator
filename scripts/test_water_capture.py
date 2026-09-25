import unittest
from diagnose_water_capture import matches, texel_center


class CaptureTest(unittest.TestCase):
    def test_texel_center_and_edges(self):
        self.assertEqual(texel_center((0, 0), (4, 2)), (0.125, 0.25))
        self.assertEqual(texel_center((0.999, 0.999), (4, 2)), (0.875, 0.75))
        self.assertIsNone(texel_center((1, 0.5), (4, 2)))
        self.assertIsNone(texel_center((-0.001, 0.5), (4, 2)))

    def test_depth_match_requires_same_surface_and_position(self):
        target = {'object': 'tile', 'position': (0, 0, 0)}
        self.assertTrue(matches(target, {'object': 'tile', 'position': (0.001, 0, 0)}, 0.002))
        self.assertFalse(matches(target, {'object': 'wall', 'position': (0, 0, 0)}, 0.002))
        self.assertFalse(matches(target, {'object': 'tile', 'position': (0.002, 0.002, 0)}, 0.002))
        self.assertFalse(matches(target, None, 0.002))


if __name__ == '__main__':
    unittest.main()
