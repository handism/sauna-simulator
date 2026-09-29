"""Independent limits of the flat slab diagnostic, without Blender."""
import unittest
import numpy as np
from diagnose_water_gloss_slab import fresnel, floor_position, slab_integral
from diagnose_water_gloss_calibration import integrate


class SlabTests(unittest.TestCase):
    def test_fresnel_normal_and_grazing_limits(self):
        self.assertAlmostEqual(fresnel(1., 1.333), ((1.333-1)/(1.333+1))**2)
        self.assertAlmostEqual(fresnel(0., 1.333), 1.)
        np.testing.assert_allclose(fresnel(np.array([.2,.6,1.]), 1.), 0., atol=1e-30)

    def test_view_mapping_no_interface_and_normal_incidence(self):
        p=np.array([1.,.202,-2.])
        v=np.array([-.8,.6,0.])
        np.testing.assert_allclose(floor_position(p,v,1.),p,atol=1e-14)
        np.testing.assert_array_equal(floor_position(p,np.array([0.,1.,0.])),p)
        self.assertLess(floor_position(p,v)[0],p[0])
        self.assertEqual(floor_position(p,v)[1],p[1])

    def test_no_index_contrast_matches_dry_disk(self):
        p=np.array([0.,.202,0.]); v=np.array([-.6,.8,0.])
        light=(np.array([2.,3.,0.]),np.array([0.,-1.,0.]),.7)
        dry=integrate(p,v,light,601)[2]
        wet=slab_integral(p,v,light,601,True,1.)
        self.assertAlmostEqual(wet/dry,1.,delta=.004)

    def test_transmission_reduces_direct_path(self):
        p=np.array([0.,.202,0.]); v=np.array([-.6,.8,0.])
        light=(np.array([2.,3.,0.]),np.array([0.,-1.,0.]),.7)
        a=slab_integral(p,v,light,201,False)
        b=slab_integral(p,v,light,201,True)
        self.assertGreater(b,0.)
        self.assertLess(b,a)


if __name__=='__main__': unittest.main()
