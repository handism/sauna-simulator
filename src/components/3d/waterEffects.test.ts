import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWaterEffects } from './waterEffects';
import { createIrradianceUniforms } from './irradiance';

describe('water surface', () => {
  it('blends only the Fresnel reflection of the reflection probes over the pool', () => {
    const probes = createIrradianceUniforms();
    const water = createWaterEffects(
      { center: [1.18, 0.785, -2.5], size: [2.65, 3.17], inlet: [1.18, 0.79, -4.12], spout: [1.18, 1.12, -4.12] },
      probes,
    );
    const surface = water.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    // Scene-linear radiance, tone mapped like every other surface.
    expect(surface.material.toneMapped).toBe(true);
    expect(surface.material.defines).toHaveProperty('SUI_REFLECTION');
    expect(surface.material.uniforms.suiProbeCourtyard).toBe(probes.suiProbeCourtyard);
    expect(surface.material.uniforms.suiIrradianceEvening).toBe(probes.suiIrradianceEvening);
    expect(surface.material.fragmentShader).toContain('fresnel');
    expect(surface.material.fragmentShader).toContain('suiReflection(');
    expect(surface.castShadow).toBe(false);
    water.update(12, true);
    expect(surface.material.uniforms.time.value).toBe(0);
  });
});
