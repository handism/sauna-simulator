"""Prevent incomplete or mismatched recordings from producing a diagnostic result."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

from analyze_auto_motion_frames import analyze, decode, sha


class RecordingValidationTests(unittest.TestCase):
    def fixture(self, folder):
        video = folder / 'test.webm'
        video.write_bytes(b'fixture')
        run = {'stage': 'water', 'minute': 12, 'browser': 'test', 'quality': 'high',
               'hashes': {}, 'samples': 1, 'video': {'file': video.name, 'sha256': sha(video)}}
        sample = {**{k: run[k] for k in ('stage', 'minute', 'browser', 'quality', 'hashes')},
                  'errors': [], 'samples': [{}]}
        path = folder / 'water-12-samples.json'
        path.write_text(json.dumps(sample))
        return run, path

    def test_modified_video_rejected_before_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            run, _ = self.fixture(folder)
            (folder / 'test.webm').write_bytes(b'changed')
            with patch('analyze_auto_motion_frames.decode') as decoder:
                with self.assertRaises(SystemExit):
                    analyze(run, folder)
                decoder.assert_not_called()

    def test_swapped_sample_quality_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            run, path = self.fixture(folder)
            data = json.loads(path.read_text())
            data['quality'] = 'standard'
            path.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, 'quality'):
                analyze(run, folder)

    def test_swapped_look_mode_rejected_before_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            run, path = self.fixture(folder)
            run['look'] = 'full-pitch'
            data = json.loads(path.read_text())
            data['look'] = 'surround'
            path.write_text(json.dumps(data))
            with patch('analyze_auto_motion_frames.decode') as decoder:
                with self.assertRaisesRegex(ValueError, 'look'):
                    analyze(run, folder)
                decoder.assert_not_called()

    def test_fixed_with_sweep_rejected_before_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            run, path = self.fixture(folder)
            run['look'] = 'fixed'
            data = json.loads(path.read_text())
            data.update(look='fixed', looks=[], sweeps=[[50, 70]])
            path.write_text(json.dumps(data))
            with patch('analyze_auto_motion_frames.decode') as decoder:
                with self.assertRaisesRegex(ValueError, 'camera input'):
                    analyze(run, folder)
                decoder.assert_not_called()

    def test_missing_timestamp_rejected_before_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            run, _ = self.fixture(folder)
            probe = {'frames': [{'best_effort_timestamp_time': str(t)} for t in [0, .04, .12]]}
            with patch('analyze_auto_motion_frames.subprocess.run',
                       return_value=SimpleNamespace(stdout=json.dumps(probe))):
                with patch('analyze_auto_motion_frames.decode') as decoder:
                    with self.assertRaisesRegex(ValueError, '25-fps'):
                        analyze(run, folder)
                    decoder.assert_not_called()

    def test_partial_rgb_frame_rejected(self):
        def partial(_cmd, **kwargs):
            kwargs['stdout'].write(b'x')
        with patch('analyze_auto_motion_frames.subprocess.run', side_effect=partial):
            with self.assertRaisesRegex(ValueError, 'Incomplete'):
                decode('fixture')


if __name__ == '__main__':
    unittest.main()
