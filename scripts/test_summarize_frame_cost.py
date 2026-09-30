"""The repeated-capture check and the light costs of summarize_frame_cost.py."""
import base64
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_frame_cost import image_runs, light_costs


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


def report(path, runs):
    """A Playwright JSON report with one passed test per (variant, {lighting: median ms})."""
    specs = []
    for index, (variant, medians) in enumerate(runs):
        body = {'variant': variant, 'index': index, 'quality': 'standard', 'browser': '1',
                'results': [{'stage': 'sauna', 'lighting': lighting, 'gpuMs': {'median': ms}}
                            for lighting, ms in medians.items()]}
        attachment = {'name': 'frame-cost', 'body': base64.b64encode(json.dumps(body).encode()).decode()}
        specs.append({'title': variant, 'tests': [{'results': [{'status': 'passed', 'attachments': [attachment]}]}]})
    Path(path).write_text('build log\n' + json.dumps({'suites': [{'specs': specs}]}))
    return path


class LightCostsTests(unittest.TestCase):
    def test_saving_is_against_the_neighbouring_products(self):
        with tempfile.TemporaryDirectory() as tmp:
            # The warm-up is left out; the products drift from 60 to 64 to 70 within the report.
            first = report(Path(tmp) / 'a.json', [
                ('warmup', {'night': 150}), ('product', {'night': 60}), ('noshadow-sun', {'night': 50}),
                ('noshadow-spot1', {'night': 58}), ('product', {'night': 64}), ('noshadow-all', {'night': 45}),
                ('product', {'night': 70})])
            second = report(Path(tmp) / 'b.json', [
                ('product', {'night': 70}), ('noshadow-all', {'night': 48}), ('noshadow-spot1', {'night': 66}),
                ('noshadow-sun', {'night': 56}), ('product', {'night': 70})])
            [view] = light_costs([first, second])
            self.assertEqual(view['productMs'], [60, 64, 70, 70, 70])
            self.assertEqual(view['savingMs']['noshadow-sun'], [12, 14])
            self.assertEqual(view['savingMs']['noshadow-all'], [22, 22])
            self.assertEqual(view['medianSavingMs'], {'noshadow-sun': 13, 'noshadow-spot1': 4, 'noshadow-all': 22})
            self.assertEqual(view['sumOfSingleLights'], 17)

    def test_a_variant_without_a_product_on_both_sides_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = report(Path(tmp) / 'a.json', [('product', {'night': 60}), ('noshadow-sun', {'night': 50})])
            with self.assertRaises(SystemExit):
                light_costs([path])
            path = report(Path(tmp) / 'b.json', [('noshadow-sun', {'night': 50}), ('product', {'night': 60})])
            with self.assertRaises(SystemExit):
                light_costs([path])

if __name__ == '__main__':
    unittest.main()
