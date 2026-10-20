import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AIR_START, airAmount } from './aerialPerspective';
import { createIrradianceUniforms } from './irradiance';

describe('aerial perspective', () => {
  it('leaves the near scene clear and hazes the garden more with distance', () => {
    expect(airAmount(0)).toBe(0);
    expect(airAmount(AIR_START)).toBe(0);
    // The woodland's far edge stays mostly clear; the far forest behind it takes more of the air.
    expect(airAmount(44)).toBeGreaterThan(0.05);
    expect(airAmount(44)).toBeLessThan(0.12);
    expect(airAmount(54)).toBeGreaterThan(airAmount(44));
    expect(airAmount(54)).toBeLessThan(0.2);
    expect(airAmount(1e4)).toBeCloseTo(1, 5);
  });

  it('mixes standard materials with the probes before tone mapping', () => {
    const chunk = THREE.ShaderChunk.tonemapping_fragment;
    expect(chunk.indexOf('suiAirAmount')).toBeGreaterThanOrEqual(0);
    expect(chunk.indexOf('suiAirAmount')).toBeLessThan(chunk.indexOf('toneMapping('));
    expect(chunk).toContain('defined( SUI_IRRADIANCE ) && defined( STANDARD )');
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('uniform vec3 suiAirColor;');
    expect(createIrradianceUniforms().suiAirColor.value).toBeInstanceOf(THREE.Color);
  });
});
