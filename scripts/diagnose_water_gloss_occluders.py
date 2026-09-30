"""What hides the dusk fill from the tile-gloss spot of diagnose_water_gloss_scene.py (no render).

Blender -b blender/scene/SUI_Retreat.blend -S 'SUI • Blue hour' --python-exit-code 1
  --python scripts/diagnose_water_gloss_occluders.py -- --out docs/3d-qa/water-gloss-scene

A 5×5 grid of floor points covering the spot (Blender x −0.1…0.3, y 1.75…1.98, the 10–90th
percentiles of the mapped spot position) looks at 216 equal-area points of the fill's 2 m disk
along the exact refracted path (water_gloss.exact_exit, flat water at 0.765 m). From the exit the
ray is cast to the lamp point; the water itself and render-hidden objects are skipped. Each ray
counts once, for the first object it meets. The fractions are geometric (not weighted by the gloss
lobe). occluders.json holds them; the blend is never saved and its SHA-256 is checked.
"""
import argparse
import collections
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from water_gloss import exact_exit  # noqa: E402

FILL = 'V10 lounge dusk fill / dusk'
WATER = 'V4 rippled spring water volume'
XS = (-0.1, 0.0, 0.1, 0.2, 0.3)
YS = (1.75, 1.8, 1.87, 1.93, 1.98)
FLOOR = 0.2025
RINGS, SPOKES = 12, 18
GROUPS = (
    ('coping', ('Honed pool coping', 'V8 coping shadow joint')),
    ('canopy beam', ('V8 canopy timber beam',)),
    ('louvers', ('V8 slender shade louver',)),
)


def group(name):
    return next((g for g, prefixes in GROUPS if name.startswith(prefixes)), 'other')


def main():
    import bpy
    from mathutils import Vector

    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = Path(bpy.data.filepath)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    scene = bpy.context.scene
    assert scene.name == 'SUI • Blue hour', scene.name
    depsgraph = bpy.context.evaluated_depsgraph_get()
    # The original's matrix_world is not evaluated in background mode.
    lamp = bpy.data.objects[FILL].evaluated_get(depsgraph)
    center, rotation, radius = lamp.matrix_world.translation, lamp.matrix_world.to_quaternion(), lamp.data.size / 2
    disk = []
    for i in range(RINGS):
        r = radius * math.sqrt((i + 0.5) / RINGS)
        for j in range(SPOKES):
            a = 2 * math.pi * (j + 0.5) / SPOKES
            disk.append(center + rotation @ Vector((r * math.cos(a), r * math.sin(a), 0)))

    objects = collections.Counter()
    points = []
    for x in XS:
        for y in YS:
            floor = (x, y, FLOOR)
            hidden = collections.Counter()
            for p in disk:
                origin = Vector(exact_exit(floor, tuple(p))) + Vector((0, 0, 1e-4))
                direction = p - origin
                distance = direction.length
                direction.normalize()
                while True:
                    hit, location, _, _, obj, _ = scene.ray_cast(depsgraph, origin, direction, distance=distance)
                    if not hit:
                        break
                    if obj.name == WATER or obj.hide_render:
                        step = (location - origin).length + 1e-4
                        origin, distance = location + direction * 1e-4, distance - step
                        continue
                    hidden[group(obj.name)] += 1
                    objects[obj.name] += 1
                    break
            points.append({'floor': floor, 'visible': 1 - sum(hidden.values()) / len(disk),
                           **{g: hidden[g] / len(disk) for g in [*dict(GROUPS), 'other']}})
    rays = len(points) * len(disk)
    assert before == hashlib.sha256(source.read_bytes()).hexdigest()
    visible = sum(p['visible'] for p in points) / len(points)
    share = {g: sum(p[g] for p in points) / len(points) for g in [*dict(GROUPS), 'other']}
    report = {
        'blend': source.name,
        'blendSha256': before,
        'blender': bpy.app.version_string,
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'lamp': {'center': list(center), 'radius': radius},
        'diskPoints': len(disk),
        'rays': rays,
        'visible': visible,
        'hiddenBy': share,
        'objects': {name: n / rays for name, n in objects.most_common()},
        'points': points,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'occluders.json').write_text(json.dumps(report, indent=1) + '\n')
    print('OCCLUDERS', json.dumps({'visible': visible, **share}))


if __name__ == '__main__':
    main()
