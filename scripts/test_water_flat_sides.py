import unittest

import numpy as np

from blend_lineage import SHADING_ONLY, geometry_root, same_geometry
from diagnose_water_gloss_mismatch import SHADING, VARIANTS
from summarize_water_flat_sides import THRESHOLD, glossy, image_change


class LineageTest(unittest.TestCase):
    def test_fixed_blend_shares_the_v11_geometry(self):
        for child, parent in SHADING_ONLY.items():
            self.assertTrue(same_geometry(child, parent))
            self.assertEqual(geometry_root(child), geometry_root(parent))
        self.assertFalse(same_geometry(next(iter(SHADING_ONLY)), '0' * 64))
        self.assertEqual(geometry_root('0' * 64), '0' * 64)


class ShadingVariantsTest(unittest.TestCase):
    def test_each_shading_variant_stands_alone(self):
        for name in SHADING:
            self.assertEqual(VARIANTS[name], [name])
        self.assertTrue(set(SHADING).isdisjoint(VARIANTS['model']))


class SummaryTest(unittest.TestCase):
    def test_glossy_multiplies_colour_by_direct_plus_indirect(self):
        passes = {'GlossCol': [0.5, 1, 0], 'GlossDir': [1, 0, 2], 'GlossInd': [1, 2, 2]}
        self.assertAlmostEqual(glossy(passes), 0.5 * 2 + 1 * 2)

    def test_image_change_counts_and_boxes_the_visible_steps(self):
        before = np.zeros((10, 20, 3), dtype=np.uint8)
        after = before.copy()
        after[2:4, 5:10, 1] = THRESHOLD + 1
        after[8, 0, 0] = THRESHOLD  # at the threshold: not counted
        stats, difference = image_change(before, after)
        self.assertAlmostEqual(stats['changed_share'], 10 / 200)
        self.assertEqual(stats['changed_box'], [0.25, 0.2, 0.5, 0.4])
        self.assertEqual(stats['max_step'], THRESHOLD + 1)
        self.assertEqual(difference.shape, (10, 20))
        unchanged, _ = image_change(before, before)
        self.assertIsNone(unchanged['changed_box'])


if __name__ == '__main__':
    unittest.main()
