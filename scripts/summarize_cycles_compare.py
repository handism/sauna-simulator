"""Pair test:browser:visual's Cycles-camera captures with blender/renders (requires Pillow).

The renders come with the source data and are not tracked. Output: one Cycles | browser image
per camera and the capture record with the model hashes.
"""
import argparse
import base64
import json
from pathlib import Path

from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("report", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--renders", type=Path, default=Path(__file__).resolve().parents[1] / "blender/renders")
parser.add_argument("--width", type=int, default=900)
args = parser.parse_args()
raw = args.report.read_text()
# Bun's build output can precede the Playwright JSON reporter.
report = json.loads(raw[raw.index("\n{") + 1:] if not raw.startswith("{") else raw)


def results(suites):
    for suite in suites:
        for spec in suite.get("specs", []):
            for test in spec["tests"]:
                yield from test["results"]
        yield from results(suite.get("suites", []))


result, attachment = next(
    (result, item) for result in results(report["suites"])
    for item in result.get("attachments", []) if item["name"] == "cycles-compare"
)
if result["status"] != "passed":
    raise SystemExit("Capture did not pass; inspect the Playwright report first")
record = json.loads(base64.b64decode(attachment["body"]))
root = Path(report["config"]["projects"][0]["outputDir"])
args.output.mkdir(parents=True, exist_ok=True)
width, height = args.width, args.width * 2 // 3
for sample in record["samples"]:
    # Captures without a render of the same camera and lighting stay unpaired.
    if not sample["render"]:
        continue
    matches = list(root.rglob(sample["file"]))
    if len(matches) != 1:
        raise SystemExit(f"Expected one {sample['file']}, found {len(matches)}")
    sheet = Image.new("RGB", (width * 2, height + 24), "#182020")
    draw = ImageDraw.Draw(sheet)
    for column, (path, label) in enumerate([(args.renders / sample["render"], f"Cycles {sample['render']} / {sample['camera']}"),
                                            (matches[0], f"browser / {sample['stage']} view / {sample['lighting']}")]):
        with Image.open(path) as source:
            sheet.paste(source.convert("RGB").resize((width, height), Image.Resampling.LANCZOS), (column * width, 24))
        draw.text((column * width + 6, 6), label, fill="white")
    sheet.save(args.output / f"cycles-{Path(sample['render']).stem}.jpg", quality=88)
record["captureStatus"] = result["status"]
(args.output / "cycles-compare.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
