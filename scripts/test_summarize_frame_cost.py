"""The repeated-capture check of summarize_frame_cost.py."""
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_frame_cost import image_runs


def capture(root, name, value):
    path = Path(root) / 'suite' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.full((4, 4, 3), value, np.uint8)).save(path)


class ImageRunsTests(unittest.TestCase):
    def test_after_matching_either_before_load_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            roots = [str(Path(tmp) / name) for name in ('b1', 'b2', 'a1', 'a2')]
            # A varies between loads of both builds; B is the same everywhere.
            for root, value in zip(roots, (10, 11, 11, 10)):
                capture(root, 'a.png', value)
                capture(root, 'b.png', 50)
            folder = image_runs(roots[:2], roots[2:])['folders']['suite']
            self.assertEqual(folder['images'], 2)
            self.assertEqual(folder['varyingBetweenLoads'], 1)
            self.assertEqual(folder['afterNotInBefore'], [])

    def test_after_seen_in_no_before_load_is_listed(self):
        with tempfile.TemporaryDirectory() as tmp:
            roots = [str(Path(tmp) / name) for name in ('b1', 'b2', 'a1')]
            for root, value in zip(roots, (10, 10, 12)):
                capture(root, 'a.png', value)
            folder = image_runs(roots[:2], roots[2:])['folders']['suite']
            self.assertEqual(folder['afterNotInBefore'], ['a.png'])


if __name__ == '__main__':
    unittest.main()
