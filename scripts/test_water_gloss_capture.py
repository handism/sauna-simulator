"""The capture decoding and the view split of summarize_water_gloss_capture.py, without a browser."""
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_water_gloss_capture import blocks, linear, side_bounces
from summarize_water_gloss_scene import BOX, ROOT, camera_rays, flat_view


class CaptureTests(unittest.TestCase):
    def test_linear_undoes_srgb_and_scale(self):
        values = np.array([0.0, 0.002, 0.05, 0.3, 0.9])
        encoded = np.where(values <= 0.0031308, values * 12.92, 1.055 * values ** (1 / 2.4) - 0.055)
        pixels = np.round(np.repeat(encoded[None, :, None], 3, -1) * 255).astype(np.uint8)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'c.png'
            Image.fromarray(pixels).save(path)
            decoded = linear(path, 0.5)[0, :, 0]
        np.testing.assert_allclose(decoded, values / 0.5, atol=0.004 / 0.5)

    def test_straight_and_reflected_views(self):
        middle = np.array([(BOX[0] + BOX[1]) / 2, 2.0, (BOX[2] + BOX[3]) / 2])
        self.assertEqual(side_bounces(middle, np.array([0.0, -1.0, 0.0])), 0)
        # Steeply toward the low x side from its edge: the refracted ray meets it before the bottom.
        edge = np.array([BOX[0] + 0.2, 0.865, middle[2]])
        ray = np.array([-0.6, -0.8, 0.0])
        self.assertEqual(side_bounces(edge, ray), 1)
        self.assertEqual(side_bounces(middle, np.array([0.0, 1.0, 0.0])), -1)
        self.assertEqual(side_bounces(np.array([BOX[0] - 1, 2.0, middle[2]]), np.array([0.0, -1.0, 0.0])), -1)

    def test_split_matches_the_flat_box_trace(self):
        """Straight pixels land where the ray refracts straight down; reflected ones fold back."""
        view = json.loads((ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
        rays = camera_rays(view, 1, 'down', np.array([[740, 20], [740, 170]]))
        near, far = [flat_view(view['position'], r) for r in rays]
        self.assertEqual(side_bounces(view['position'], rays[0]), 1)
        self.assertEqual(side_bounces(view['position'], rays[1]), 0)
        # The reflected view leaves the floor toward the side (−x, the air direction toward the viewer).
        self.assertLess(near[1][0], 0)
        self.assertGreater(far[1][0], 0)

    def test_blocks(self):
        a = np.arange(12 * 7, dtype=float).reshape(12, 7)
        b = blocks(a)
        self.assertEqual(b.shape, (2, 1))
        self.assertAlmostEqual(b[0, 0], a[:5, :5].mean())


if __name__ == '__main__':
    unittest.main()
