"""Reject invalid capture evidence and preserve signed RGB endpoints in tiny differences."""

import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_compile_batches import digest, pixel_delta, stability_images
from compare_compile_unmatched import compare


class CaptureStabilityTest(unittest.TestCase):
    def test_historical_comparison_requires_matching_inputs_and_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            captures = []
            for frames in (0, 70, 140):
                path = root / f"{frames}.png"
                Image.new("RGB", (1800, 1200)).save(path)
                captures.append({"image": str(path), "sha256": digest(path), "frames": frames})
            stage = {**captures[0], "stage": "sauna", "stability": captures[1:]}
            original = {"quality": "standard", "lighting": "night", "engine": "cft", "version": "test",
                        "inputs": {"fixture": "abc"}, "rows": [{"stages": [stage]}]}
            old = root / "old.json"
            old.write_text(json.dumps(original))
            checks = root / "checks.json"
            checks.write_text(json.dumps({"sourceReports": [{"report": old.name, "sha256": digest(old)}],
                                          "unmatchedCaptures": 1, "checks": [{"image": captures[0]["image"], "stage": "sauna",
                                          "rgbSha256": hashlib.sha256(bytes(1800 * 1200 * 3)).hexdigest(), "matchingNormalImage": None}]}))
            new = root / "new.json"
            report = {**original, "captureStability": True, "warm": False, "rows": [{"condition": "0", "stages": [stage]}]}
            summary = root / "summary.json"

            def write_new():
                new.write_text(json.dumps(report))
                summary.write_text(json.dumps({"runs": [{"report": str(new), "reportSha256": digest(new)}]}))

            write_new()
            self.assertEqual(compare(checks, summary)["stillUnmatched"], 0)
            report["inputs"] = {"fixture": "changed"}
            write_new()
            with self.assertRaisesRegex(AssertionError, "compatible"):
                compare(checks, summary)
            old.write_text("changed")
            with self.assertRaisesRegex(AssertionError, "historical report changed"):
                compare(checks, summary)

    def test_pixel_delta_does_not_wrap_uint8(self):
        before = np.array([[[255, 0, 20], [0, 0, 0]]], dtype=np.uint8)
        after = np.array([[[0, 255, 20], [0, 0, 0]]], dtype=np.uint8)
        result = pixel_delta(before, after)
        self.assertEqual(result["changedPixels"], 1)
        self.assertEqual(result["maxChannelDelta"], 255)
        self.assertEqual(result["pixels"][0], {"x": 0, "y": 0, "before": [255, 0, 20], "after": [0, 255, 20]})

    def test_truncation_keeps_total_count(self):
        result = pixel_delta(np.zeros((2, 20, 3), dtype=np.uint8), np.ones((2, 20, 3), dtype=np.uint8))
        self.assertEqual(result["changedPixels"], 40)
        self.assertEqual(len(result["pixels"]), 32)
        self.assertTrue(result["pixelsTruncated"])

    def test_capture_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            samples = []
            for frames in (0, 70, 140):
                path = Path(directory) / f"{frames}.png"
                Image.new("RGB", (1800, 1200)).save(path)
                samples.append({"frames": frames, "image": str(path), "sha256": digest(path)})
            stage = {**samples[0], "stability": samples[1:]}
            self.assertEqual(len(stability_images(stage)), 3)
            for changed in ([], samples[1:][::-1]):
                with self.assertRaisesRegex(AssertionError, "missing or reordered"):
                    stability_images({**stage, "stability": changed})
            shared = copy.deepcopy(stage)
            shared["stability"][1]["image"] = shared["stability"][0]["image"]
            with self.assertRaisesRegex(AssertionError, "shared"):
                stability_images(shared)
            Path(samples[-1]["image"]).write_bytes(b"changed")
            with self.assertRaisesRegex(AssertionError, "image changed"):
                stability_images(stage)
            Image.new("RGB", (1, 1)).save(samples[-1]["image"])
            stage["stability"][-1]["sha256"] = digest(samples[-1]["image"])
            with self.assertRaisesRegex(AssertionError, "dimensions"):
                stability_images(stage)


if __name__ == "__main__":
    unittest.main()
