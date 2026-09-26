"""Flat-shade the side and bottom faces of the source plunge water and save the blend.

Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python
scripts/flatten_water_sides.py -- [--dry-run] [--report PATH]

`V4 rippled spring water volume` was built as a rippled top grid closed by a
single strip of side quads and one bottom n-gon, all smooth shaded without
sharp edges. Cycles refracts and totally reflects with the interpolated corner
normals, which lean about 45 degrees on the sides, so the flat tank walls act
like curved lenses (docs/3d-qa/water-gloss-mismatch/). This marks every face
that is not part of the top grid as flat (`sharp_face`), keeps the top smooth,
marks the rim edges between them sharp (Cycles otherwise shades the smooth top
with vertex normals that still average in the walls) and checks that the corner normals of the sides and bottom equal their face
normals and that the top rim is no longer bent by the sides. Unlike the
diagnostics this one saves the source blend (keep a copy first, e.g.
`SUI_Retreat_v11.blend`). With --dry-run nothing is saved.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy

WATER = 'V4 rippled spring water volume'
TOP_MIN_Z = 0.5  # the top grid is at 0.765 m +- 1 cm, the bottom at 0.215 m


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for block in iter(lambda: handle.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def angle(a, b):
    return math.degrees(math.acos(max(-1.0, min(1.0, a.normalized().dot(b.normalized())))))


def corner_deviation(mesh, faces):
    """Largest angle (degrees) between a face's corner normals and its face normal."""
    worst = 0.0
    for poly in faces:
        for loop in range(poly.loop_start, poly.loop_start + poly.loop_total):
            worst = max(worst, angle(mesh.corner_normals[loop].vector, poly.normal))
    return worst


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--report')
    args = parser.parse_args(argv)

    path = Path(bpy.data.filepath)
    before = sha256(path)
    mesh = bpy.data.objects[WATER].data
    vertices = mesh.vertices
    top = [p for p in mesh.polygons if all(vertices[v].co.z > TOP_MIN_Z for v in p.vertices)]
    walls = [p for p in mesh.polygons if not all(vertices[v].co.z > TOP_MIN_Z for v in p.vertices)]
    rim = {v for p in walls for v in p.vertices if vertices[v].co.z > TOP_MIN_Z}
    rim_top = [p for p in top if rim.intersection(p.vertices)]
    was_smooth = sum(not p.use_smooth for p in mesh.polygons) == 0
    wall_before = corner_deviation(mesh, walls)
    rim_before = corner_deviation(mesh, rim_top)

    for p in top:
        p.use_smooth = True
    for p in walls:
        p.use_smooth = False
    # Cycles reads flat faces natively and then shades the smooth ones with vertex normals, which
    # still average in the walls; only sharp edges make it use the split corner normals.
    wall_edges = {k for p in walls for k in p.edge_keys}
    rim_edges = [e for e in mesh.edges if e.key in wall_edges
                 and all(vertices[v].co.z > TOP_MIN_Z for v in e.vertices)]
    for e in rim_edges:
        e.use_edge_sharp = True
    mesh.update()

    wall_after = corner_deviation(mesh, walls)
    rim_after = corner_deviation(mesh, rim_top)
    interior_top = [p for p in top if not rim.intersection(p.vertices)]
    report = {
        'input': path.name, 'input_sha256': before, 'object': WATER,
        'faces': {'total': len(mesh.polygons), 'top_smooth': len(top), 'walls_flat': len(walls),
                  'top_at_rim': len(rim_top)},
        'sharp_rim_edges': len(rim_edges),
        'all_smooth_before': was_smooth,
        'max_corner_to_face_deg': {
            'walls_before': wall_before, 'walls_after': wall_after,
            'rim_top_before': rim_before, 'rim_top_after': rim_after,
            'interior_top_after': corner_deviation(mesh, interior_top)},
        'saved': False,
    }
    if len(rim_edges) != 2 * (110 + 132):
        raise RuntimeError(f'unexpected rim: {len(rim_edges)} edges')
    if len(walls) != 485 or len(top) != 110 * 132:
        raise RuntimeError(f'unexpected water topology: {len(top)} top, {len(walls)} wall faces')
    if wall_after > 1e-3:
        raise RuntimeError(f'wall corner normals still deviate {wall_after:.3f} deg')
    # The rim is only as bent as the ripples next to it (a few degrees), not by the 90-degree walls.
    if rim_after > 10.0:
        raise RuntimeError(f'top rim still bent by the walls ({rim_after:.1f} deg)')
    if not args.dry_run:
        bpy.ops.wm.save_mainfile(compress=True)
        report['saved'] = True
        report['output_sha256'] = sha256(path)
    text = json.dumps(report, indent=2)
    print(text)
    if args.report:
        Path(args.report).write_text(text + '\n')


main()
