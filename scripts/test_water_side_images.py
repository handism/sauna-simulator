import unittest

import numpy as np

from summarize_water_side_images import ORIGINAL, compare, lab, mean_abs_dl, region_stats


class LabTest(unittest.TestCase):
    def test_lab_of_white_grey_and_black(self):
        values = lab(np.array([[[255, 255, 255], [119, 119, 119], [0, 0, 0]]]))[0]
        self.assertAlmostEqual(values[0, 0], 100, delta=0.05)
        self.assertAlmostEqual(values[1, 0], 50, delta=0.3)
        self.assertAlmostEqual(values[2, 0], 0, delta=1e-9)
        self.assertTrue(np.all(np.abs(values[:, 1:]) < 0.05))


class CompareTest(unittest.TestCase):
    def test_regions_follow_the_l_changes(self):
        cycles = np.zeros((2, 2, 3))
        cycles[..., 0] = 40
        v11 = cycles.copy()
        v11[0, 0, 0] = 30  # the flattened water changed one pixel
        before = cycles.copy()
        before[0, 0] = [30, 3, 4]
        after = cycles.copy()
        after[0, 0, 0] = 39
        row = compare(cycles, before, after, v11)
        self.assertEqual(row['water']['share'], 0.25)
        self.assertEqual(row['water']['L'], {'cycles': 40, 'before': 30, 'after': 39})
        self.assertAlmostEqual(row['water']['delta_e76']['before'], np.sqrt(100 + 9 + 16))
        self.assertAlmostEqual(row['water']['delta_e76']['after'], 1)
        self.assertEqual(row['changed']['share'], 0.25)
        self.assertAlmostEqual(row['mean_L']['before'], 37.5)
        self.assertNotIn('water', compare(cycles, before, after))
        self.assertEqual(region_stats(np.zeros((2, 2), bool), cycles, before, after), {'share': 0.0})

    def test_mean_abs_dl_over_the_renders_present(self):
        rows = {'01': {'mean_L': {'cycles': 30, 'before': 32, 'after': 29}},
                '03': {'mean_L': {'cycles': 40, 'before': 36, 'after': 41}}}
        self.assertEqual(mean_abs_dl(rows, ORIGINAL, 'before'), 3)
        self.assertEqual(mean_abs_dl(rows, ORIGINAL, 'after'), 1)
        self.assertIsNone(mean_abs_dl(rows, ['bh-02'], 'after'))


if __name__ == '__main__':
    unittest.main()
