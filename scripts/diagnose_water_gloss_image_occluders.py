"""What hides the dusk fill from the floor along its image in the x side of the plunge (no render).

Blender -b blender/scene/SUI_Retreat.blend -S 'SUI • Blue hour' --python-exit-code 1
  --python scripts/diagnose_water_gloss_image_occluders.py -- --points <points.json> --out <dir>

The floor points (glTF, from diagnose_water_gloss_grazing.py --points) are mirrored in the x side
away from the lamp (x = −0.155); from each image the exact refracted path (water_gloss.exact_exit,
flat water at 0.765 m) to 216 equal-area points of the fill's 2 m disk is kept when it leaves the
surface past the side and inside the water, and cast on from the exit to the lamp point (the water
and render-hidden objects are skipped; each ray counts for the first object it meets). The same is
done for the disk's center alone, which is all the product's shadow map sees. image-occluders.json
holds the visible fractions and the objects; the blend is never saved and its SHA-256 is checked.
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
# The water box in Blender x and y (glTF x and −z).
SIDE_X, BOX = -0.155, (-0.155, 2.515, 0.905, 4.095)
RINGS, SPOKES = 12, 18


def main():
    import bpy
    from mathutils import Vector

    parser = argparse.ArgumentParser()
    parser.add_argument('--points', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    source = Path(bpy.data.filepath)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    scene = bpy.context.scene
    assert scene.name == 'SUI • Blue hour', scene.name
    depsgraph = bpy.context.evaluated_depsgraph_get()
    lamp = bpy.data.objects[FILL].evaluated_get(depsgraph)
    center, rotation, radius = lamp.matrix_world.translation, lamp.matrix_world.to_quaternion(), lamp.data.size / 2
    disk = []
    for i in range(RINGS):
        r = radius * math.sqrt((i + 0.5) / RINGS)
        for j in range(SPOKES):
            a = 2 * math.pi * (j + 0.5) / SPOKES
            disk.append(center + rotation @ Vector((r * math.cos(a), r * math.sin(a), 0)))

    def first_hit(floor, target):
        """The first object on the image path from `floor` (Blender, already mirrored) to `target`, or '' / None."""
        exit_ = exact_exit(floor, tuple(target))
        if not (exit_[0] > SIDE_X and BOX[0] < exit_[0] < BOX[1] and BOX[2] < exit_[1] < BOX[3]):
            return None
        origin = Vector(exit_) + Vector((0, 0, 1e-4))
        direction = target - origin
        distance = direction.length
        direction.normalize()
        while True:
            hit, location, _, _, obj, _ = scene.ray_cast(depsgraph, origin, direction, distance=distance)
            if not hit:
                return ''
            if obj.name == WATER or obj.hide_render:
                step = (location - origin).length + 1e-4
                origin, distance = location + direction * 1e-4, distance - step
                continue
            return obj.name

    points = json.loads(args.points.read_text())
    objects = collections.Counter()
    rays = 0
    for p in points:
        g = p['floorGltf']
        image = (2 * SIDE_X - g[0], -g[2], g[1])
        hits = [h for h in (first_hit(image, q) for q in disk) if h is not None]
        rays += len(hits)
        objects.update(h for h in hits if h)
        p['diskRays'] = len(hits)
        p['diskVisible'] = sum(1 for h in hits if not h) / len(hits) if hits else None
        p['centerVisible'] = {None: None, '': True}.get(first_hit(image, center), False)
    assert before == hashlib.sha256(source.read_bytes()).hexdigest()
    kept = [p for p in points if p['diskVisible'] is not None]
    weight = lambda crop: [p for p in kept if p['crop'] == crop]
    report = {
        'blend': source.name,
        'blendSha256': before,
        'blender': bpy.app.version_string,
        'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'points_sha256': hashlib.sha256(args.points.read_bytes()).hexdigest(),
        'diskPoints': len(disk),
        'rays': rays,
        'diskVisible': sum(p['diskVisible'] for p in kept) / len(kept),
        'centerVisible': sum(1 for p in kept if p['centerVisible']) / len(kept),
        'byCrop': {crop: {
            'points': len(weight(crop)),
            'diskVisibleRimWeighted': sum(p['diskVisible'] * p['rim'] for p in weight(crop)) / sum(p['rim'] for p in weight(crop)),
            'cyclesSourceOverRim': sum(p['source'] for p in weight(crop)) / sum(p['rim'] for p in weight(crop)),
        } for crop in sorted({p['crop'] for p in kept})},
        'objects': {name: n / rays for name, n in objects.most_common()},
        'points': points,
    }
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / 'image-occluders.json').write_text(json.dumps(report, indent=1) + '\n')
    print('IMAGE_OCCLUDERS', json.dumps({k: report[k] for k in ('diskVisible', 'centerVisible', 'byCrop')}))


if __name__ == '__main__':
    main()
