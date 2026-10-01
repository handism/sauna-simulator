"""The repeated-capture check, the image ΔE and the light costs of summarize_frame_cost.py."""
import base64
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_frame_cost import compare_runs, image_delta, image_runs, light_costs, srgb_lab


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


class ImageDeltaTests(unittest.TestCase):
    def test_lab_of_white_and_black(self):
        lab = srgb_lab(np.array([[255.0, 255.0, 255.0], [0.0, 0.0, 0.0]]))
        np.testing.assert_allclose(lab, [[100, 0, 0], [0, 0, 0]], atol=0.05)

    def test_shares_and_worst_images_per_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            before, after = Path(tmp) / 'before', Path(tmp) / 'after'
            capture(before, 'same.png', 100)
            capture(after, 'same.png', 100)
            # A grey step of 10 levels from 100 is about 3.9 L*.
            capture(before, 'step.png', 100)
            capture(after, 'step.png', 110)
            folder = image_delta(before, after)['suite']
            self.assertEqual(folder['images'], 2)
            self.assertAlmostEqual(folder['over2'], 0.5)
            self.assertEqual(folder['over5'], 0)
            self.assertAlmostEqual(folder['meanDeltaE'], folder['maxImageMeanDeltaE'] / 2, places=3)
            self.assertGreater(folder['maxImageMeanDeltaE'], 3.5)

    def test_a_missing_after_capture_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            capture(Path(tmp) / 'before', 'a.png', 1)
            (Path(tmp) / 'after').mkdir()
            with self.assertRaises(SystemExit):
                image_delta(Path(tmp) / 'before', Path(tmp) / 'after')


def report(path, runs, **extra):
    """A Playwright JSON report with one passed test per (variant, {lighting: median ms})."""
    specs = []
    for index, (variant, medians) in enumerate(runs):
        body = {'variant': variant, 'index': index, 'quality': 'standard', 'browser': '1', **extra,
                'results': [{'stage': 'sauna', 'lighting': lighting, 'gpuMs': {'median': ms}, 'metrics': {},
                             **({'intervalMs': {'mean': ms / 2}} if extra.get('repeat') else {})}
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

class CompareRunsTests(unittest.TestCase):
    def test_runs_keep_their_device_pixel_ratio(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = report(Path(tmp) / 'a.json', [('warmup', {'night': 90}), ('product', {'night': 40})], dpr=1.5)
            after = report(Path(tmp) / 'b.json', [('product', {'night': 30})], dpr=1.5)
            result = compare_runs('standard', [before], [after])
            self.assertEqual(result['dpr'], 1.5)
            self.assertEqual(result['views'][0]['medianRatio'], 0.75)

    def test_mixed_device_pixel_ratios_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            # Reports from before the DPR was recorded ran at 1.
            before = report(Path(tmp) / 'a.json', [('product', {'night': 40})])
            after = report(Path(tmp) / 'b.json', [('product', {'night': 30})], dpr=1.5)
            with self.assertRaises(SystemExit):
                compare_runs('standard', [before], [after])

    def test_intervals_of_repeated_frames_are_compared(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = report(Path(tmp) / 'a.json', [('product', {'night': 40})], repeat=3)
            after = report(Path(tmp) / 'b.json', [('product', {'night': 30})], repeat=3)
            [view] = compare_runs('standard', [before], [after])['views']
            self.assertEqual(view['beforeIntervalMs'], [20])
            self.assertEqual(view['medianIntervalRatio'], 0.75)
            other = report(Path(tmp) / 'c.json', [('product', {'night': 30})], repeat=2)
            with self.assertRaises(SystemExit):
                compare_runs('standard', [before], [other])


if __name__ == '__main__':
    unittest.main()
