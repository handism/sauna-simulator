import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyFoliageTransmission } from './foliage';
import { applyNoiseColor, noiseColorOf, patchNoiseColorShader, type NoiseColor } from './noiseColor';

const moss: NoiseColor = { space: 'blender_world', scale: 1.05, detail: 3.5, roughness: .72, lacunarity: 2,
  stops: [[.23, .014, .025, .008], [.51, .055, .088, .019], [.77, .15, .19, .047]] };
const named = (name: string, suiNoiseColor?: unknown) =>
  Object.assign(new THREE.MeshStandardMaterial(), { name, userData: suiNoiseColor ? { suiNoiseColor } : {} });
const physical = () => ({ vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader });

describe('noise color', () => {
  it('reads exported noise parameters and rejects malformed ones', () => {
    expect(noiseColorOf(named('V9 | layered living moss', moss))).toBe(moss);
    expect(noiseColorOf(named('Tree bark'))).toBeNull();
    expect(noiseColorOf(Object.assign(new THREE.MeshBasicMaterial(), { userData: { suiNoiseColor: moss } }))).toBeNull();
    expect(() => noiseColorOf(named('bad', { ...moss, detail: 16 }))).toThrow();
    expect(() => noiseColorOf(named('bad', { ...moss, stops: [] }))).toThrow();
    expect(() => noiseColorOf(named('bad', { ...moss, stops: [moss.stops[1], moss.stops[0]] }))).toThrow();
  });

  it('samples world positions in Blender axes after the installed color chunk', () => {
    const shader = physical();
    patchNoiseColorShader(shader);
    expect(shader.vertexShader).toContain('vSuiNoisePosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    expect(shader.fragmentShader).toContain('vec3( vSuiNoisePosition.x, - vSuiNoisePosition.z, vSuiNoisePosition.y )');
    expect(shader.fragmentShader.indexOf('diffuseColor.rgb = sui_ramp')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <color_fragment>'));
    expect(() => patchNoiseColorShader({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}' })).toThrow();
  });

  it('pads ramp stops into uniforms and composes with foliage transmission', () => {
    const fern = named('V3 | fern 0', { ...moss, stops: [[0, .01, .03, .007], [1, .07, .16, .028]] });
    applyFoliageTransmission(fern);
    applyNoiseColor(fern, noiseColorOf(fern)!);
    const shader = { ...physical(), uniforms: {} as Record<string, THREE.IUniform> };
    fern.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('#define RE_Direct RE_Direct_Foliage');
    expect(shader.fragmentShader).toContain('sui_fbm(');
    expect(shader.uniforms.suiNoiseStopCount.value).toBe(2);
    expect(shader.uniforms.suiNoiseStops.value.map((stop: THREE.Vector4) => stop.x)).toEqual([0, 1, 1, 1]);
    expect(fern.customProgramCacheKey()).toBe('foliage-transmission|noise-color');
  });
});
