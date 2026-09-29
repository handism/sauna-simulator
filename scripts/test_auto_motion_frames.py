import unittest

import numpy as np

from analyze_auto_motion_frames import FPS, band_ratio, frame_diffs, high_pass, near_keyframes, per_step_change, segments


class AutoMotionFramesTest(unittest.TestCase):
    def test_band_ratio_finds_a_mirror_step_rhythm(self):
        t = np.arange(60 * FPS) / FPS
        rng = np.random.default_rng(1)
        noise = rng.normal(0, 0.02, len(t))
        steps = np.floor(t / 0.36) * 0.05  # a staircase every 0.36 s
        self.assertGreater(band_ratio(noise + steps), 3)
        self.assertLess(band_ratio(noise + 0.01 * t), 2)

    def test_per_step_change_spreads_the_whole_change(self):
        frames = np.stack([np.full((2, 2), i / 10) for i in range(100)])
        change = per_step_change(frames, np.arange(100), steps=10, span=10)
        self.assertAlmostEqual(change['max'], 0.9, places=3)

    def test_keyframes_mark_one_frame_either_side(self):
        mask = near_keyframes(20, [0.0, 0.4])
        self.assertEqual(np.flatnonzero(mask).tolist(), [0, 1, 9, 10, 11])

    def test_segments_leave_out_sweeps_and_their_settling(self):
        observed = np.arange(0, 195, 1 / FPS)
        ramp, hold = segments(observed, [[50, 70]])
        self.assertTrue(ramp[int(10 * FPS)])
        self.assertFalse(ramp[int(49.5 * FPS)])
        self.assertFalse(ramp[int(72 * FPS)])
        self.assertTrue(ramp[int(74 * FPS)])
        self.assertTrue(hold[int(190 * FPS)])
        self.assertFalse(hold[int(180 * FPS)] or ramp[int(180 * FPS)])

    def test_high_pass_ignores_a_steady_ramp_and_sees_flicker(self):
        ramp = np.stack([np.full((4, 4), float(i)) for i in range(10)])
        flicker = np.stack([np.full((4, 4), float(i % 2) * 4) for i in range(10)])
        self.assertAlmostEqual(high_pass(ramp, range(10))[0].mean(), 0)
        self.assertAlmostEqual(high_pass(flicker, range(10))[0].mean(), 4)
        self.assertEqual(frame_diffs(ramp).tolist(), [0.0] + [1.0] * 9)


if __name__ == '__main__':
    unittest.main()
