import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyFoliage, isFoliageMaterial } from './foliage';

const named = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });

describe('foliage', () => {
  it('selects standing leaves but not ground cover, bark or other surfaces', () => {
    for (const name of [
      'V5 forest leaf 2',
      'V6 woodland leaf 4',
      'V11 | maple leaf 0',
      'Forest leaf tone 1',
      'Evergreen foliage',
      'V3 | fern 0',
      'V7 | maple fresh olive',
    ])
      expect(isFoliageMaterial(named(name))).toBe(true);
    for (const name of [
      'V10 | fallen ochre leaves',
      'V9 | layered living moss',
      'Tree bark',
      'V7 | shaded moss garden',
      'Low iron architectural glass',
    ])
      expect(isFoliageMaterial(named(name))).toBe(false);
    expect(isFoliageMaterial(Object.assign(new THREE.MeshBasicMaterial(), { name: 'V5 forest leaf 0' }))).toBe(false);
  });

  it('shades both faces without passing light to the far face', () => {
    const material = named('V5 forest leaf 0');
    const version = material.version;
    applyFoliage(material);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.version).toBeGreaterThan(version);
    // The standard program is kept: no far-face light, no separate shader.
    expect(material.customProgramCacheKey()).toBe(named('Tree bark').customProgramCacheKey());
  });
});
