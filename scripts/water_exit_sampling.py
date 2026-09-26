"""Few-sample estimate of the glossy light that leaves the water, as a shader could do it; Blender axes.

An underwater endpoint samples its GGX lobe and every sample walks through the
water as an axis-aligned box (the source water's sides and bottom, the
runtime's flat level as its top, optionally with the static wave normal).
A ray from an endpoint outside the box (tiles under the thin gap) enters it
with its Fresnel transmittance. Inside, only the reflected branch is followed,
as a fixed loop in a shader could: at the top the transmitted part leaves the
water and is box-projected into the above-water capture; at the sides and the
bottom it is lost to the tub (the underwater component). Total internal
reflection keeps the whole weight. Unlike water_reflection_trace.py there is no
scene geometry: nothing occludes the ray under water.
"""
import math

from diagnose_water_paths import IOR, box_exit, refract
from water_capture_parallax import nested_box_lookup
from water_path_trace import advance, reflect
from water_reflection_trace import dot, fresnel_dielectric, normalize, sample_ggx_reflection, schlick

UP = (0.0, 0.0, 1.0)
EPSILON = 1e-6


def flat_normal(x, y):
    return UP


def wave_normal(x, y):
    """Runtime's static wave normal (waterEffects.ts at t = 0) in Blender axes, as in diagnose_water_paths.py."""
    dx, dy = x - 1.18, y - 3.99
    radius = max(math.hypot(dx, dy), 1e-4)
    slope = 0.005585 * math.exp(-1.6814 * radius) * (33.988 * math.cos(33.988 * radius) - 1.6814 * math.sin(33.988 * radius))
    plane = 0.000684 * math.cos(15 * x + 10 * y)
    return normalize((-slope * dx / radius - 15 * plane, -slope * dy / radius - 10 * plane, 1))


def box_entry(origin, direction, lower, upper):
    """(distance, outward normal of the entered face) for an origin outside the box, or None."""
    near, far, face = -math.inf, math.inf, None
    for axis in range(3):
        if abs(direction[axis]) < 1e-12:
            if not lower[axis] <= origin[axis] <= upper[axis]:
                return None
            continue
        t0 = (lower[axis] - origin[axis]) / direction[axis]
        t1 = (upper[axis] - origin[axis]) / direction[axis]
        sign = -1 if t0 < t1 else 1
        t0, t1 = min(t0, t1), max(t0, t1)
        if t0 > near:
            near, face = t0, tuple(sign if i == axis else 0 for i in range(3))
        far = min(far, t1)
    if near > far or near < 0:
        return None
    return near, face


def inside(point, lower, upper):
    return all(lo - EPSILON <= p <= hi + EPSILON for p, lo, hi in zip(point, lower, upper))


def water_exits(point, direction, lower, upper, surface_normal=flat_normal, max_events=6):
    """[(exit point, refracted direction, weight)] of the light a ray brings through the top of the water box.

    lower, upper span the water; upper[2] is the (flat) level. surface_normal(x, y)
    tilts the top only. The weights include every Fresnel factor along the way.
    """
    weight = 1.0
    if not inside(point, lower, upper):
        found = box_entry(point, direction, lower, upper)
        if found is None:
            return []
        distance, face = found
        facing = face  # outward normal opposes the entering ray
        transmitted = refract(direction, facing, 1 / IOR)
        if transmitted is None:
            return []
        weight *= 1 - fresnel_dielectric(dot(direction, facing), 1 / IOR)
        point = tuple(min(max(c, lo), hi) for c, lo, hi in zip(advance(point, direction, distance), lower, upper))
        direction = normalize(transmitted)
    exits = []
    for _ in range(max_events):
        found = box_exit(point, direction, lower, upper)
        if found is None:
            break
        distance, face = found
        point = advance(point, direction, distance)
        normal = surface_normal(point[0], point[1]) if face[2] > 0.5 else face
        facing = tuple(-c for c in normal) if dot(direction, normal) > 0 else normal
        transmitted = refract(direction, facing, IOR)
        f = 1.0 if transmitted is None else fresnel_dielectric(dot(direction, facing), IOR)
        if transmitted is not None and face[2] > 0.5:
            exits.append((point, normalize(transmitted), weight * (1 - f)))
        weight *= f
        direction = reflect(direction, facing)
        # Keep the reflected ray inside the box despite a tilted top normal.
        if face[2] > 0.5 and direction[2] > 0:
            direction = normalize((direction[0], direction[1], -direction[2]))
        if weight < 1e-3:
            break
    return exits


def exit_samples(point, view, normal, alpha, f0, uvs, lower, upper, probe, boxes, surface_normal=flat_normal,
                 with_sample=False):
    """Per lobe sample: [(weight, lookup direction)] of the light it brings from above the water.

    weight is the GGX sample weight (G2/G1 x Schlick) times the Fresnel factors;
    the estimate is sum(weight x L) / len(uvs). An endpoint above the level
    looks up the capture without refraction. with_sample appends the lobe sample's
    direction at the endpoint, for a correction that depends on it.
    """
    results = []
    for u1, u2 in uvs:
        sample = sample_ggx_reflection(view, normal, alpha, u1, u2)
        if sample is None:
            continue
        direction, weight, cos_vh = sample
        weight *= schlick(f0, cos_vh)
        if point[2] >= upper[2]:
            exits = [(point, direction, 1.0)]
        else:
            exits = water_exits(point, direction, lower, upper, surface_normal)
        for origin, out, transmittance in exits:
            lookup = nested_box_lookup(origin, out, probe, boxes) or out
            results.append((weight * transmittance, lookup, direction) if with_sample else
                           (weight * transmittance, lookup))
    return results


def radical_inverse(index):
    """Van der Corput sequence in base 2."""
    result, scale = 0.0, 0.5
    while index:
        result += (index & 1) * scale
        index >>= 1
        scale /= 2
    return result


def hammersley(count, shift=(0.0, 0.0)):
    """Hammersley points ((i + 0.5) / count, radical inverse) with a Cranley-Patterson rotation.

    A fixed point set rotated by a per-pixel random shift is what a shader can afford.
    """
    return [(((i + 0.5) / count + shift[0]) % 1.0, (radical_inverse(i) + shift[1]) % 1.0) for i in range(count)]
