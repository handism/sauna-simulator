"""Summarise diagnose_water_gloss_scene.py and check the flat-water view mapping against Cycles'.

python3 scripts/summarize_water_gloss_scene.py blender/diagnostics/water-gloss-scene --out docs/3d-qa/water-gloss-scene

For every analysed pixel the camera ray of the crop is also traced through a flat water box
(`flat_view`: the top at 0.765 m, side walls folding the ray by reflection with their Fresnel, the
bottom at 0.215 m, then the air gap to the floor at 0.202 m), as an earlier, unrecorded comparison
did. Its floor point, air direction and Fresnel throughput are compared with the ones Cycles traced
(the mapping renders), and the flat-slab integral is evaluated at both. summary.json holds, per
variant and crop, the spot's gloss, each step's ratio to the one before, and these comparisons.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np

from diagnose_water_floor_disk import LIGHTS
from diagnose_water_gloss_scene import LUMINANCE, STRIDE, gltf
from diagnose_water_gloss_slab import fresnel, slab_integral
from water_gloss import BOTTOM, IOR, LEVEL

ROOT = Path(__file__).resolve().parents[1]
FLOOR = 0.202
# The water's box in glTF x and z.
BOX = (-0.155, 2.515, -4.095, -0.905)
PITCH = {'level': -0.01, 'down': -0.85}


def camera_rays(view, heading, pitch, pixels):
    """Unit glTF directions of the 1280×800 camera of blender_stage_reference at (x, y) pixel centers."""
    d = [t - p for t, p in zip(view['target'], view['position'])]
    yaw = math.atan2(-d[0], -d[2]) - 0.8 * heading
    p = PITCH[pitch]
    forward = np.array([-math.cos(p) * math.sin(yaw), math.sin(p), -math.cos(p) * math.cos(yaw)])
    up = np.array([math.sin(p) * math.sin(yaw), math.cos(p), math.sin(p) * math.cos(yaw)])
    right = np.cross(forward, up)
    t = math.tan(math.radians(view['fov']) / 2)
    x = (pixels[:, 0] + 0.5 - 640) / 400 * t
    y = (400 - pixels[:, 1] - 0.5) / 400 * t
    rays = forward + x[:, None] * right + y[:, None] * up
    return rays / np.linalg.norm(rays, axis=1, keepdims=True)


def inside_fresnel(cosine):
    """Reflectance of the water's inner face at `cosine` (water side), 1 past the critical angle."""
    sine = np.sqrt(max(0.0, 1 - cosine * cosine)) * IOR
    if sine >= 1:
        return 1.0
    return float(fresnel(math.sqrt(1 - sine * sine), IOR))


def flat_view(origin, ray):
    """Floor point, air direction toward the viewer and Fresnel throughput through the flat box."""
    origin = np.asarray(origin, float)
    if ray[1] >= 0:
        return None
    hit = origin + ray * (LEVEL - origin[1]) / ray[1]
    if not (BOX[0] < hit[0] < BOX[1] and BOX[2] < hit[2] < BOX[3]):
        return None
    throughput = 1 - float(fresnel(-ray[1], IOR))
    d = np.array([ray[0] / IOR, 0.0, ray[2] / IOR])
    d[1] = -math.sqrt(1 - d[0] ** 2 - d[2] ** 2)
    p = hit
    for _ in range(16):
        t = (BOTTOM - p[1]) / d[1]
        wall = None
        for axis, low, high in ((0, BOX[0], BOX[1]), (2, BOX[2], BOX[3])):
            if d[axis] != 0:
                s = ((high if d[axis] > 0 else low) - p[axis]) / d[axis]
                if s < t:
                    t, wall = s, axis
        p = p + d * t
        if wall is None:
            break
        throughput *= inside_fresnel(abs(d[wall]))
        d[wall] = -d[wall]
    else:
        return None
    air = np.array([d[0] * IOR, 0.0, d[2] * IOR])
    air[1] = -math.sqrt(max(0.0, 1 - air[0] ** 2 - air[2] ** 2))
    throughput *= 1 - float(fresnel(-air[1], IOR))
    floor = p + air * (FLOOR - p[1]) / air[1]
    return floor, -air, throughput


def block(image, y, x):
    half = STRIDE // 2
    return image[y - half:y + half + 1, x - half:x + half + 1].reshape(-1, image.shape[-1]).mean(0)


