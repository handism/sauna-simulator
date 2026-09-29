import json
from pathlib import Path
import unittest

import numpy as np

from water_bump import BUMP, bump_slopes, edge_roughness, fbm

ROOT = Path(__file__).resolve().parents[1]


class WaterBumpTest(unittest.TestCase):
    def test_fbm_matches_blender(self):
        data = json.loads((ROOT / 'e2e/fixtures/blender-noise.json').read_text())
        points = np.array(data['points'], float)
        for config in data['configs']:
            values = fbm(points * config['scale'], config['detail'], config['roughness'], data['lacunarity'])
            np.testing.assert_allclose(values, config['values'], atol=1e-4)

    def test_bump_slopes_are_small_and_scale_with_strength(self):
        x, y = np.meshgrid(1.4 + np.arange(64) * 0.0005, 2.3 + np.arange(64) * 0.0005)
        slopes = bump_slopes(x, y, np.full_like(x, 0.765))
        self.assertLess(slopes.max(), BUMP['strength'])
        self.assertGreater(np.sqrt((slopes ** 2).mean()), 0.0005)
        self.assertLess(np.sqrt((slopes ** 2).mean()), 0.003)

    def test_edge_roughness_grows_when_an_outline_frays(self):
        yy, xx = np.mgrid[:120, :120]
        disk = np.where(np.hypot(xx - 60, yy - 60) < 40, 255.0, 0.0)
        frayed = np.where(np.hypot(xx - 60, yy - 60) < 40 + 4 * np.sin(np.arctan2(yy - 60, xx - 60) * 40), 255.0, 0.0)
        # The smoothing pulls a curved outline in a little, so a smooth disk scores about 0.3.
        self.assertLess(edge_roughness(disk), 0.4)
        self.assertGreater(edge_roughness(frayed), edge_roughness(disk) + 0.2)


if __name__ == '__main__':
    unittest.main()
