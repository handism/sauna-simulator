"""Archive real-time lighting recordings and their observations (not a visual/FPS verdict).

python3 scripts/summarize_auto_motion.py <Playwright JSON> <output directory>
Requires ffmpeg, ffprobe and Pillow. Videos and review sheets remain local.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw
from summarize_sun_shadow import results


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--warmup', choices=['normal', 'split'], default='normal')
    args = parser.parse_args()
    raw = args.report.read_text()
    report = json.loads(raw[raw.index('\n{') + 1:] if not raw.startswith('{') else raw)
    if report['errors'] or any(report['stats'][k] for k in ['unexpected', 'skipped', 'flaky']):
        raise SystemExit('Incomplete run')
    runs = []
    for result in results(report['suites']):
        if result['status'] != 'passed':
            raise SystemExit('Failed recording')
        attachments = result.get('attachments', [])
        data = [a for a in attachments if a['name'] == 'auto-lighting-motion']
        video = [a for a in attachments if a['name'] == 'video']
        if len(data) != 1 or len(video) != 1:
            raise SystemExit('Missing or duplicate recording')
        run = json.loads(base64.b64decode(data[0]['body']))
        if run.get('warmup', 'normal') != args.warmup:
            raise SystemExit('Unexpected warmup mode')
        if args.warmup == 'split' and any(
            sample['data'].get(key) != value
            for sample in run['samples']
            for key, value in [('warmup', 'split'), ('warmupUndrawn', '0'), ('gardenWarmupUndrawn', '0')]
        ):
            raise SystemExit('Incomplete split warmup')
        if run['errors'] or not run['samples']:
            raise SystemExit('Browser error or missing samples')
        for path, digest in run['hashes'].items():
            if sha(path) != digest:
                raise SystemExit(f'Input changed since recording: {path}')
        runs.append((run, Path(video[0]['path'])))
    if sorted((r['stage'], r['minute']) for r, _ in runs) != [('totonou', 27), ('water', 12)]:
        raise SystemExit('Missing or duplicate condition')
    for key in ['hashes', 'browser', 'viewport', 'quality']:
        if runs[0][0][key] != runs[1][0][key]:
            raise SystemExit(f'Mismatched {key}')
    args.output.mkdir(parents=True, exist_ok=True)
    summary = dict(warmup=args.warmup, reportSha256=sha(args.report), startedAt=report['stats']['startTime'],
                   testDurationSeconds=report['stats']['duration'] / 1000,
                   limits='Video encoding is overhead. Extracted frames are a partial review, not continuous perceptual or FPS approval.',
                   runs=[])
    for run, source in runs:
        name = f"{run['stage']}-{run['minute']}"
        dest = args.output / f'{name}.webm'
        shutil.copyfile(source, dest)
        probe = json.loads(subprocess.check_output([
            'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(dest)]))
        stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        duration = float(probe['format']['duration'])
        if (stream['width'], stream['height']) != (1280, 800) or duration < 195:
            raise SystemExit('Incomplete or wrong-size video')
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(dest), '-f', 'null', '-'], check=True)
        mp4 = args.output / f'{name}.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(dest), '-an', '-c:v', 'libx264',
                        '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
                        str(mp4)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp4), '-f', 'null', '-'], check=True)
        # Evenly spaced samples from the complete video, including setup/teardown.
        # These timestamps belong to the file, not the transition's separate clock.
        times = [duration * (i + 0.5) / 12 for i in range(12)]
        sheet = Image.new('RGB', (1280, 6 * 424), '#202020')
        with tempfile.TemporaryDirectory() as temporary:
            for i, second in enumerate(times):
                frame = Path(temporary) / f'{i}.png'
                subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(second), '-i', str(dest),
                                '-frames:v', '1', '-threads', '1', str(frame)], check=True)
                x, y = (i % 2) * 640, (i // 2) * 424
                ImageDraw.Draw(sheet).text((x + 8, y + 5), f'{name} video {second:.2f}s', fill='white')
                with Image.open(frame) as image:
                    sheet.paste(image.convert('RGB').resize((640, 400)), (x, y + 24))
        sheet.save(args.output / f'{name}.jpg', quality=94)
        (args.output / f'{name}-samples.json').write_text(json.dumps(run, indent=2) + '\n')
        samples = run['samples']
        start = 0 if run['minute'] == 12 else 1
        summary['runs'].append(dict(
            stage=run['stage'], minute=run['minute'], browser=run['browser'], quality=run['quality'],
            viewport=run['viewport'], hashes=run['hashes'], samples=len(samples),
            observedSeconds=samples[-1]['seconds'], timeRange=[samples[0]['time'], samples[-1]['time']],
            maxTargetDifference=max(abs(s['time'] - start - min(1, s['seconds'] / 180)) for s in samples),
            maxSampleGapSeconds=max(b['seconds'] - a['seconds'] for a, b in zip(samples, samples[1:])),
            resourceCounts={key: sorted({s['data'][key] for s in samples}) for key in ['geometries', 'textures']},
            video=dict(file=dest.name, sha256=sha(dest), durationSeconds=duration,
                       codec=stream['codec_name'], encodedFrameRate=stream['r_frame_rate'],
                       bytes=dest.stat().st_size, decoded=True), sheetTimesSeconds=times, errors=run['errors']))
        summary['runs'][-1]['mp4'] = dict(file=mp4.name, sha256=sha(mp4), bytes=mp4.stat().st_size, decoded=True)
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({k: v for k, v in summary.items() if k != 'runs'}, indent=2))
    for run in summary['runs']:
        print(run['stage'], run['samples'], run['timeRange'], run['video']['durationSeconds'])


if __name__ == '__main__':
    main()