def summarise(directory, steps):
    report = json.loads((directory / 'scene.json').read_text())
    view = json.loads((ROOT / 'public/models/sauna.scene.json').read_text())['views']['water']
    radiance = np.array(report['lightRadiance'])
    center, facing, radius = LIGHTS['V10 lounge dusk fill']
    fill = (np.array(center), np.array(facing), radius)
    out = {}
    for heading, pitch, x0, x1, y0, y1 in report['crops']:
        key = f'{heading}-{pitch}'
        source = np.load(directory / f'source-{key}.npz')
        on = source['fillOn'].mean(-1)
        spot = on > np.percentile(on, 80)
        previous = None
        for variant in report['variants']:
            name = f'{variant}-{key}'
            data = np.load(directory / f'{name}.npz')
            points = np.load(directory / f'{name}-analysis.npy')
            yx = points[:, :2].astype(int)
            rays = camera_rays(view, heading, pitch, np.stack([yx[:, 1] + x0, yx[:, 0] + y0], 1))
            gloss = data['gloss']
            spot_gloss = float(gloss[spot].mean(0) @ LUMINANCE)
            rows = []
            for (y, x), ray, cycles_value in zip(yx, rays, points[:, 3:6]):
                traced = flat_view(view['position'], ray)
                if traced is None:
                    continue
                floor, v, throughput = traced
                measured = block(gloss, y, x) @ LUMINANCE
                flat_value = throughput * slab_integral(floor, v, fill, steps) * radiance @ LUMINANCE
                rows.append((
                    bool(spot[y, x]),
                    measured,
                    float(np.asarray(cycles_value) @ LUMINANCE),
                    flat_value,
                    float(data['weight'][y, x]),
                    throughput,
                    float(np.linalg.norm(gltf(data['position'][y, x])[[0, 2]] - floor[[0, 2]])),
                    float(np.degrees(np.arccos(np.clip(gltf(data['incoming'][y, x]) @ v
                                                       / np.linalg.norm(data['incoming'][y, x]), -1, 1)))),
                ))
            r = np.array(rows, float)

            def part(mask):
                s = r[mask]
                return {
                    'points': int(len(s)),
                    'cyclesOverMappedAnalysis': float(s[:, 1].sum() / s[:, 2].sum()),
                    'cyclesOverFlatAnalysis': float(s[:, 1].sum() / s[:, 3].sum()),
                    'flatOverMappedAnalysis': float(s[:, 3].sum() / s[:, 2].sum()),
                    'correlationMapped': float(np.corrcoef(s[:, 1], s[:, 2])[0, 1]),
                    'correlationFlat': float(np.corrcoef(s[:, 1], s[:, 3])[0, 1]),
                    'cyclesThroughputMean': float(s[:, 4].mean()),
                    'flatThroughputMean': float(s[:, 5].mean()),
                    'floorShiftMedianM': float(np.median(s[:, 6])),
                    'floorShiftP90M': float(np.percentile(s[:, 6], 90)),
                    'directionAngleMedianDeg': float(np.median(s[:, 7])),
                }

            out[name] = {
                'spotGlossLuminance': spot_gloss,
                'overPreviousVariant': None if previous is None else spot_gloss / previous,
                'overSource': spot_gloss / out[f'source-{key}']['spotGlossLuminance'] if variant != 'source' else 1.0,
                'all': part(np.ones(len(r), bool)),
                'spot': part(r[:, 0] > 0),
            }
            previous = spot_gloss
    return report, out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('directory', type=Path)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--steps', type=int, default=161)
    args = parser.parse_args()
    report, out = summarise(args.directory, args.steps)
    args.out.mkdir(parents=True, exist_ok=True)
    here = Path(__file__).resolve().parent
    summary = {
        'input': {k: report[k] for k in ('blend', 'blendSha256', 'blender', 'scripts', 'samples', 'mappingSamples',
                                         'seed', 'integrationSteps', 'stride', 'crops', 'variants', 'lightRadiance')},
        'sceneJsonSha256': hashlib.sha256((args.directory / 'scene.json').read_bytes()).hexdigest(),
        'script_sha256': hashlib.sha256((here / 'summarize_water_gloss_scene.py').read_bytes()).hexdigest(),
        'diagnose': report['results'],
        'summary': out,
    }
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=1) + '\n')
    for name, value in out.items():
        print(name, round(value['spotGlossLuminance'], 5), value['overPreviousVariant'] and round(value['overPreviousVariant'], 3),
              {k: round(v, 3) for k, v in value['spot'].items()})


if __name__ == '__main__':
    main()
