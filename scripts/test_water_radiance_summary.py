import unittest
from summarize_water_radiance import summarize, unavailable_reason


class SummaryTest(unittest.TestCase):
    def test_components_use_total_denominator_and_reject_invalid_hits(self):
        renders = []
        for mode, de, glossy in [('path', 0.25, 0.75), ('camera', 0.5, 0.25), ('overhead', 1, 1)]:
            for seed in (17, 83):
                renders.append({'scene': 'day', 'index': 0, 'mode': mode, 'seed': seed,
                    'valid_position': mode != 'overhead', 'position_error_m': 0 if mode != 'overhead' else 1,
                    'reconstruction_max_abs': 0,
                    'colors': {'combined': [de+glossy]*3, 'diffuse_emission': [de]*3, 'glossy': [glossy]*3}})
        result, _ = summarize({'renders': renders, 'seeds': [17,83], 'selected': [{'group': 'test'}]})
        self.assertEqual(result['invalid_positions'], 2)
        self.assertEqual(result['aggregates']['overhead']['count'], 0)
        row = result['comparisons'][0]
        self.assertEqual(row['combined_rgb_l1_over_path_total'], 0.25)
        self.assertEqual(row['diffuse_emission_rgb_l1_over_path_total'], 0.25)
        self.assertEqual(row['glossy_rgb_l1_over_path_total'], 0.5)
        self.assertEqual(row['path_glossy_fraction'], 0.75)
        self.assertEqual(result['two_seed_total_rgb_difference']['max'], 0)

    def test_unavailable_reason_distinguishes_skip_from_position_error(self):
        report = {'renders': [
            {'scene': 'day', 'index': 0, 'mode': 'overhead', 'skipped': 'backface_or_grazing'},
            {'scene': 'day', 'index': 0, 'mode': 'camera', 'valid_position': False, 'colors': {}}]}
        self.assertEqual(unavailable_reason(report, 'day', 0, 'overhead'), 'grazing / backface')
        self.assertEqual(unavailable_reason(report, 'day', 0, 'camera'), 'position > 0.1 mm')


if __name__ == '__main__':
    unittest.main()
