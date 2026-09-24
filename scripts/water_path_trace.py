"""Geometry-only continuation of refracted water rays; callbacks use Blender axes."""
from diagnose_water_paths import IOR, refract

EPSILON = 1e-4


def reflect(direction, normal):
    dot = sum(a * b for a, b in zip(direction, normal))
    return tuple(d - 2 * dot * n for d, n in zip(direction, normal))


def advance(origin, direction, distance):
    return tuple(p + d * distance for p, d in zip(origin, direction))


def trace_path(origin, direction, boundary, surface, max_events=8):
    """Follow TIR and the transmitted branch otherwise, stopping at a scene surface.

    boundary(origin, direction) -> (distance, outward normal) or None.
    surface(origin, direction, visibility) -> JSON record with distance or None.
    Non-water materials are terminal, even if transparent. Fresnel branch weights
    and shading are deliberately not evaluated. After leaving water, reentry is
    reported as unresolved rather than tracing an incorrect air-only path.
    """
    direction = tuple(direction)
    origin = advance(origin, direction, EPSILON)
    events = []
    visibility = 'transmission'
    for _ in range(max_events):
        edge = boundary(origin, direction)
        hit = surface(origin, direction, visibility)
        if hit is not None and (edge is None or hit['distance'] < edge[0]):
            return {'terminal': 'surface_inside', 'events': events, 'hit': hit}
        if edge is None:
            return {'terminal': 'boundary_miss', 'events': events}
        distance, normal = edge
        location = advance(origin, direction, distance)
        transmitted = refract(direction, tuple(-n for n in normal), IOR)
        kind = 'tir' if transmitted is None else 'transmit'
        events.append({'kind': kind, 'face': 'bottom' if normal[2] < -0.5 else 'top' if normal[2] > 0.5 else 'side',
                       'position': location, 'normal': tuple(normal)})
        if transmitted is None:
            direction = reflect(direction, normal)
            origin = advance(location, direction, EPSILON)
            visibility = 'glossy'
            continue
        outside = advance(location, transmitted, EPSILON)
        hit = surface(outside, transmitted, 'transmission')
        reentry = boundary(outside, transmitted)
        if reentry is not None and (hit is None or reentry[0] < hit['distance']):
            return {'terminal': 'water_reentry', 'events': events}
        return {'terminal': 'surface_outside' if hit else 'escape', 'events': events, 'hit': hit}
    return {'terminal': 'event_limit', 'events': events}
