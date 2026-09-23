import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyFoliageTransmission, isFoliageMaterial, patchFoliageShader } from './foliage';

const named = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });

describe('foliage transmission', () => {
  it('selects standing leaves but not ground cover, bark or other surfaces', () => {
    for (const name of ['V5 forest leaf 2', 'V6 woodland leaf 4', 'V11 | maple leaf 0', 'Forest leaf tone 1',
      'Evergreen foliage', 'V3 | fern 0', 'V7 | maple fresh olive']) expect(isFoliageMaterial(named(name))).toBe(true);
    for (const name of ['V10 | fallen ochre leaves', 'V9 | layered living moss', 'Tree bark',
      'V7 | shaded moss garden', 'Low iron architectural glass']) expect(isFoliageMaterial(named(name))).toBe(false);
    expect(isFoliageMaterial(Object.assign(new THREE.MeshBasicMaterial(), { name: 'V5 forest leaf 0' }))).toBe(false);
  });

  it('adds far-face direct and hemisphere light to the installed physical shader', () => {
    const shader = patchFoliageShader(THREE.ShaderLib.physical.fragmentShader);
    expect(shader).toContain('#define RE_Direct RE_Direct_Foliage');
    expect(shader).toContain('saturate( - dot( geometryNormal, directLight.direction ) )');
    expect(shader).toContain('getHemisphereLightIrradiance( hemisphereLights[ i ], - geometryNormal )');
    expect(shader).not.toContain('#include <lights_fragment_begin>');
    expect(() => patchFoliageShader('void main() {}')).toThrow();
  });

  it('keeps a separate double-sided program for foliage', () => {
    const material = named('V5 forest leaf 0');
    const version = material.version;
    applyFoliageTransmission(material);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.customProgramCacheKey()).toBe('foliage-transmission');
    expect(material.version).toBeGreaterThan(version);
    expect(named('Tree bark').customProgramCacheKey()).not.toBe('foliage-transmission');
  });
});
