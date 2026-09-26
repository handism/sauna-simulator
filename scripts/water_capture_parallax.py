"""Parallax of a cube capture placed above the water; geometry only, Blender axes.

A terminal of the underwater glossy lobe that left the water has a last ray
segment (origin on the water boundary, direction) and a true hit. A cube
capture at a probe point returns what the probe sees along a lookup direction:
the segment direction itself (infinitely distant capture) or the direction to
where the segment leaves a proxy box (box-projected capture).
"""
import math

from diagnose_water_paths import box_exit
from water_path_trace import advance
from water_reflection_trace import cross, dot, normalize

FAR = 50.0


def angle_degrees(a, b):
    a, b = normalize(a), normalize(b)
    return math.degrees(math.atan2(math.sqrt(dot(cross(a, b), cross(a, b))), dot(a, b)))


def grid_probes(lower, upper, nx, ny, z):
    """Cell centres of an nx x ny grid over the XY rectangle, at height z."""
    return [(lower[0] + (i + 0.5) * (upper[0] - lower[0]) / nx,
             lower[1] + (j + 0.5) * (upper[1] - lower[1]) / ny, z)
            for i in range(nx) for j in range(ny)]


def nearest(point, probes):
    return min(probes, key=lambda probe: math.dist(point, probe))


def axis_box(center, distance, floor_z):
    """Proxy box from the distances an axis ray travels from the probe (+X, -X, +Y, -Y, +Z).

    distance(center, direction) -> float or None (nothing hit: FAR). The box
    reaches down to floor_z so that segment origins on the water are inside.
    """
    reach = [distance(center, d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1))]
    reach = [FAR if r is None else r for r in reach]
    lower = (center[0] - reach[1], center[1] - reach[3], floor_z)
    upper = (center[0] + reach[0], center[1] + reach[2], center[2] + reach[4])
    return lower, upper


def box_lookup(origin, direction, center, box):
    """Direction from the probe to where the segment leaves the box; None if the origin is outside it."""
    found = box_exit(origin, direction, *box)
    if found is None:
        return None
    return normalize(tuple(p - c for p, c in zip(advance(origin, direction, found[0]), center)))


def nested_box_lookup(origin, direction, center, boxes):
    """Box projection through nested proxies, innermost first.

    A segment that leaves a box through its top face continues into the next
    (enclosing) box; the first wall it reaches, or the last box's exit, is the
    projected point. A segment starting outside a box skips it. None if the
    origin is outside every box.
    """
    point = None
    for index, box in enumerate(boxes):
        found = box_exit(origin, direction, *box)
        if found is None:
            continue
        point = advance(origin, direction, found[0])
        if found[1][2] <= 0.5 or index == len(boxes) - 1:
            break
        origin = point
    if point is None:
        return None
    return normalize(tuple(p - c for p, c in zip(point, center)))


def compare(truth, found, tolerance):
    """Truth and found are hit dicts (object, position) or None for the sky."""
    if truth is None or found is None:
        return truth is None and found is None
    return found['object'] == truth['object'] and math.dist(found['position'], truth['position']) <= tolerance


def weighted_quantile(values, weights, q):
    pairs = sorted(zip(values, weights))
    total = sum(weights)
    if total <= 0:
        return None
    running = 0.0
    for value, weight in pairs:
        running += weight
        if running >= q * total:
            return value
    return pairs[-1][0]
