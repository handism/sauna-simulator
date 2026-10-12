import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyWinterSnow, patchWinterSnowShader, receivesWinterSnow } from './winterSnow';

describe('settled winter snow', () => {
  it('patches the actual standard shader after procedural color and before lighting', () => {
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchWinterSnowShader(shader);
    expect(shader.fragmentShader.indexOf('diffuseColor.rgb = mix')).toBeGreaterThan(
      shader.fragmentShader.indexOf('#include <color_fragment>'),
    );
    expect(shader.fragmentShader.indexOf('diffuseColor.rgb = mix')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <lights_fragment_begin>'),
    );
    expect(shader.vertexShader).toContain('inverseTransformDirection(transformedNormal, viewMatrix)');
  });
  it('keeps snow out of glass, water, pool tiles and textiles', () => {
    for (const name of [
      'Low iron architectural glass',
      'V4 | clear spring water',
      'V10 | submerged light / Teal glazed pool tile',
      'V7 | oatmeal woven towel',
    ])
      expect(receivesWinterSnow(name)).toBe(false);
    expect(receivesWinterSnow('V9 | layered living moss')).toBe(true);
    expect(receivesWinterSnow('Garden evergreen foliage')).toBe(true);
  });
  it('composes existing hooks and shares the mutable season uniform across shader compilations', () => {
    const material = new THREE.MeshStandardMaterial();
    const amount = { value: 0 };
    material.customProgramCacheKey = () => 'existing';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.existing = { value: 1 };
    };
    applyWinterSnow(material, amount);
    const shader = { ...THREE.ShaderLib.standard, uniforms: {} as Record<string, { value: unknown }> };
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.uniforms.existing.value).toBe(1);
    expect(shader.uniforms.suiWinterSnow).toBe(amount);
    expect(material.customProgramCacheKey()).toBe('existing|winter-snow');
    amount.value = 1;
    expect(shader.uniforms.suiWinterSnow.value).toBe(1);
  });
});
