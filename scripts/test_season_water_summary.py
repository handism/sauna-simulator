import base64
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from summarize_season_water import load


class CaptureValidation(unittest.TestCase):
    def fixture(self, root, *, status='passed', files=None, size=(1280, 800)):
        files = files or ['one.png']
        Image.new('RGB', size).save(root / 'one.png')
        data = dict(errors=[], samples=[dict(file=name) for name in files])
        report = dict(stats=dict(expected=1, unexpected=0, skipped=0, flaky=0), errors=[],
                      config=dict(projects=[dict(outputDir=str(root))]),
                      suites=[dict(specs=[dict(tests=[dict(results=[dict(status=status, attachments=[dict(
                          name='season-light', body=base64.b64encode(json.dumps(data).encode()).decode())])])])])])
        path = root / 'report.json'
        path.write_text(json.dumps(report))
        return path

    def test_accepts_completed_capture_and_hashes_real_image(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(Path(tmp))
            result, files = load(path, 'season-light', 1)
            self.assertEqual(len(result['png_sha256']['one.png']), 64)
            self.assertEqual(files['one.png'], Path(tmp) / 'one.png')

    def test_rejects_failed_capture_even_if_report_stats_look_successful(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(Path(tmp), status='failed')
            with self.assertRaises(AssertionError):
                load(path, 'season-light', 1)

    def test_rejects_duplicate_or_wrong_sized_images(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self.fixture(Path(tmp), files=['one.png', 'one.png'])
            with self.assertRaises(AssertionError):
                load(path, 'season-light', 2)
            path = self.fixture(Path(tmp), size=(640, 400))
            with self.assertRaises(AssertionError):
                load(path, 'season-light', 1)


if __name__ == '__main__':
    unittest.main()
