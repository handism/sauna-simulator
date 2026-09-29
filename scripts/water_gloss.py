"""The refracted path from the plunge's floor to a light above the water (no Blender needed).

The floor lies in the air 1.3 cm under the source water's flat bottom (y 0.215, glTF; z in
Blender); the path to a light rises along its air direction through that gap, more steeply through
the water (IOR 1.333) and along the air direction again above the surface (0.765). Used by
diagnose_water_bottom_gloss.py (Blender axes: z up) and mirrored by waterBottom.ts wetExitRun.
"""
import math

IOR = 1.333
BOTTOM = 0.215
LEVEL = 0.765


def run(floor_height, sine, level=LEVEL):
    """Horizontal run from the floor to the surface of a path whose air direction has `sine`."""
    tangent = sine / math.sqrt(1 - sine * sine)
    water = sine / IOR
    return (BOTTOM - floor_height) * tangent + (level - BOTTOM) * water / math.sqrt(1 - water * water)


def product_exit(floor, light, level=LEVEL):
    """The product's exit (wetExitRun): the air direction of the straight line to the light."""
    dx, dy, dz = (light[i] - floor[i] for i in range(3))
    horizontal = math.hypot(dx, dy)
    if dz <= 0 or horizontal < 1e-9:
        return (floor[0], floor[1], level)
    sine = horizontal / math.sqrt(horizontal * horizontal + dz * dz)
    r = run(floor[2], sine, level)
    return (floor[0] + dx / horizontal * r, floor[1] + dy / horizontal * r, level)


def exact_exit(floor, light, level=LEVEL, steps=60):
    """The exit of the path that actually reaches `light` (bisection on its air direction)."""
    dx, dy = light[0] - floor[0], light[1] - floor[1]
    horizontal = math.hypot(dx, dy)
    if light[2] <= level or horizontal < 1e-9:
        return (floor[0], floor[1], level)
    above = light[2] - level
    low, high = 0.0, 1 - 1e-12
    for _ in range(steps):
        sine = (low + high) / 2
        if run(floor[2], sine, level) + above * sine / math.sqrt(1 - sine * sine) < horizontal:
            low = sine
        else:
            high = sine
    r = run(floor[2], low, level)
    return (floor[0] + dx / horizontal * r, floor[1] + dy / horizontal * r, level)
