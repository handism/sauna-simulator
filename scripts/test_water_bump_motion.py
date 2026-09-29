import unittest

import numpy as np

from analyze_water_bump_motion import FPS, analyze, fast_share, flips


def disk_frames(radius, count=24, size=80):
    yy, xx = np.mgrid[:size, :size]
    return np.stack([np.hypot(xx - size / 2, yy - size / 2) < radius(t) for t in range(count)])


class WaterBumpMotionTest(unittest.TestCase):
    def test_a_still_outline_does_not_flip(self):
        masks = disk_frames(lambda t: 25)
        self.assertEqual(flips(masks), (0.0, 0.0))

    def test_a_drifting_outline_flips_without_flipping_back(self):
        masks = disk_frames(lambda t: 15 + t * 0.5)
        rate, back = flips(masks)
        self.assertGreater(rate, 0)
        self.assertEqual(back, 0)

    def test_a_shimmering_outline_flips_back(self):
        masks = disk_frames(lambda t: 25 + (t % 2))
        rate, back = flips(masks)
        self.assertGreater(rate, 0.5)
        # The last change has no later frame to flip back in.
        self.assertGreater(back, 0.9)

    def test_fast_share_separates_shimmer_from_waves(self):
        t = np.arange(72) / FPS
        slow = np.sin(2 * np.pi * 2 * t)[:, None, None] * np.ones((1, 4, 4))
        fast = np.sin(2 * np.pi * 25 * t)[:, None, None] * np.ones((1, 4, 4))
        region = np.ones((4, 4), bool)
        self.assertLess(fast_share(slow, region), 0.05)
        self.assertGreater(fast_share(fast, region), 0.95)

    def test_analyze_reports_a_still_disk_as_steady(self):
        masks = disk_frames(lambda t: 25, count=12)
        rgb = np.repeat(np.where(masks, 220, 40)[..., None], 3, -1).astype(np.uint8)
        result = analyze(rgb)
        self.assertEqual(result['flipsPerOutlinePixelPerFrame'], 0)
        self.assertEqual(result['highPass']['nearOutline'], 0)
        self.assertEqual(result['roughness']['perFrame'], result['roughness']['mean100ms'])


if __name__ == '__main__':
    unittest.main()
