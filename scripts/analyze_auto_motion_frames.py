"""Frame-by-frame steps and flicker in the real-time lighting recordings (a numeric stand-in for
watching them, not a perceptual verdict).

python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/auto-motion
Reads summary.json and the local WebMs it names (their hashes must match), decodes every frame at
320×200 and writes frames.json (tracked) and frames-highpass.png (local) next to them. Requires
ffmpeg, ffprobe, NumPy and Pillow.

The lighting ramp (observation 1–179 s, without the look-around sweeps and 3 s after them) is
compared with the end hold (181–194 s), where the lighting no longer changes. Frames within one
frame of the encoder's keyframes are reported separately: VP8 refreshes the whole picture there.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image

FPS = 25
WIDTH, HEIGHT = 320, 200
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
# The planar reflection is redrawn when the time of day moves by 0.002: 0.36 s during a transition.
MIRROR_BAND = (2.5, 3.1)
DUPLICATE = 0.05


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def decode(video):
    """Every frame's Rec. 709 luma at WIDTH×HEIGHT (float32, 0–255)."""
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'scale={WIDTH}:{HEIGHT}:flags=area',
         '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        check=True, capture_output=True,
    ).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, HEIGHT, WIDTH, 3).astype(np.float32)
    return frames @ LUMA


def keyframe_times(video):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags',
         '-of', 'csv=p=0', str(video)],
        check=True, capture_output=True, text=True,
    ).stdout
    return [float(t) for t, flags in (line.split(',')[:2] for line in out.split()) if 'K' in flags]


def near_keyframes(count, times, fps=FPS):
    """Frames within one frame of a keyframe."""
    mask = np.zeros(count, bool)
    for t in times:
        i = int(round(t * fps))
        mask[max(0, i - 1):i + 2] = True
    return mask


def segments(observed, sweeps, end=180, hold_end=194):
    """Masks of the lighting ramp without the sweeps (and 3 s after them) and of the end hold."""
    moving = np.zeros(len(observed), bool)
    for a, b in sweeps:
        moving |= (observed > a - 1) & (observed < b + 3)
    ramp = (observed > 1) & (observed < end - 1) & ~moving
    hold = (observed > end + 1) & (observed < hold_end)
    return ramp, hold


def frame_diffs(frames):
    """Mean absolute luma change from the previous frame (0 for the first)."""
    d = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))
    return np.r_[0.0, d]


