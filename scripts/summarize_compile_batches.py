"""Validate compile-batch diagnostics and compare canvas-locator captures."""

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pixel_delta(before, after):
    assert before.shape == after.shape, "capture dimensions changed"
    delta = np.abs(after.astype(np.int16) - before.astype(np.int16))
    ys, xs = np.where(np.any(delta, axis=2))
    return {"changedPixels": len(xs), "maxChannelDelta": int(delta.max()),
            "pixels": [{"x": int(x), "y": int(y), "before": before[y, x].tolist(),
                        "after": after[y, x].tolist()} for y, x in zip(ys[:32], xs[:32])],
            "pixelsTruncated": len(xs) > 32}


def stability_images(stage):
    samples = stage.get("stability", [])
    assert [s["frames"] for s in samples] == [70, 140], "missing or reordered stability captures"
    captures = [stage, *samples]
    assert len({s["image"] for s in captures}) == 3, "shared stability capture"
    images = []
    for sample in captures:
        assert digest(sample["image"]) == sample["sha256"], "stability image changed"
        image = np.asarray(Image.open(sample["image"]).convert("RGB"))
        assert image.shape == (1200, 1800, 3), "unexpected stability dimensions"
        images.append(image)
    return images


def normalized(key):
    """The draw-state key without the blend factors when blending is off (they cost no pipeline)."""
    program, formats, blend, src, dst, depth, color, coverage = json.loads(key)
    return json.dumps([program, formats, blend, src if blend else None, dst if blend else None, depth, color, coverage])


def new_heavy_keys(row):
    """Heavy draw states by the phase that first submitted them: raw, and blend factors ignored."""
    raw, seen, real = {}, set(), {}
    for item in row["newKeys"]:
        if not item["heavy"]:
            continue
        raw[item["phase"]] = raw.get(item["phase"], 0) + 1
        key = normalized(item["key"])
        if key not in seen:
            seen.add(key)
            real[item["phase"]] = real.get(item["phase"], 0) + 1
    return raw, real


def deferred_heavy_states(row, chars=None):
    """New heavy states outside warmup, excluding inert blend-factor differences. With `chars`,
    every program longer than that counts (the warmup's 60,000 also takes in the shadow mask)."""
    seen, deferred = set(), []
    programs = {p["id"]: p for p in row["programs"]}
    for item in row["newKeys"]:
        if not (item["heavy"] if chars is None else programs[item["program"]]["chars"] > chars):
            continue
        key = normalized(item["key"])
        if key in seen:
            continue
        seen.add(key)
        if item["phase"] not in ("visibility-warmup", "garden-warmup", "batch-warmup"):
            deferred.append({"phase": item["phase"], "program": programs[item["program"]], "key": json.loads(key)})
    return deferred


