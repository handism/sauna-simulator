import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWaterEffects, waveHeight, waveSpeed } from './waterEffects';
import { createMirrorUniforms } from './planarReflection';
import { createIrradianceUniforms } from './irradiance';

describe('water surface', () => {
  it('blends only the Fresnel reflection, from the mirror or the reflection probes, over the pool', () => {
    const probes = createIrradianceUniforms();
    const mirror = createMirrorUniforms();
    const water = createWaterEffects(
      { center: [1.18, 0.785, -2.5], size: [2.65, 3.17], inlet: [1.18, 0.79, -4.12], spout: [1.18, 1.12, -4.12] },
      probes,
      mirror,
    );
    const surface = water.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    // Scene-linear radiance, tone mapped like every other surface.
    expect(surface.material.toneMapped).toBe(true);
    expect(surface.material.defines).toHaveProperty('SUI_REFLECTION');
    expect(surface.material.uniforms.suiProbeCourtyard).toBe(probes.suiProbeCourtyard);
    expect(surface.material.uniforms.suiIrradianceEvening).toBe(probes.suiIrradianceEvening);
    expect(surface.material.fragmentShader).toContain('fresnel');
    expect(surface.material.fragmentShader).toContain('suiReflection(');
    expect(surface.material.uniforms.suiMirrorAmount).toBe(mirror.suiMirrorAmount);
    expect(surface.material.fragmentShader).toContain('texture2D(suiMirror');
    expect(water.surface).toBe(surface);
    expect(surface.castShadow).toBe(false);
    water.update(12, true);
    expect(surface.material.uniforms.time.value).toBe(0);
  });

  it('reproduces the fitted waves of the source water mesh', () => {
    // Rings around the spout (blender (1.18, 3.99)) and a plane wave; heights in meters.
    const plane = (x: number, z: number) => 0.00068389 * Math.sin(15 * x - 10 * z);
    expect(waveHeight(1.18, -3.99) - plane(1.18, -3.99)).toBeCloseTo(0, 9);
    const r = 0.5;
    expect(waveHeight(1.18 + r, -3.99) - plane(1.18 + r, -3.99)).toBeCloseTo(
      0.005585 * Math.exp(-1.6814 * r) * Math.sin(33.988 * r),
      9,
    );
    // Capillary–gravity waves of 18 cm run at about 0.54 m/s.
    expect(waveSpeed(33.988) / 33.988).toBeCloseTo(0.54, 2);
    expect(Math.abs(waveHeight(1.18, -2.5))).toBeLessThan(0.006);
  });
});
