import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applySurfaceDetails, patchSurfaceDetailShader, surfaceDetailOf } from './surfaceDetails';
import { applyWinterSnow } from './winterSnow';

describe('deck and stone surface details', () => {
  it('targets outdoor surfaces without changing indoor timber, pool tiles or submerged light materials', () => {
    expect(surfaceDetailOf('V2 | outdoor ash / grain & wear')).toBe('deck');
    expect(surfaceDetailOf('V7 | locally damp ash.035')).toBe('deck');
    expect(surfaceDetailOf('V2 | pale mineral paving')).toBe('stone');
    expect(surfaceDetailOf('Garden mineral charcoal stone')).toBe('stone');
    expect(surfaceDetailOf('V9 | layered living moss')).toBe('ground');
    expect(surfaceDetailOf('V3 | moss and woodland earth')).toBe('ground');
    for (const name of [
      'V2 | warm open-grain timber',
      'Teal glazed pool tile',
      'Low iron architectural glass',
      'V10 | submerged light / V9 | quiet honed stone / V2 | mineral c',
      'V7 | shaded moss garden',
      'Fine garden gravel',
    ])
      expect(surfaceDetailOf(name)).toBeNull();
  });

  it.each(['deck', 'stone', 'ground'] as const)(
    'composes %s with existing materials and snow without adding texture samplers',
    (kind) => {
      const material = new THREE.MeshStandardMaterial();
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader += '\n// previous extension';
      };
      material.customProgramCacheKey = () => 'original';
      const snow = { value: 1 };
      applySurfaceDetails(material, kind);
      applyWinterSnow(material, snow);
      const shader = { ...THREE.ShaderLib.standard, uniforms: { ...THREE.ShaderLib.standard.uniforms } };
      material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain('// previous extension');
      expect(shader.uniforms.suiWinterSnow.value).toBe(1);
      expect(shader.fragmentShader.indexOf('diffuseColor.rgb *=')).toBeLessThan(
        shader.fragmentShader.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78'),
      );
      expect(shader.fragmentShader.match(/sampler2D/g)?.length ?? 0).toBe(
        THREE.ShaderLib.standard.fragmentShader.match(/sampler2D/g)?.length ?? 0,
      );
      expect(material.customProgramCacheKey()).toContain(`original|surface-details-${kind}-v1|winter-snow`);
      expect(shader.vertexShader).toContain('vSuiSurfacePosition = (modelMatrix');
      expect(shader.vertexShader).toContain('vSuiSurfaceUp = normalize(mat3(modelMatrix) * objectNormal).y');
      material.dispose();
    },
  );

  it('rejects incompatible shader chunks', () => {
    expect(() => patchSurfaceDetailShader({ vertexShader: '', fragmentShader: '' }, 'deck')).toThrow('shader chunks');
  });
});
