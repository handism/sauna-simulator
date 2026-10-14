"""Reject incomplete or ambiguous browser captures before visual comparison."""
import base64
import json
import tempfile
import unittest
from pathlib import Path

from summarize_water_light_occlusion import report


class CaptureReportTest(unittest.TestCase):
    def make(self, directory, stats=None, copies=1):
        attachment = {'name': 'stage-compare', 'body': base64.b64encode(b'{"quality":"standard"}').decode()}
        data = {
            'config': {},
            'stats': stats or {'expected': 1, 'unexpected': 0, 'skipped': 0, 'flaky': 0},
            'suites': [{'specs': [{'tests': [{'results': [{'attachments': [attachment] * copies}]}]}]}],
        }
        path = Path(directory) / 'report.json'
        path.write_text('build output\n' + json.dumps(data, indent=2))
        return path

    def test_success_with_build_preamble(self):
        with tempfile.TemporaryDirectory() as directory:
            stats, metadata = report(self.make(directory))
            self.assertEqual(stats['expected'], 1)
            self.assertEqual(metadata['quality'], 'standard')

    def test_rejects_failed_skipped_flaky_and_empty_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            for field in ('unexpected', 'skipped', 'flaky', 'expected'):
                stats = {'expected': 1, 'unexpected': 0, 'skipped': 0, 'flaky': 0}
                stats[field] = 0 if field == 'expected' else 1
                with self.assertRaises(AssertionError):
                    report(self.make(directory, stats=stats))

    def test_requires_exactly_one_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            for copies in (0, 2):
                with self.assertRaises(AssertionError):
                    report(self.make(directory, copies=copies))


if __name__ == '__main__':
    unittest.main()
