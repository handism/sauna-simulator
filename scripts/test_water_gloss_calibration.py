"""Independent limits for the dry calibration's solid-angle integration."""
import unittest
import numpy as np
from diagnose_water_gloss_calibration import integrate


class CalibrationTests(unittest.TestCase):
    def test_axial_lambert_disk_has_closed_form(self):
        # Unit radiance above a white Lambert plane: sin(angular radius)^2.
        for radius, height in ((1., 3.), (.3, 5.)):
            result = integrate(np.zeros(3), np.array([0.,1.,0.]),
                               (np.array([0.,height,0.]), (0.,-1.,0.), radius))
            expected = radius**2 / (height**2 + radius**2)
            self.assertAlmostEqual(result[0] / expected, 1., delta=.002)
            self.assertGreater(result[1], 0.)

    def test_disk_back_does_not_emit(self):
        result = integrate(np.zeros(3), np.array([0.,1.,0.]),
                           (np.array([0.,3.,0.]), (0.,1.,0.), 1.))
        np.testing.assert_array_equal(result, [0.,0.,0.])

    def test_translation_does_not_change_integral(self):
        light = (np.array([2.,3.,1.]), (-.3,-.9,-.2), 1.)
        p = np.array([0.,.2,0.])
        view = np.array([-.4,.8,-.4]); view /= np.linalg.norm(view)
        shift = np.array([5.,0.,-7.])
        a = integrate(p, view, light, 201)
        b = integrate(p+shift, view, (light[0]+shift,light[1],light[2]), 201)
        np.testing.assert_allclose(a,b,rtol=1e-12)


if __name__ == '__main__':
    unittest.main()