def band_ratio(signal, band=MIRROR_BAND, fps=FPS, window=20, rest=(1.0, 12.0)):
    """Mean power in `band` over the mean power elsewhere in `rest`, averaged over windows of
    `window` seconds (each detrended with a cubic and Hann-windowed)."""
    n = window * fps
    freqs = np.fft.rfftfreq(n, 1 / fps)
    total = np.zeros(len(freqs))
    for k in range(len(signal) // n):
        seg = signal[k * n:(k + 1) * n]
        x = np.arange(n)
        seg = seg - np.polyval(np.polyfit(x, seg, 3), x)
        total += np.abs(np.fft.rfft(seg * np.hanning(n))) ** 2
    inside = (freqs > band[0]) & (freqs < band[1])
    outside = (freqs > rest[0]) & (freqs < rest[1]) & ~inside
    return float(total[inside].mean() / total[outside].mean())


def high_pass(frames, index):
    """Mean |y1 − (y0 + y2) / 2| per pixel over consecutive changed frames in `index`."""
    index = np.asarray(index)
    triples = [(index[k - 1], index[k], index[k + 1]) for k in range(1, len(index) - 1)
               if index[k] - index[k - 1] <= 3 and index[k + 1] - index[k] <= 3]
    total = np.zeros(frames.shape[1:])
    for a, b, c in triples:
        total += np.abs(frames[b] - (frames[a] + frames[c]) / 2)
    return total / max(1, len(triples)), len(triples)


def per_step_change(frames, index, steps=500, span=FPS):
    """Per-pixel change between the first and last `span` frames of `index`, over `steps`
    (8-bit levels): p99 and max."""
    change = np.abs(frames[index[-span:]].mean(axis=0) - frames[index[:span]].mean(axis=0)) / steps
    return {'p99': pct(change, 99), 'max': round(float(change.max()), 3)}


def pct(values, q):
    return round(float(np.percentile(values, q)), 3)


def analyze(run, folder):
    video = folder / run['video']['file']
    if sha(video) != run['video']['sha256']:
        raise SystemExit(f'{video} does not match summary.json')
    samples = json.loads((folder / f"{run['stage']}-{run['minute']}-samples.json").read_text())
    frames = decode(video)
    count = len(frames)
    observed = np.arange(count) / FPS - samples['recordingStart']['performanceMs'] / 1000
    diffs = frame_diffs(frames)
    changed = np.r_[True, diffs[1:] >= DUPLICATE]
    key = near_keyframes(count, keyframe_times(video))
    ramp, hold = segments(observed, samples['sweeps'])
    lower = frames[:, HEIGHT // 2:].mean(axis=(1, 2))
    result = {'frames': count, 'unchangedFrames': int((~changed).sum()), 'segments': {}}
    maps = []
    for label, mask in (('ramp', ramp), ('hold', hold)):
        plain = np.flatnonzero(mask & ~key)
        at_key = np.flatnonzero(mask & key)
        hp, triples = high_pass(frames, np.flatnonzero(mask & changed & ~key))
        blocks = hp.reshape(HEIGHT // 20, 20, WIDTH // 20, 20).mean(axis=(1, 3))
        maps.append(hp)
        result['segments'][label] = {
            'seconds': round(len(np.flatnonzero(mask)) / FPS, 2),
            'meanLumaStartEnd': [round(float(frames[plain[0]].mean()), 2), round(float(frames[plain[-1]].mean()), 2)],
            'diffP50': pct(diffs[plain], 50),
            'diffP99': pct(diffs[plain], 99),
            'diffMax': round(float(diffs[plain].max()), 3),
            'diffMaxAtSeconds': round(float(observed[plain[diffs[plain].argmax()]]), 2),
            'keyframeDiffMax': round(float(diffs[at_key].max()), 3) if len(at_key) else None,
            'highPassTriples': triples,
            'highPassMean': round(float(hp.mean()), 4),
            'highPassBlockMax': round(float(blocks.max()), 3),
        }
    ramp_blocks, hold_blocks = (m.reshape(HEIGHT // 20, 20, WIDTH // 20, 20).mean(axis=(1, 3)) for m in maps)
    result['rampBlocksOverTwiceHold'] = int(((ramp_blocks > 2 * hold_blocks) & (ramp_blocks > 0.3)).sum())
    runs = np.split(np.flatnonzero(ramp), np.flatnonzero(np.diff(np.flatnonzero(ramp)) > 1) + 1)
    signal = np.concatenate([lower[r][: len(r) // (20 * FPS) * 20 * FPS] for r in runs])
    result['mirrorBandPowerRatio'] = round(band_ratio(signal), 3)
    # The mirror's step, bounded by the whole change of each pixel over the ramp split into the 500
    # steps of one scene (1 s averages at both ends cancel the waves). The spectrum above only sees
    # steps well above the waves' noise; this bounds them directly.
    result['perPixelChangePerMirrorStep'] = per_step_change(frames, np.flatnonzero(ramp))
    return result, maps, frames[np.flatnonzero(ramp)[len(np.flatnonzero(ramp)) // 2]]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    args = parser.parse_args()
    summary = json.loads((args.folder / 'summary.json').read_text())
    out = {'summarySha256': sha(args.folder / 'summary.json'), 'size': [WIDTH, HEIGHT], 'runs': {}}
    rows = []
    for run in summary['runs']:
        name = f"{run['stage']}-{run['minute']}"
        result, maps, still = analyze(run, args.folder)
        out['runs'][name] = result
        scale = lambda m: np.clip(m / 2 * 255, 0, 255)
        rows.append(np.concatenate([still, scale(maps[0]), scale(maps[1])], axis=1))
    (args.folder / 'frames.json').write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
    Image.fromarray(np.concatenate(rows).astype(np.uint8)).save(args.folder / 'frames-highpass.png')
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
