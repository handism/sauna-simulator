import math
import unittest

from diagnose_water_paths import box_exit
from water_path_trace import advance, reflect, trace_path


def boundary(origin, direction):
    return box_exit(origin, direction, (-1, -1, -1), (1, 1, 1))


def floor_at(level):
    def surface(origin, direction, visibility):
        if direction[2] >= 0:
            return None
        distance = (level - origin[2]) / direction[2]
        if distance <= 0:
            return None
        return {'distance': distance, 'position': advance(origin, direction, distance), 'visibility': visibility}
    return surface


class WaterTraceTest(unittest.TestCase):
    def test_reflection_preserves_length_and_tangent(self):
        self.assertEqual(reflect((0.6, 0, -0.8), (1, 0, 0)), (-0.6, 0, -0.8))

    def test_object_before_boundary(self):
        result = trace_path((0, 0, 0.8), (0, 0, -1), boundary, floor_at(0))
        self.assertEqual(result['terminal'], 'surface_inside')
        self.assertEqual(result['events'], [])
        self.assertAlmostEqual(result['hit']['position'][2], 0)

    def test_side_tir_reaches_floor(self):
        result = trace_path((0.9, 0, 0.8), (0.6, 0, -0.8), boundary, floor_at(-0.9))
        self.assertEqual(result['terminal'], 'surface_inside')
        self.assertEqual([e['kind'] for e in result['events']], ['tir'])
        self.assertAlmostEqual(result['hit']['position'][0], -0.175)
        self.assertEqual(result['hit']['visibility'], 'glossy')

    def test_transmission_reaches_exterior(self):
        result = trace_path((0, 0, 0.8), (0, 0, -1), boundary, floor_at(-1.2))
        self.assertEqual(result['terminal'], 'surface_outside')
        self.assertEqual(result['events'][0]['kind'], 'transmit')
        self.assertAlmostEqual(result['hit']['position'][2], -1.2)

    def test_repeated_tir_is_bounded(self):
        # Avoid exact corner ties, which are not a physical single-face boundary.
        result = trace_path((0.1, 0, 0), (0.6, 0.6, -math.sqrt(0.28)), boundary, lambda *args: None, max_events=3)
        self.assertEqual(result['terminal'], 'event_limit')
        self.assertEqual(len(result['events']), 3)

    def test_reentry_is_not_silently_ignored(self):
        def concave_boundary(origin, direction):
            return (0.2, (0, 0, -1))
        result = trace_path((0, 0, 0.8), (0, 0, -1), concave_boundary, floor_at(-1.2))
        self.assertEqual(result['terminal'], 'water_reentry')

    def test_escape_and_missing_boundary(self):
        result = trace_path((0, 0, 0.8), (0, 0, -1), boundary, lambda *args: None)
        self.assertEqual(result['terminal'], 'escape')
        result = trace_path((0, 0, 0.8), (0, 0, -1), lambda *args: None, lambda *args: None)
        self.assertEqual(result['terminal'], 'boundary_miss')


if __name__ == '__main__':
    unittest.main()
