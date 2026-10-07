"""Compare previously unmatched RGB captures with verified, settled normal captures."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

from summarize_compile_batches import digest, pixel_delta, stability_images


def compare(check_path, summary_path):
    check_path, summary_path = Path(check_path), Path(summary_path)
    checks = json.loads(check_path.read_text())
    summary = json.loads(summary_path.read_text())
    originals = {}
    for source in checks["sourceReports"]:
        report_path = check_path.parent / source["report"]
        assert digest(report_path) == source["sha256"], "historical report changed"
        report = json.loads(report_path.read_text())
        for row in report["rows"]:
            for stage in row["stages"]:
                originals[Path(stage["image"]).resolve()] = (stage["sha256"], report)
    normals = []
    for run in summary["runs"]:
        assert digest(run["report"]) == run["reportSha256"], "new report changed"
        report = json.loads(Path(run["report"]).read_text())
        assert report["captureStability"] and not report["warm"]
        for row in report["rows"]:
            if row["condition"] != "0":
                continue
            for stage in row["stages"]:
                images = stability_images(stage)
                normals.append((report, stage["stage"], stage["stability"][-1], images[-1]))
    results = []
    for check in checks["checks"]:
        if check["matchingNormalImage"] is not None:
            continue
        path = (check_path.parent / check["image"]).resolve()
        sha, original = originals[path]
        assert digest(path) == sha, "historical image changed"
        image = np.asarray(Image.open(path).convert("RGB"))
        assert hashlib.sha256(image.tobytes()).hexdigest() == check["rgbSha256"]
        candidates = []
        for report, stage, capture, normal in normals:
            if stage != check["stage"] or any(report[k] != original[k] for k in ("quality", "lighting", "engine", "version", "inputs")):
                continue
            candidates.append({"image": capture["image"], "sha256": capture["sha256"], **pixel_delta(normal, image)})
        assert candidates, "no compatible normal captures"
        results.append({"image": check["image"], "sha256": sha, "rgbSha256": check["rgbSha256"],
                        "normalComparisons": candidates})
    assert len(results) == checks["unmatchedCaptures"]
    return {"note": "Historical unmatched images compared to new +140-frame normal captures. RGB endpoints are normal -> historical split. Matching images do not identify the rendering cause.",
            "imageCheckSha256": digest(check_path), "summarySha256": digest(summary_path),
            "scriptSha256": digest(__file__), "captures": results,
            "stillUnmatched": sum(not any(c["changedPixels"] == 0 for c in r["normalComparisons"]) for r in results)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image_check")
    parser.add_argument("summary")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    Path(args.out).write_text(json.dumps(compare(args.image_check, args.summary), indent=2) + "\n")
