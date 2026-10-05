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
    assert ("prefetch" in phases) == row["prefetch"]
    optional = (["batch-warmup"] if row["batch"] else []) + (["prefetch"] if row["prefetch"] else [])
    assert set(phases) == set(required + ["before-entry", "measurement-end"] + optional), "unknown phases"
    if row["prefetch"]:
        assert phases.index("prefetch") < phases.index("first-view", phases.index("prefetch"))
    end = events[-1]["at"]
    programs = {p["id"]: p for p in row["programs"]}
    assert len(programs) == len(row["programs"]) and programs, "missing/duplicate programs"
    assert all(p["chars"] > 0 and p["name"] and isinstance(p["defines"], list) for p in programs.values())
    def validate_draw(draw):
        assert draw["program"] in programs, "unknown draw program"
        assert 0 <= draw["start"] <= draw["end"] <= end
        assert draw["sequence"] > 0
    for index, step in enumerate(row["steps"]):
        for draw in step["draws"]:
            validate_draw(draw)
            assert draw["step"] == index and draw["phase"] == "batch-warmup"
            assert step["start"] <= draw["start"] <= draw["end"] <= step["end"]
        assert all(a["sequence"] < b["sequence"] for a, b in zip(step["draws"], step["draws"][1:]))
    assert all(a["end"] <= b["start"] for a, b in zip(row["programQueries"], row["programQueries"][1:])), "overlapping program queries"
    for call in row["slowCalls"] + row["programQueries"]:
        assert 0 <= call["start"] <= call["end"] <= end and math.isfinite(call["ms"])
        assert abs(call["ms"] - (call["end"] - call["start"])) < 1
        assert all(call.get(key) is None or call[key] in programs for key in ["subjectProgram", "boundProgram"])
        assert len(call["precedingDraws"]) <= 8
        for draw in call["precedingDraws"]:
            validate_draw(draw)
            assert draw["end"] <= call["start"], "draw is not preceding the call"
    assert all(a["end"] <= b["start"] for a, b in zip(row["steps"], row["steps"][1:])), "overlapping steps"
    prefetches = row["prefetches"]
    assert bool(prefetches) == row["prefetch"], "missing prefetch"
    assert len({p["program"] for p in prefetches}) == len(prefetches), "program prefetched twice"
    for item in prefetches:
        assert item["program"] in programs
        assert 0 <= item["start"] <= item["readyAt"] <= item["end"] <= end and item["frames"] >= 0
        assert abs(item["ms"] - (item["end"] - item["readyAt"])) < 1
    assert all(a["end"] <= b["start"] for a, b in zip(prefetches, prefetches[1:])), "overlapping prefetches"
    assert not prefetches or not row["steps"] or prefetches[-1]["end"] <= row["steps"][0]["start"], "prefetch after warmup"
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
                                                     for step in row["steps"]),
                          "prefetchOverlapMs": sum(max(0, min(sample["end"], item["end"]) - max(sample["start"], item["start"]))
                                                   for item in prefetches)})
    longest = {kind: max((s for s in intervals if s["kind"] == kind), key=lambda s: s["ms"], default=None)
               for kind in ["timer", "raf"]}
    first_queries = [c for c in row["programQueries"] if row["steps"] and row["steps"][0]["start"] <= c["start"] <= row["steps"][0]["end"]]
    first_draws = {}
    for draw in row["steps"][0]["draws"] if row["steps"] else []:
        group = first_draws.setdefault(draw["program"], {"program": draw["program"], "count": 0, "firstDraw": draw})
        group["count"] += 1
        group["lastDraw"] = draw
    # Draw-time info queries for programs whose link info was already fetched would mean the
    # prefetch did not move that work; programs created by the first draw are expected here.
    prefetched = {p["program"] for p in prefetches}
    later = [c for c in row["programQueries"] if c["start"] > (prefetches[-1]["end"] if prefetches else -1)]
    assert not prefetched & {c["subjectProgram"] for c in later}, "prefetched program queried again"
    return {"round": row["round"], "condition": row["condition"], "batch": row["batch"], "prefetch": row["prefetch"], "all": row["all"], "phases": spans,
            "prefetches": prefetches,
            "prefetchedHeavyPrograms": sorted(p for p in prefetched if programs[p]["chars"] > 160000),
            "prefetchMaxGetUniformsMs": max((p["ms"] for p in prefetches), default=0),
            "prefetchSumGetUniformsMs": sum(p["ms"] for p in prefetches),
            "prefetchMaxReadyFrames": max((p["frames"] for p in prefetches), default=0),
            "prefetchSpanMs": prefetches[-1]["end"] - prefetches[0]["start"] if prefetches else 0,
            "programQueriesAfterPrefetch": [{"program": c["subjectProgram"], "ms": c["ms"], "start": c["start"]} for c in later], "longestIntervals": longest,
            "intervalsOverOneSecond": [s for s in intervals if s["ms"] > 1000],
            "outsideWarmupIntervalsOverHalfSecond": [s for s in intervals if s["ms"] > 500 and s["warmupStepOverlapMs"] == 0],
            "slowCalls": row["slowCalls"], "programs": row["programs"],
            "firstStepDraws": list(first_draws.values()),
            "firstStepProgramQueries": first_queries,
            "firstStepProgramQueryMs": sum(c["ms"] for c in first_queries),
            "firstStepHeavyProgramsQueried": sorted({c["subjectProgram"] for c in first_queries if programs[c["subjectProgram"]]["chars"] > 160000}),
            "firstStepHeavyProgramsDrawn": sorted({p for p in first_draws if programs[p]["chars"] > 160000}),
            "maxDrawMs": max((s["drawMs"] for s in row["steps"]), default=0),
            "maxDrainMs": max((s["drainMs"] for s in row["steps"]), default=0)}


