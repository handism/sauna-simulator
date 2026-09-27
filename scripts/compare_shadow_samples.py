#!/usr/bin/env python3
"""Compare PCSS sample counts in browser captures (docs/3d-qa/shadow-samples).

sweep: reads the `shadow-samples` attachments of e2e/shadow-samples.visual.ts (one Playwright
JSON report) and measures, per stage and lighting, each variant's CIELAB error against the
many-sample reference at the default view, and how that error changes from one frame of the
slow drag to the next (the screen-fixed sample rotation makes grain crawl, so this is the
flicker added by the filter; the reference's own residual noise is common to all variants).

pairs: matches JPEG/PNG captures by file name in a baseline, a candidate and a repeated
baseline directory (e.g. test-results/visual of scene-survey / cycles-compare / stage-compare
runs) and reports the change against the capture noise of the repeated baseline.

Requires NumPy and Pillow.
"""
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from PIL import Image


def lab(path):
    with Image.open(path) as image:
        rgb = np.asarray(image.convert("RGB"), dtype=np.float64) / 255
    linear = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    xyz = linear @ np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]).T
    xyz /= [0.95047, 1.0, 1.08883]
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def stats(delta):
    """Summary of per-pixel ΔE76 values."""
    return {
        "mean": round(float(delta.mean()), 4),
        "p99": round(float(np.percentile(delta, 99)), 3),
        "p999": round(float(np.percentile(delta, 99.9)), 3),
        "over2Percent": round(float((delta > 2).mean() * 100), 4),
    }


def results(suites):
    for suite in suites:
        for spec in suite.get("specs", []):
            for test in spec["tests"]:
                yield from test["results"]
        yield from results(suite.get("suites", []))


def load_report(path):
    raw = Path(path).read_text()
    return json.loads(raw[raw.index("\n{") + 1 :] if not raw.startswith("{") else raw)


def sweep(args):
    runs = {}
    for result in results(load_report(args.report)["suites"]):
        for item in result.get("attachments", []):
            if item["name"] == "shadow-samples":
                if result["status"] != "passed":
                    raise SystemExit("A capture did not pass; inspect the Playwright report first")
                record = json.loads(base64.b64decode(item["body"]))
                runs[record["label"]] = record
    missing = {"reference", "original", "half", "original-repeat"} - runs.keys()
    if missing:
        raise SystemExit(f"Missing variants: {sorted(missing)}")
    conditions = {}
    for frame in runs["reference"]["frames"]:
        conditions.setdefault((frame["stage"], frame["lighting"]), []).append(frame["file"])
    args.output.mkdir(parents=True, exist_ok=True)
    summary = {
        "browser": runs["reference"]["browser"],
        "viewport": runs["reference"]["viewport"],
        "samples": {label: run["samples"] for label, run in runs.items()},
        "conditions": [],
    }
    for (stage, lighting), files in conditions.items():
        frames = {label: [lab(Path(run["dir"]) / file) for file in files] for label, run in runs.items()}
        entry = {"stage": stage, "lighting": lighting, "frames": len(files)}
        entry["captureNoise"] = stats(np.linalg.norm(frames["original"][0] - frames["original-repeat"][0], axis=-1))
        entry["halfVsOriginal"] = stats(np.linalg.norm(frames["half"][0] - frames["original"][0], axis=-1))
        for label in ["original", "half", "original-repeat"]:
            errors = [f - r for f, r in zip(frames[label], frames["reference"])]
            entry[label] = {
                "stillVsReference": stats(np.linalg.norm(errors[0], axis=-1)),
                "flicker": stats(np.stack([np.linalg.norm(b - a, axis=-1) for a, b in zip(errors, errors[1:])])),
            }
        summary["conditions"].append(entry)
        # The 320x200 tile where the half-sample still differs most from the reference, at 2x.
        error = np.linalg.norm(frames["half"][0] - frames["reference"][0], axis=-1)
        tile = 320, 200
        error = error[: error.shape[0] // tile[1] * tile[1], : error.shape[1] // tile[0] * tile[0]]
        sums = error.reshape(error.shape[0] // tile[1], tile[1], error.shape[1] // tile[0], tile[0]).sum((1, 3))
        row, column = np.unravel_index(np.argmax(sums), sums.shape)
        box = (column * tile[0], row * tile[1], (column + 1) * tile[0], (row + 1) * tile[1])
        sheet = Image.new("RGB", (tile[0] * 2 * 3, tile[1] * 2))
        for index, label in enumerate(["reference", "original", "half"]):
            with Image.open(Path(runs[label]["dir"]) / files[0]) as image:
                crop = image.convert("RGB").crop(box).resize((tile[0] * 2, tile[1] * 2), Image.Resampling.NEAREST)
            sheet.paste(crop, (index * tile[0] * 2, 0))
        sheet.save(args.output / f"crop-{stage}-{lighting}.png")
        entry["crop"] = {"file": f"crop-{stage}-{lighting}.png", "box": [int(v) for v in box]}
    (args.output / "sweep.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(summary, ensure_ascii=False, indent=1))


def pairs(args):
    def index(root):
        return {p.name: p for p in Path(root).rglob("*") if p.suffix in {".jpg", ".png"}}

    base, candidate, repeat = index(args.baseline), index(args.candidate), index(args.repeat)
    views = {}
    for name in sorted(base.keys() & candidate.keys() & repeat.keys()):
        if args.prefix and not name.startswith(tuple(args.prefix)):
            continue
        a, b, c = lab(base[name]), lab(candidate[name]), lab(repeat[name])
        views[name] = {
            "change": stats(np.linalg.norm(b - a, axis=-1)),
            "captureNoise": stats(np.linalg.norm(c - a, axis=-1)),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"views": views}, ensure_ascii=False, indent=2) + "\n")
    print(f"{len(views)} views -> {args.output}")


parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
commands = parser.add_subparsers(required=True)
command = commands.add_parser("sweep")
command.add_argument("report", type=Path)
command.add_argument("output", type=Path)
command.set_defaults(run=sweep)
command = commands.add_parser("pairs")
command.add_argument("baseline", type=Path)
command.add_argument("candidate", type=Path)
command.add_argument("repeat", type=Path)
command.add_argument("output", type=Path)
command.add_argument("--prefix", action="append", help="only file names with this prefix (repeatable)")
command.set_defaults(run=pairs)
args = parser.parse_args()
args.run(args)
