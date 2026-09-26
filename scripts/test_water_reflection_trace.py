import math
import random
import unittest

from diagnose_water_paths import IOR, box_exit
from water_path_trace import advance
from water_reflection_trace import (dot, fresnel_dielectric, normalize, sample_ggx_reflection,
                                    schlick, smith_lambda, trace_branches)

LOWER, UPPER = (-1, -1, 0.1), (1, 1, 1)


def box_water(origin, direction):
    """Nearest box face from either side (slab test), with the face's outward normal."""
    best = None
    for axis in range(3):
        if abs(direction[axis]) < 1e-12:
            continue
        for plane, sign in ((LOWER[axis], -1), (UPPER[axis], 1)):
            distance = (plane - origin[axis]) / direction[axis]
            if distance <= 1e-9:
                continue
            point = advance(origin, direction, distance)
            if all(LOWER[i] - 1e-9 <= point[i] <= UPPER[i] + 1e-9 for i in range(3) if i != axis):
                if best is None or distance < best[0]:
                    best = (distance, tuple(sign if i == axis else 0 for i in range(3)))
    return best


def floor_at(level):
    def surface(origin, direction, visibility):
        if direction[2] >= 0:
            return None
        distance = (level - origin[2]) / direction[2]
        return {'distance': distance, 'position': advance(origin, direction, distance),
                'visibility': visibility} if distance > 0 else None
    return surface


class FresnelTest(unittest.TestCase):
    def test_normal_incidence_and_symmetry(self):
        expected = ((IOR - 1) / (IOR + 1)) ** 2
        self.assertAlmostEqual(fresnel_dielectric(1, 1 / IOR), expected)
        self.assertAlmostEqual(fresnel_dielectric(1, IOR), expected)

    def test_total_internal_reflection(self):
        critical = math.asin(1 / IOR)
        self.assertEqual(fresnel_dielectric(math.cos(critical + 0.01), IOR), 1.0)
        self.assertLess(fresnel_dielectric(math.cos(critical - 0.05), IOR), 1.0)

    def test_schlick_limits(self):
        self.assertAlmostEqual(schlick(0.04, 1), 0.04)
        self.assertAlmostEqual(schlick(0.04, 0), 1)


class GgxTest(unittest.TestCase):
    def test_smooth_lobe_is_mirror(self):
        view = (math.sin(0.6), 0, math.cos(0.6))
        direction, weight, _ = sample_ggx_reflection(view, (0, 0, 1), 1e-4, 0.3, 0.7)
        for a, b in zip(direction, (-view[0], 0, view[2])):
            self.assertAlmostEqual(a, b, places=3)
        self.assertAlmostEqual(weight, 1, places=4)

    def test_sample_weights_match_brdf_quadrature(self):
        # Mean VNDF weight = single-scattering directional albedo without Fresnel.
        def quadrature(mu, alpha, n=160):
            view, total = (math.sqrt(1 - mu * mu), 0, mu), 0
            for i in range(n):
                for j in range(n):
                    cos_l, phi = (i + 0.5) / n, 2 * math.pi * (j + 0.5) / n
                    sin_l = math.sqrt(1 - cos_l * cos_l)
                    light = (sin_l * math.cos(phi), sin_l * math.sin(phi), cos_l)
                    h = normalize(tuple(a + b for a, b in zip(view, light)))
                    d = alpha ** 2 / (math.pi * (h[2] ** 2 * (alpha ** 2 - 1) + 1) ** 2)
                    g = 1 / (1 + smith_lambda(mu, alpha) + smith_lambda(cos_l, alpha))
                    total += d * g / (4 * mu) * 2 * math.pi / n / n
            return total
        rng = random.Random(3)
        normal = (0, 0.6, 0.8)
        view = (0.0, -0.28, 0.96)
        mu = dot(view, normal)
        for alpha in (0.09, 0.62):
            total = 0
            for _ in range(20000):
                sample = sample_ggx_reflection(view, normal, alpha, rng.random(), rng.random())
                if sample is None:
                    continue
                direction, weight, _ = sample
                self.assertGreater(dot(direction, normal), 0)
                self.assertAlmostEqual(dot(direction, direction), 1, places=9)
                total += weight
            self.assertAlmostEqual(total / 20000, quadrature(mu, alpha), delta=0.01)

    def test_back_facing_view_rejected(self):
        self.assertIsNone(sample_ggx_reflection((0, 0, -1), (0, 0, 1), 0.3, 0.5, 0.5))


class BranchTest(unittest.TestCase):
    def test_weights_are_conserved(self):
        results = trace_branches((0.2, 0, 0.05), (0.3, 0.1, math.sqrt(0.9)), box_water, lambda *a: None)
        self.assertAlmostEqual(sum(r['weight'] for r in results), 1, places=12)

    def test_upward_ray_through_gap_and_water(self):
        # From a floor below the water: enter the bottom, leave the top to the sky.
        results = trace_branches((0, 0, 0.0), (0, 0, 1), box_water, floor_at(0.0))
        escape = [r for r in results if r['kind'] == 'escape']
        self.assertEqual(len(escape), 1)
        self.assertEqual([e[0] for e in escape[0]['events']], ['enter', 'exit'])
        self.assertAlmostEqual(escape[0]['water_length'], 0.9, places=3)
        r = ((IOR - 1) / (IOR + 1)) ** 2
        self.assertAlmostEqual(escape[0]['weight'], (1 - r) ** 2)

    def test_steep_ray_is_totally_reflected_at_top(self):
        # 60 degrees from the normal inside water exceeds the 48.6 degree critical angle.
        inside = (math.sin(math.radians(60)), 0, math.cos(math.radians(60)))
        results = trace_branches((-0.9, 0, 0.5), inside, box_water, floor_at(0.0), inside=True)
        first = [r for r in results if r['events'][:1] == [('tir', 'top')]]
        self.assertAlmostEqual(sum(r['weight'] for r in first), 1, places=12)
        self.assertTrue(any(r['kind'] == 'surface' and r['events'][-1][0] == 'exit' for r in first))

    def test_prune_and_event_limit(self):
        results = trace_branches((0, 0, 0.5), (0.8, 0, 0.6), box_water, lambda *a: None,
                                 inside=True, max_events=2, min_weight=0.5)
        kinds = {r['kind'] for r in results}
        self.assertTrue(kinds <= {'pruned', 'event_limit', 'escape'})
        self.assertAlmostEqual(sum(r['weight'] for r in results), 1, places=12)


if __name__ == '__main__':
    unittest.main()