def summarize(path):
    report = json.loads(Path(path).read_text())
    assert report["schema"] == 4, "prefetch schema required"
    assert report["script"] == digest("scripts/diagnose_compile_batches.mjs"), "script changed"
    assert report["source"] == digest("src/components/3d/SaunaScene.tsx"), "scene changed"
    for file, expected in report["inputs"].items():
        assert digest(file) == expected, f"input changed: {file}"
    sizes, repeat = report["sizes"], report["repeat"]
    assert len(sizes) == len(set(sizes)) and "0" in sizes and repeat >= 2
    expected = [(r, b) for r in range(repeat) for b in (sizes if r % 2 == 0 else sizes[::-1])]
    rows = report["rows"]
    assert [(r["round"], r["condition"]) for r in rows] == expected, "incomplete or reordered run"
    for row in rows:
        assert row["prefetch"] == row["condition"].startswith("p") and row["batch"] == int(row["condition"].lstrip("pa"))
        assert row["all"] == ("a" in row["condition"])
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
            images[row["round"], row["condition"], stage["stage"]] = image
    timings = {}
    for condition in sizes:
        selected = [r for r in rows if r["condition"] == condition]
        timings[condition] = {
            "loadMs": [float(r["data"]["loadMs"]) for r in selected],
            "longestTimerGapMs": [max(r["gaps"], default=0) for r in selected],
            "steps": [len(r["steps"]) for r in selected],
            "maxStepMs": [max((s["ms"] for s in r["steps"]), default=0) for r in selected],
            "interceptedPipelineKeys": [r["pipelines"] for r in selected],
            "firstStepMs": [r["steps"][0]["ms"] if r["steps"] else 0 for r in selected],
            "stepSumMs": [sum(s["ms"] for s in r["steps"]) for r in selected],
            "prefetchedPrograms": [len(r["prefetches"]) for r in selected],
            "prefetchMaxGetUniformsMs": [max((p["ms"] for p in r["prefetches"]), default=0) for r in selected],
            "prefetchSumGetUniformsMs": [sum(p["ms"] for p in r["prefetches"]) for r in selected],
        }
    def compare(reference_round):
        comparisons = []
        for (round_, condition, stage), image in images.items():
            delta = np.abs(image - images[reference_round, "0", stage])
            comparisons.append({"round": round_, "condition": condition, "stage": stage,
                                "changedPixels": int(np.any(delta, axis=2).sum()),
                                "maxChannelDelta": int(delta.max()), "meanChannelDelta": float(delta.mean())})
        return comparisons
    return {"engine": report["engine"], "version": report["version"], "report": str(path),
            "reportSha256": digest(path), "timings": timings, "images": compare(0), "imagesVsLastBaseline": compare(repeat - 1), "timelines": timelines}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    result = {"note": "Timer gaps cover page initialization through garden-ready + 500ms, including time before entry; phase attribution uses interval overlaps, not callback labels. Nested slow WebGL calls overlap and must not be summed. Instrumented fresh shaders; not product load times or FPS. Image comparisons use both the first and final baseline of each engine.",
              "runs": [summarize(path) for path in args.reports]}
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
