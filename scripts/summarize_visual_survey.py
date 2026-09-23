"""Build review sheets from test:browser:visual's JSON report (requires Pillow)."""
import argparse
import base64
import json
from pathlib import Path

from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("report", type=Path)
parser.add_argument("output", type=Path)
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
    for item in result.get("attachments", []) if item["name"] == "survey"
)
if result["status"] != "passed":
    raise SystemExit("Capture did not pass; inspect the Playwright report first")
survey = json.loads(base64.b64decode(attachment["body"]))
root = Path(report["config"]["projects"][0]["outputDir"])
args.output.mkdir(parents=True, exist_ok=True)
for stage in ("sauna", "water", "totonou"):
    for lighting in ("day", "evening"):
        sheet = Image.new("RGB", (1600, 1644), "#182020")
        draw = ImageDraw.Draw(sheet)
        for heading in range(8):
            for row, pitch in enumerate(("level", "up", "down")):
                name = f"{stage}-{lighting}-{heading}-{pitch}.jpg"
                matches = list(root.rglob(name))
                if len(matches) != 1:
                    raise SystemExit(f"Expected one {name}, found {len(matches)}")
                x, y = heading % 4 * 400, (heading // 4 * 3 + row) * 274
                with Image.open(matches[0]) as source:
                    sheet.paste(source.resize((400, 250), Image.Resampling.LANCZOS), (x, y + 24))
                draw.text((x + 6, y + 6), f"{stage} {lighting} / {heading * .8 * 180 / 3.141592653589793:.1f} deg / {pitch}", fill="white")
        sheet.save(args.output / f"{stage}-{lighting}.jpg", quality=90)
survey["captureStatus"] = result["status"]
survey["durationMs"] = result["duration"]
survey["capturedAt"] = result["startTime"]
survey["visualReview"] = "See docs/3d-sauna-progress.md; capture success is not a quality approval."
(args.output / "survey.json").write_text(json.dumps(survey, indent=2) + "\n")
