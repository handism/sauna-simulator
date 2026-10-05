"""Validate compile-batch diagnostics and compare final renderer images (not UI)."""

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def timeline(row):
    events = row["events"]
    assert events[0]["phase"] == "before-entry" and events[-1]["phase"] == "measurement-end"
    assert all(math.isfinite(e["at"]) and e["at"] >= 0 for e in events), "invalid phase time"
    assert all(a["at"] <= b["at"] for a, b in zip(events, events[1:])), "reordered phases"
    phases = [e["phase"] for e in events]
    required = ["entry-click", "fetch-body", "prepare-probes", "parse-body", "prepare-body",
                "compile-body", "first-view", "first-full-draw", "body-ready", "fetch-garden",
                "parse-garden", "prepare-garden", "compile-garden", "add-garden", "garden-ready",
                "first-garden-draw", "garden-drawn"]
    cursor = 0
    for phase in required:
        cursor = phases.index(phase, cursor) + 1
    assert ("batch-warmup" in phases) == bool(row["batch"])
    assert set(phases) == set(required + ["before-entry", "measurement-end"] + (["batch-warmup"] if row["batch"] else [])), "unknown phases"
    end = events[-1]["at"]
    assert all(a["end"] <= b["start"] for a, b in zip(row["steps"], row["steps"][1:])), "overlapping steps"
    for step in row["steps"]:
        assert 0 <= step["start"] <= step["end"] <= end
        assert abs(step["ms"] - (step["end"] - step["start"])) < 1
        assert step["drawMs"] >= 0 and step["drainMs"] >= 0
        assert abs(step["ms"] - step["drawMs"] - step["drainMs"]) < 1
    for key in ["intervals", "slowCalls"]:
        for sample in row[key]:
            assert math.isfinite(sample["ms"]), "invalid interval"
            assert 0 <= sample["start"] <= sample["end"] <= end
            assert abs(sample["ms"] - (sample["end"] - sample["start"])) < 1 and sample["ms"] > 100
    assert [s["ms"] for s in row["intervals"] if s["kind"] == "timer"] == row["gaps"]
    spans = [{"phase": a["phase"], "start": a["at"], "end": b["at"], "ms": b["at"] - a["at"]}
             for a, b in zip(events, events[1:])]
    # Callback phase is merely its endpoint. Attribute a gap to every phase it overlaps.
    intervals = []
    for sample in row["intervals"]:
        overlap = [{"phase": span["phase"], "ms": min(sample["end"], span["end"]) - max(sample["start"], span["start"])}
                   for span in spans if min(sample["end"], span["end"]) > max(sample["start"], span["start"])]
        intervals.append({**sample, "overlaps": overlap,
                          "warmupStepOverlapMs": sum(max(0, min(sample["end"], step["end"]) - max(sample["start"], step["start"]))
                                                     for step in row["steps"])})
    longest = {kind: max((s for s in intervals if s["kind"] == kind), key=lambda s: s["ms"], default=None)
               for kind in ["timer", "raf"]}
    return {"round": row["round"], "batch": row["batch"], "phases": spans, "longestIntervals": longest,
            "intervalsOverOneSecond": [s for s in intervals if s["ms"] > 1000],
            "outsideWarmupIntervalsOverHalfSecond": [s for s in intervals if s["ms"] > 500 and s["warmupStepOverlapMs"] == 0],
            "slowCalls": row["slowCalls"],
            "maxDrawMs": max((s["drawMs"] for s in row["steps"]), default=0),
            "maxDrainMs": max((s["drainMs"] for s in row["steps"]), default=0)}


def summarize(path):
    report = json.loads(Path(path).read_text())
    assert report["schema"] == 2, "timeline schema required"
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
    timelines = []
    for row in rows:
        timelines.append(timeline(row))
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
            "reportSha256": digest(path), "timings": timings, "images": comparisons, "timelines": timelines}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = {"note": "Timer gaps cover page initialization through garden-ready + 500ms, including time before entry; phase attribution uses interval overlaps, not callback labels. Nested slow WebGL calls overlap and must not be summed. Instrumented fresh shaders; not product load times or FPS. Image comparisons use first baseline of each engine.",
              "runs": [summarize(path) for path in args.reports]}
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
