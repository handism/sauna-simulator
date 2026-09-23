import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createWaterEffects } from './waterEffects';

describe('water surface', () => {
  it('blends only the Fresnel reflection of the live sky color over the pool', () => {
    const sky = new THREE.Color('#4f616c');
    const water = createWaterEffects(
      { center: [1.18, 0.785, -2.5], size: [2.65, 3.17], inlet: [1.18, 0.79, -4.12], spout: [1.18, 1.12, -4.12] },
      sky,
    );
    const surface = water.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
    // The background is displayed without tone mapping, so the reflection must match it.
    expect(surface.material.toneMapped).toBe(false);
    expect(surface.material.uniforms.sky.value).toBe(sky);
    expect(surface.material.fragmentShader).toContain('fresnel');
    expect(surface.castShadow).toBe(false);
    water.update(12, true);
    expect(surface.material.uniforms.time.value).toBe(0);
  });
});
