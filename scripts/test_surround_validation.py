import copy
import math
import unittest

from summarize_auto_motion import validate_surround, validate_conditions


class SurroundValidationTests(unittest.TestCase):
    def setUp(self):
        self.looks = [{'seconds': 20 + frame, 'progress': frame / 150,
                       'totalX': frame / 150 * 2 * math.pi / .004,
                       'pitchOffset': -.4 * math.sin(frame / 150 * math.pi * 4)}
                      for frame in range(151)]

    def test_reverse_conditions_reject_previous_or_duplicate_routes(self):
        validate_conditions([('water', 27), ('totonou', 12)], 'outdoor-reverse')
        for conditions in [[('water', 12), ('totonou', 27)],
                           [('water', 27), ('water', 27)], [('water', 27)]]:
            with self.assertRaisesRegex(ValueError, 'Missing or duplicate'):
                validate_conditions(conditions, 'outdoor-reverse')
        with self.assertRaises(ValueError):
            validate_conditions([('water', 27), ('totonou', 12)], 'outdoor')

    def test_complete_sequence(self):
        validate_surround(self.looks)

    def test_full_pitch_sequence_and_mode_mismatch(self):
        data = copy.deepcopy(self.looks)
        for sample in data:
            sample['pitchOffset'] *= .86 / .4
        validate_surround(data, full_pitch=True)
        with self.assertRaisesRegex(ValueError, 'vertical'):
            validate_surround(self.looks, full_pitch=True)
        with self.assertRaisesRegex(ValueError, 'vertical'):
            validate_surround(data)

    def test_modified_vertical_trajectory_rejected(self):
        data = copy.deepcopy(self.looks)
        data[30]['pitchOffset'] += .01
        with self.assertRaisesRegex(ValueError, 'vertical'):
            validate_surround(data)

    def test_endpoint_alone_cannot_prove_coverage(self):
        with self.assertRaises(ValueError):
            validate_surround(self.looks[-1:])

    def test_missing_middle_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Missing'):
            validate_surround(self.looks[:50] + self.looks[60:])

    def test_wrong_total_rejected(self):
        data = copy.deepcopy(self.looks)
        data[50]['totalX'] += 20
        with self.assertRaisesRegex(ValueError, 'Inconsistent'):
            validate_surround(data)

    def test_flat_vertical_input_rejected(self):
        data = copy.deepcopy(self.looks)
        for sample in data:
            sample['pitchOffset'] = 0
        with self.assertRaisesRegex(ValueError, 'vertical'):
            validate_surround(data)


if __name__ == '__main__':
    unittest.main()
