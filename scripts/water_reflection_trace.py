"""Where the specular lobe of an underwater endpoint goes; geometry only, Blender axes.

GGX visible-normal sampling of the endpoint's glossy lobe, then a Fresnel-split
walk through the smooth water volume (both reflected and transmitted branches).
No radiance is evaluated: terminals are weighted by the single-scattering lobe
weight and the water-boundary Fresnel factors only.
"""
import math

from diagnose_water_paths import IOR, refract
from water_path_trace import EPSILON, advance, reflect


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def normalize(v):
    length = math.sqrt(dot(v, v))
    return tuple(x / length for x in v)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def frame(normal):
    """Orthonormal tangent, bitangent for a unit normal."""
    helper = (1, 0, 0) if abs(normal[0]) < 0.9 else (0, 1, 0)
    tangent = normalize(cross(helper, normal))
    return tangent, cross(normal, tangent)


def fresnel_dielectric(cos_incident, eta):
    """Unpolarised Fresnel reflectance; eta = n_incident / n_transmitted."""
    cos_incident = min(1.0, abs(cos_incident))
    sin2 = eta * eta * (1 - cos_incident * cos_incident)
    if sin2 >= 1:
        return 1.0
    cos_t = math.sqrt(1 - sin2)
    rs = (eta * cos_incident - cos_t) / (eta * cos_incident + cos_t)
    rp = (cos_incident - eta * cos_t) / (cos_incident + eta * cos_t)
    return 0.5 * (rs * rs + rp * rp)


def smith_lambda(cos_theta, alpha):
    cos2 = max(cos_theta * cos_theta, 1e-12)
    return (-1 + math.sqrt(1 + alpha * alpha * (1 - cos2) / cos2)) / 2


def sample_ggx_reflection(view, normal, alpha, u1, u2):
    """Heitz 2018 visible-normal sample. Returns (direction, weight, cos_vh) or None.

    weight = G2/G1(view): the single-scattering BRDF*cos/pdf without Fresnel.
    view points away from the surface and must be on the normal's side.
    """
    tangent, bitangent = frame(normal)
    v = (dot(view, tangent), dot(view, bitangent), dot(view, normal))
    if v[2] <= 0:
        return None
    vh = normalize((alpha * v[0], alpha * v[1], v[2]))
    lensq = vh[0] * vh[0] + vh[1] * vh[1]
    t1 = (-vh[1] / math.sqrt(lensq), vh[0] / math.sqrt(lensq), 0) if lensq > 1e-14 else (1, 0, 0)
    t2 = cross(vh, t1)
    r, phi = math.sqrt(u1), 2 * math.pi * u2
    p1, p2 = r * math.cos(phi), r * math.sin(phi)
    s = 0.5 * (1 + vh[2])
    p2 = (1 - s) * math.sqrt(max(0, 1 - p1 * p1)) + s * p2
    p3 = math.sqrt(max(0, 1 - p1 * p1 - p2 * p2))
    nh = tuple(p1 * a + p2 * b + p3 * c for a, b, c in zip(t1, t2, vh))
    m = normalize((alpha * nh[0], alpha * nh[1], max(1e-9, nh[2])))
    cos_vh = dot(v, m)
    local = tuple(2 * cos_vh * mi - vi for mi, vi in zip(m, v))
    if local[2] <= 0:
        return None
    weight = (1 + smith_lambda(v[2], alpha)) / (1 + smith_lambda(v[2], alpha) + smith_lambda(local[2], alpha))
    world = normalize(tuple(local[0] * a + local[1] * b + local[2] * c
                            for a, b, c in zip(tangent, bitangent, normal)))
    return world, weight, cos_vh


def schlick(f0, cos_theta):
    return f0 + (1 - f0) * (1 - max(0.0, min(1.0, cos_theta))) ** 5


def trace_branches(origin, direction, water, surface, weight=1.0, inside=False,
                   max_events=8, min_weight=1e-3):
    """Follow both Fresnel branches at every water boundary.

    water(origin, direction) -> (distance, face normal) of the nearest water
    boundary on either side, or None. surface(origin, direction, visibility)
    -> hit dict with 'distance', or None. Returns terminal dicts with keys
    kind (surface/escape/event_limit/pruned/boundary_miss), weight, inside,
    origin and direction (of the last segment), events (list of 'reflect'/'tir'/'enter'/'exit' with face), water_length
    and hit. The water object itself must be excluded from surface().
    """
    results = []
    stack = [(tuple(origin), tuple(direction), inside, weight, 'glossy', (), 0.0)]
    while stack:
        o, d, inner, w, visibility, events, length = stack.pop()
        o = advance(o, d, EPSILON)
        edge = water(o, d)
        hit = surface(o, d, visibility)
        common = {'weight': w, 'inside': inner, 'origin': o, 'direction': d, 'events': list(events), 'water_length': length}
        if hit is not None and (edge is None or hit['distance'] < edge[0]):
            results.append({'kind': 'surface', 'hit': hit, **common,
                            'water_length': length + (hit['distance'] if inner else 0)})
            continue
        if edge is None:
            results.append({'kind': 'boundary_miss' if inner else 'escape', **common})
            continue
        if len(events) >= max_events:
            results.append({'kind': 'event_limit', **common})
            continue
        distance, normal = edge
        point = advance(o, d, distance)
        length += distance if inner else 0
        facing = normal if dot(d, normal) < 0 else tuple(-n for n in normal)
        face = 'bottom' if normal[2] < -0.5 else 'top' if normal[2] > 0.5 else 'side'
        eta = IOR if inner else 1 / IOR
        transmitted = refract(d, facing, eta)
        f = 1.0 if transmitted is None else fresnel_dielectric(dot(d, facing), eta)
        branches = [(reflect(d, facing), inner, w * f, 'glossy', ('tir' if transmitted is None else 'reflect', face))]
        if transmitted is not None:
            branches.append((normalize(transmitted), not inner, w * (1 - f), 'transmission',
                             ('exit' if inner else 'enter', face)))
        for new_direction, new_inside, new_weight, new_visibility, event in branches:
            if new_weight < min_weight * weight:
                results.append({'kind': 'pruned', 'weight': new_weight, 'inside': new_inside, 'direction': new_direction,
                                'events': list(events) + [event], 'water_length': length})
                continue
            stack.append((point, new_direction, new_inside, new_weight, new_visibility,
                          events + (event,), length))
    return results
