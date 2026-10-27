import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DECK_BOARDS, DECK_SNOW, applyWinterSnow, patchWinterSnowShader, receivesWinterSnow } from './winterSnow';

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
    // The drift bump follows the final normal, before lighting.
    expect(shader.fragmentShader.indexOf('suiSnowGradient')).toBeGreaterThan(
      shader.fragmentShader.indexOf('#include <normal_fragment_maps>'),
    );
    expect(shader.fragmentShader.indexOf('suiSnowGradient')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <lights_fragment_begin>'),
    );
  });
  it("ends the open deck's snow board by board, short of the roofs and the walked middle", () => {
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchWinterSnowShader(shader);
    // Each board's own reach, from the exported boards' grid.
    expect(shader.fragmentShader).toContain(
      `floor((suiSnowP.x - ${DECK_BOARDS.x0.toFixed(3)}) / ${DECK_BOARDS.pitch.toFixed(2)})`,
    );
    expect(shader.fragmentShader).toContain('suiSnowHash(vec2(suiBoard, 3.7))');
    // Even with the drifts and the ragged edge, the snow stays on the open deck past the roofs (z 0.74).
    const deepest = DECK_SNOW.reach[1] + DECK_SNOW.drift / 2 + DECK_SNOW.fray * 0.75;
    expect(DECK_BOARDS.end - deepest).toBeGreaterThan(1.3);
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
    expect(receivesWinterSnow('V3 | fern 2')).toBe(true);
    // The deck's planks beyond the roofs' edge.
    expect(receivesWinterSnow('V7 | locally damp ash.012')).toBe(true);
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
    expect(material.customProgramCacheKey()).toBe('existing|winter-snow-v2');
    amount.value = 1;
    expect(shader.uniforms.suiWinterSnow.value).toBe(1);
  });
  it('gives the fern fronds a dusting and the evergreen crowns clumped snow on their own programs', () => {
    const fern = new THREE.MeshStandardMaterial({ name: 'V3 | fern 1' });
    const crown = new THREE.MeshStandardMaterial({ name: 'V6 woodland leaf 2 card evergreen' });
    applyWinterSnow(fern, { value: 1 });
    applyWinterSnow(crown, { value: 1 });
    expect(fern.defines).toHaveProperty('SUI_SNOW_DUSTING');
    expect(fern.defines).not.toHaveProperty('SUI_SNOW_CROWN');
    expect(crown.defines).toHaveProperty('SUI_SNOW_CROWN');
    expect(crown.defines).not.toHaveProperty('SUI_SNOW_DUSTING');
    expect(fern.customProgramCacheKey()).not.toBe(crown.customProgramCacheKey());
  });
});