def label(row):
    """A condition name, with cached loads (SUI_WARM) told apart from their cold load."""
    return row["condition"] + ("-warm" if row["warm"] else "")


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
    # The product's warmup (condition w) marks the same phases but logs no steps.
    visible = bool(row["visibility"]) or row["product"]
    assert ("visibility-warmup" in phases) == visible and ("garden-warmup" in phases) == visible
    if visible:
        # The warmup sits between the first-view mark and its repeat before the real first view.
        warm = phases.index("visibility-warmup")
        assert phases.index("compile-body") < warm < phases.index("first-view", warm) < phases.index("first-full-draw")
        assert phases.index("add-garden") < phases.index("garden-warmup") < phases.index("garden-ready")
    optional = ((["batch-warmup"] if row["batch"] else []) + (["prefetch"] if row["prefetch"] else [])
                + (["visibility-warmup", "garden-warmup"] if visible else []))
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
            assert draw["step"] == index
            assert draw["phase"] in (["visibility-warmup", "garden-warmup"] if visible else ["batch-warmup"])
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
    spans_by_phase = {span["phase"]: span for span in spans}
    raw_keys, real_keys = new_heavy_keys(row)
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
    return {"round": row["round"], "condition": row["condition"], "warm": row["warm"], "budget": row["budget"],
            "deferredHeavyStates": deferred_heavy_states(row),
            # The warmup's own threshold: the materials and the shadow mask (~73,000 characters).
            "deferredWarmupClassStates": deferred_heavy_states(row, 60000),
            "batch": row["batch"], "visibility": row["visibility"],
            "stepLabels": [{"label": s["label"], "ms": s["ms"], "yielded": s.get("yielded"), "drawMs": s["drawMs"], "drainMs": s["drainMs"],
                            "newKeys": s["newKeys"], "newHeavyKeys": s["newHeavyKeys"]} for s in row["steps"]],
            "warmupGroups": row["groups"],
            "unreachableGroups": sorted({u["key"] for g in row["groups"] for u in g["unreachable"]}),
            "warmupViews": [{"label": g["label"], "view": g["view"], "groups": len(g["groups"]),
                             "drawnMain": sum(1 for x in g["groups"] if x["drawn"] and "main" in x["drawn"]),
                             "drawnMirror": sum(1 for x in g["groups"] if x["drawn"] and "mirror" in x["drawn"]),
                             "steps": sum(1 for st in row["steps"] if row["multi"] and st["label"].split(":")[:2] == [g["label"], g["view"]])}
                            for g in row["groups"]],
            "newHeavyKeysByPhase": raw_keys, "newHeavyPipelinesByPhase": real_keys,
            "firstGardenDrawMs": spans_by_phase["first-garden-draw"]["ms"], "prefetch": row["prefetch"], "incremental": row["incremental"], "fence": row["fence"], "all": row["all"], "phases": spans,
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
    assert report["schema"] == 11, "schema with the product warmup required"
    assert report["entry"] in ("sauna", "water", "totonou")
    assert report["quality"] in ("low", "standard", "high") and report["lighting"] in ("day", "evening", "night")
    assert isinstance(report["hold"], bool)
    assert report["script"] == digest("scripts/diagnose_compile_batches.mjs"), "script changed"
    assert report["source"] == digest("src/components/3d/SaunaScene.tsx"), "scene changed"
    scratch = Path(report["scratch"]) / "src/components/3d"
    assert digest(scratch / "SaunaScene.tsx") == report["temporarySource"], "temporary scene changed"
    assert digest(scratch / "hdrOutput.ts") == report["temporaryOutput"], "temporary output changed"
    for file, expected in report["inputs"].items():
        assert digest(file) == expected, f"input changed: {file}"
    sizes, repeat = report["sizes"], report["repeat"]
    assert len(sizes) == len(set(sizes)) and "0" in sizes and repeat >= 2
    passes = [False, True] if report["warm"] else [False]
    expected = [(r, b, w) for r in range(repeat) for b in (sizes if r % 2 == 0 else sizes[::-1]) for w in passes]
    rows = report["rows"]
    assert [(r["round"], r["condition"], r["warm"]) for r in rows] == expected, "incomplete or reordered run"
    for row in rows:
        assert row["entry"] == report["entry"]
        assert row["offscreen"] == row["condition"].startswith("o")
        assert row["multi"] == row["condition"].lstrip("o").startswith("m")
        assert row["selective"] == row["condition"].lstrip("o").startswith("ms")
        assert row["data"]["quality"] == report["quality"]
        assert float(row["data"]["timeOfDay"]) == {"day": 0, "evening": 1, "night": 2}[report["lighting"]]
        if row["product"]:
            assert row["condition"] == "w" and row["visibility"] == row["batch"] == row["budget"] == 0
            assert not (row["prefetch"] or row["all"] or row["incremental"] or row["fence"] or row["groups"])
            data = row["data"]
            assert data["warmup"] == "split" and "warmupRestarts" not in data, "product warmup did not run once"
            assert int(data["warmupSteps"]) > 0 and int(data["gardenWarmupSteps"]) > 0
        elif row["condition"].lstrip("oms").startswith("v"):
            visibility, budget = re.fullmatch(r"o?(?:ms?)?v(\d+)(?:b(\d+))?", row["condition"]).groups()
            assert row["visibility"] == int(visibility) > 0 and row["batch"] == 0
            assert row["budget"] == int(budget or 0)
            assert not (row["prefetch"] or row["all"] or row["incremental"] or row["fence"])
        else:
            assert row["data"].get("warmup", "off") == "off"
            assert row["prefetch"] == row["condition"].startswith("p") and row["batch"] == int(row["condition"].lstrip("pfia"))
            assert row["all"] == ("a" in row["condition"]) and row["incremental"] == ("i" in row["condition"])
            assert row["visibility"] == 0 and row["budget"] == 0 and not row["groups"]
        # Every submitted draw state is logged once, with the hook's own heaviness and a valid key.
        keys = [k["key"] for k in row["newKeys"]]
        assert keys and len(keys) == len(set(keys)), "duplicate new-key log"
        assert all(normalized(k) for k in keys)
        programs = {p["id"]: p for p in row["programs"]}
        assert all(k["program"] in programs and json.loads(k["key"])[0] == k["program"]
                   and k["heavy"] == (programs[k["program"]]["chars"] > 160000)
                   for k in row["newKeys"]), "invalid new-key program"
        assert all(a["at"] <= b["at"] for a, b in zip(row["newKeys"], row["newKeys"][1:])), "reordered new keys"
        assert {k["phase"] for k in row["newKeys"]} <= {e["phase"] for e in row["events"]} | {"stage-sauna", "stage-water", "stage-totonou"}
        assert row["fence"] == ("f" in row["condition"]) and not row["keyMismatches"], "tracked key differs from queried key"
    # Only a cached load reuses its cold load's shader identity.
    nonces = {}
    for row in rows:
        nonces.setdefault(row["nonce"], []).append((row["round"], row["condition"], row["warm"]))
    assert all(ids == [(ids[0][0], ids[0][1], w) for w in passes] for ids in nonces.values()), "reused shader cache identity"
    images = {}
    stability = []
    settled_images = {}
    timelines = []
    retained = []
    for row in rows:
        timelines.append(timeline(row))
        assert not row["errors"], "browser errors"
        assert row["data"]["garden"] == "ready" and float(row["data"]["loadMs"]) > 0
        assert row["data"]["stage"] == report["entry"]
        if row["offscreen"] or row["product"]:
            assert row["data"]["hdr"] == "true", "offscreen run without HDR"
            assert not row["presentationWrites"], "partial warmup wrote to canvas"
        samples = row["samples"]
        if report["hold"] and row["offscreen"]:
            assert len(samples) >= 3 and samples[0]["label"] == "garden:before" and samples[-1]["label"] == "garden:restored", "missing retained-image samples"
            assert [s["label"] for s in samples[1:-1]] == [s["label"] for s in row["steps"] if s["label"].startswith("garden:") and s["yielded"]], "missing yielded-step capture"
            reference = None
            for sample in samples:
                assert digest(sample["image"]) == sample["sha256"], "retained image changed"
                image = np.asarray(Image.open(sample["image"]).convert("RGB"), dtype=np.int16)
                assert image.shape == (1200, 1800, 3)
                if reference is None:
                    reference = image
                delta = np.abs(image - reference)
                retained.append({"round": row["round"], "condition": row["condition"], "warm": row["warm"], "label": sample["label"],
                                 "changedPixels": int(np.any(delta, axis=2).sum()), "maxChannelDelta": int(delta.max())})
        else:
            assert not samples, "unexpected retained-image capture"
        steps = row["steps"]
        if row["visibility"]:
            # No draw is gated: the steps only choose visible materials; mirror steps that drew
            # nothing are not waited for, so they are absent.
            assert steps and row["pipelines"] == 0 and all(s["newPipelines"] == 0 and s["polls"] is None for s in steps)
            assert all(s["label"].split(":")[0] in ("body", "garden") and s["skippedDraws"] == 0 for s in steps)
            stages = ["sauna", "water", "totonou"]
            views = ([report["entry"]] + [s for s in stages if s != report["entry"]]) if row["multi"] else [report["entry"]]
            assert [(g["label"], g["view"]) for g in row["groups"]] == [(l, v) for l in ("body", "garden") for v in views]
            # Only s records groups that no pass renders, and it never steps them.
            assert all(row["selective"] or not g["unreachable"] for g in row["groups"])
            assert all(not {u["key"] for u in g["unreachable"]} & {x["key"] for x in g["groups"]} for g in row["groups"])
            if row["multi"]:
                # A group returns in a later view only while a pass has not drawn it yet. With s,
                # only the passes that can draw it count (recorded per view, never shrinking).
                done, needs = set(), {}
                for group in row["groups"]:
                    for g in group["groups"]:
                        assert g["key"] not in done, "fully drawn group stepped again"
                        assert set(g["drawn"]) <= {"main", "mirror"}
                        if row["selective"]:
                            assert g["needs"] and set(g["needs"]) <= {"main", "mirror"}
                            assert set(needs.get(g["key"], [])) <= set(g["needs"]), "needs shrank"
                            needs[g["key"]] = g["needs"]
                        else:
                            assert g["needs"] is None
                        if set(g["drawn"]) >= set(g["needs"] or ["main", "mirror"]):
                            done.add(g["key"])
                assert all(s["label"].split(":")[1] in stages for s in steps)
            else:
                warmed = [g["key"] for group in row["groups"] for g in group["groups"]]
                assert len(warmed) == len(set(warmed)), "group warmed twice"
                assert all(g["drawn"] is None and g["needs"] is None for group in row["groups"] for g in group["groups"])
            assert sum(s["newHeavyKeys"] for s in steps) == sum(1 for k in row["newKeys"] if k["heavy"] and k["step"] is not None)
            # Without a budget every step yields.
            assert all(isinstance(s["yielded"], bool) for s in steps)
            assert row["budget"] or all(s["yielded"] for s in steps)
        elif row["batch"]:
            assert steps and not steps[-1]["pending"], "unfinished warmup"
            assert all(0 <= s["newPipelines"] <= row["batch"] and s["ms"] >= 0 for s in steps)
            assert sum(s["newPipelines"] for s in steps) == row["pipelines"]
            assert all(s["skippedDraws"] >= 0 for s in steps)
            # Fence steps poll once per frame; readback steps never poll.
            assert all((s["polls"] is not None) == row["fence"] and (s["polls"] is None or 0 <= s["polls"] < 1200) for s in steps)
            assert row["incremental"] or not any(s["skippedDraws"] for s in steps), "skipped without i"
            if row["incremental"] and row["all"]:
                # Every program is gated: only the first draw of each new state is submitted.
                assert all(len(s["draws"]) == s["newPipelines"] for s in steps), "redrew an admitted state"
        else:
            assert not steps and row["pipelines"] == 0
        stages = ["sauna", "water", "totonou"]
        start = stages.index(report["entry"])
        assert [s["stage"] for s in row["stages"]] == stages[start:] + stages[:start]
        for stage in row["stages"]:
            assert digest(stage["image"]) == stage["sha256"], "image changed"
            image = np.asarray(Image.open(stage["image"]).convert("RGB"), dtype=np.int16)
            assert image.shape == (1200, 1800, 3), "unexpected dimensions"
            images[row["round"], label(row), stage["stage"]] = image
            if report.get("captureStability", False):
                initial, first, final = stability_images(stage)
                settled_images[row["round"], label(row), stage["stage"]] = final
                stability.append({"round": row["round"], "condition": label(row), "stage": stage["stage"],
                                  "captures": [{"image": s["image"], "sha256": s["sha256"], "additionalFrames": s.get("frames", 0)}
                                               for s in [stage, *stage["stability"]]],
                                  "initialTo70": pixel_delta(initial, first), "frames70To140": pixel_delta(first, final)})
            else:
                assert not stage.get("stability"), "undeclared stability captures"
    timings = {}
    for condition in [c + suffix for c in sizes for suffix in (["", "-warm"] if report["warm"] else [""])]:
        selected = [r for r in rows if label(r) == condition]
        timings[condition] = {
            "loadMs": [float(r["data"]["loadMs"]) for r in selected],
            "longestTimerGapMs": [max(r["gaps"], default=0) for r in selected],
            "steps": [len(r["steps"]) for r in selected],
            "yields": [sum(1 for s in r["steps"] if s.get("yielded")) for r in selected],
            "warmupPhaseMs": [sum(t["ms"] for t in r_t["phases"] if t["phase"] in ("visibility-warmup", "garden-warmup"))
                              for r_t in [t for t in timelines if label(t) == condition]],
            "maxStepMs": [max((s["ms"] for s in r["steps"]), default=0) for r in selected],
            "interceptedPipelineKeys": [r["pipelines"] for r in selected],
            "firstStepMs": [r["steps"][0]["ms"] if r["steps"] else 0 for r in selected],
            "stepSumMs": [sum(s["ms"] for s in r["steps"]) for r in selected],
            "laterStepMedianMs": [float(np.median([s["ms"] for s in r["steps"][1:]])) if len(r["steps"]) > 1 else 0 for r in selected],
            "laterStepP90Ms": [float(np.percentile([s["ms"] for s in r["steps"][1:]], 90)) if len(r["steps"]) > 1 else 0 for r in selected],
            "longestTimerGapAfterFirstStepMs": [max((s["ms"] for s in r["intervals"] if s["kind"] == "timer" and r["steps"] and s["start"] >= r["steps"][0]["end"]), default=0) for r in selected],
            "maxStepDrawMs": [max((s["drawMs"] for s in r["steps"]), default=0) for r in selected],
            "maxStepWaitMs": [max((s["drainMs"] for s in r["steps"]), default=0) for r in selected],
            "drainMedianMs": [float(np.median([s["drainMs"] for s in r["steps"]])) if r["steps"] else 0 for r in selected],
            "submittedDraws": [sum(len(s["draws"]) for s in r["steps"]) for r in selected],
            "skippedDraws": [sum(s["skippedDraws"] for s in r["steps"]) for r in selected],
            "prefetchedPrograms": [len(r["prefetches"]) for r in selected],
            "prefetchMaxGetUniformsMs": [max((p["ms"] for p in r["prefetches"]), default=0) for r in selected],
            "prefetchSumGetUniformsMs": [sum(p["ms"] for p in r["prefetches"]) for r in selected],
            "firstGardenDrawMs": [t["firstGardenDrawMs"] for t in timelines if label(t) == condition],
            "newHeavyPipelinesByPhase": [t["newHeavyPipelinesByPhase"] for t in timelines if label(t) == condition],
            "newHeavyKeysByPhase": [t["newHeavyKeysByPhase"] for t in timelines if label(t) == condition],
            "deferredHeavyStates": [len(t["deferredHeavyStates"]) for t in timelines if label(t) == condition],
            "deferredWarmupClassStates": [len(t["deferredWarmupClassStates"]) for t in timelines if label(t) == condition],
            # The product's own counts (condition w): steps that drew, and groups no view drew.
            **({key: [int(r["data"][key]) for r in selected]
                for key in ["warmupSteps", "warmupUndrawn", "warmupMs", "gardenWarmupSteps", "gardenWarmupUndrawn"]}
               if condition.startswith("w") else {}),
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
            "entry": report["entry"], "quality": report["quality"], "lighting": report["lighting"], "hold": report["hold"], "timingComparisonValid": not report["hold"], "retainedImages": retained,
            "reportSha256": digest(path), "timings": timings, "images": compare(0), "imagesVsLastBaseline": compare(repeat - 1),
            "captureStability": stability,
            "settledComparisons": [{"round": r, "condition": c, "stage": s, "baselineRound": baseline,
                                    **pixel_delta(settled_images[baseline, "0", s], im)}
                                   for (r, c, s), im in settled_images.items() for baseline in (0, repeat - 1)],
            "timelines": timelines}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+")
    parser.add_argument("--out", required=True)
    parser.add_argument("--brief", action="store_true",
                        help="per load only the verdicts (deferred states, steps, gaps, unreachable groups), not the timelines")
    args = parser.parse_args()
    # Each capture belongs to one report; a shared path means a later run overwrote it.
    paths = [item["image"] for path in args.reports for row in json.loads(Path(path).read_text())["rows"]
             for item in row["stages"] + row["samples"] + [s for stage in row["stages"] for s in stage.get("stability", [])]]
    assert len(paths) == len(set(paths)), "capture shared between runs"
    result = {"note": "Loading windows begin just before selecting 3D from the entry stage and end at garden-ready + 500ms. SUI_HOLD runs contain deliberate compositor waits/screenshots: timingComparisonValid is false, so their load times/intervals are not performance comparisons. Phase attribution uses overlaps; nested slow calls must not be summed. Fresh instrumented shaders; not product load times or FPS. Images compare both the first/final baseline of each engine and entry; retainedImages compares the paused compositor image across garden warmup.",
              "runs": [summarize(path) for path in args.reports]}
    if args.brief:
        kept = ["round", "condition", "warm", "deferredHeavyStates", "deferredWarmupClassStates", "unreachableGroups",
                "warmupViews", "newHeavyPipelinesByPhase", "longestIntervals", "outsideWarmupIntervalsOverHalfSecond"]
        for run in result["runs"]:
            run["timelines"] = [{key: t[key] for key in kept} for t in run["timelines"]]
            for t in run["timelines"]:
                for key in ["deferredHeavyStates", "deferredWarmupClassStates"]:
                    t[key] = [{"phase": d["phase"], "program": d["program"]["name"], "key": d["key"]} for d in t[key]]
    Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
