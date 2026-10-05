"""Validate compile-batch diagnostics and compare final renderer images (not UI)."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def summarize(path):
    report = json.loads(Path(path).read_text())
    assert report["script"] == digest("scripts/diagnose_compile_batches.mjs"), "script changed"
    assert report["source"] == digest("src/components/3d/SaunaScene.tsx"), "scene changed"
    for file, expected in report["inputs"].items():
        assert digest(file) == expected, f"input changed: {file}"
    sizes, repeat = report["sizes"], report["repeat"]
    assert len(sizes) == len(set(sizes)) and 0 in sizes and repeat >= 2
    expected = [(r, b) for r in range(repeat) for b in (sizes if r % 2 == 0 else sizes[::-1])]
    rows = report["rows"]
    assert [(r["round"], r["batch"]) for r in rows] == expected, "incomplete or reordered run"
    assert len({r["nonce"] for r in rows}) == len(rows), "reused shader cache identity"
    images = {}
    for row in rows:
        assert not row["errors"], "browser errors"
        assert row["data"]["garden"] == "ready" and float(row["data"]["loadMs"]) > 0
        steps = row["steps"]
        if row["batch"]:
            assert steps and not steps[-1]["pending"], "unfinished warmup"
            assert all(0 <= s["newPipelines"] <= row["batch"] and s["ms"] >= 0 for s in steps)
            assert sum(s["newPipelines"] for s in steps) == row["pipelines"]
        else:
            assert not steps and row["pipelines"] == 0
        assert [s["stage"] for s in row["stages"]] == ["sauna", "water", "totonou"]
        for stage in row["stages"]:
            assert digest(stage["image"]) == stage["sha256"], "image changed"
            image = np.asarray(Image.open(stage["image"]).convert("RGB"), dtype=np.int16)
            assert image.shape == (1200, 1800, 3), "unexpected dimensions"
            images[row["round"], row["batch"], stage["stage"]] = image
    timings = {}
    for batch in sizes:
        selected = [r for r in rows if r["batch"] == batch]
        timings[batch] = {
            "loadMs": [float(r["data"]["loadMs"]) for r in selected],
            "longestTimerGapMs": [max(r["gaps"], default=0) for r in selected],
            "steps": [len(r["steps"]) for r in selected],
            "maxStepMs": [max((s["ms"] for s in r["steps"]), default=0) for r in selected],
            "interceptedPipelineKeys": [r["pipelines"] for r in selected],
        }
    comparisons = []
    for (round_, batch, stage), image in images.items():
        reference = images[0, 0, stage]
        delta = np.abs(image - reference)
        comparisons.append({"round": round_, "batch": batch, "stage": stage,
                            "changedPixels": int(np.any(delta, axis=2).sum()),
                            "maxChannelDelta": int(delta.max()), "meanChannelDelta": float(delta.mean())})
    return {"engine": report["engine"], "version": report["version"], "report": str(path),
            "reportSha256": digest(path), "timings": timings, "images": comparisons}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = {"note": "Timer gaps cover page initialization through garden-ready + 500ms, including time before entry. Instrumented fresh shaders; not product load times or FPS. Image comparisons use first baseline of each engine.",
              "runs": [summarize(path) for path in args.reports]}
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
