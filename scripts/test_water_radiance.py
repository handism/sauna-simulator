import unittest
from diagnose_water_radiance import combine_passes, select_records


class RadianceTest(unittest.TestCase):
    def test_passes_restore_bsdf_color_and_keep_emission_separate(self):
        passes = {p + k: [0, 0, 0] for p in ('Diff', 'Gloss', 'Trans') for k in ('Dir', 'Ind', 'Col')}
        passes.update(DiffDir=[2, 4, 6], DiffInd=[1, 2, 3], DiffCol=[0.5, 0.25, 0.1],
                      GlossDir=[1, 2, 4], GlossCol=[0.1, 0.2, 0.5],
                      TransInd=[2, 4, 6], TransCol=[0.25, 0.5, 1],
                      Emit=[0.1, 0.2, 0.3], Env=[1, 1, 1], Combined=[3.2, 5.1, 10.2])
        result = combine_passes(passes)
        for key, expected in [('diffuse_emission', [1.6, 1.7, 1.2]),
                              ('glossy', [0.1, 0.4, 2]), ('reconstructed', [3.2, 5.1, 10.2])]:
            for actual, value in zip(result[key], expected):
                self.assertAlmostEqual(actual, value)

    def test_selection_is_deterministic_and_retains_rare_group(self):
        def record(i, kind, material):
            return {'pixel': [i, 0], 'events': [{}], 'first_exit': kind,
                    'hit': {'material': material}}
        records = [record(i, 'bottom', 'Teal glazed pool tile') for i in range(10)]
        records += [record(20, 'side_transmit', 'Blackened bronze')]
        chosen = select_records(records, 3)
        self.assertEqual([r['pixel'][0] for r in chosen], [1, 5, 8, 20])
        self.assertEqual(chosen, select_records(list(reversed(records)), 3))
        self.assertEqual(chosen[-1]['population'], 1)


if __name__ == '__main__':
    unittest.main()
