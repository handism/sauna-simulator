import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyCaustics, isCausticMaterial, patchCausticShader } from './caustics';
import { patchNoiseColorShader } from './noiseColor';

const named = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });
const physical = () => ({
  vertexShader: THREE.ShaderLib.physical.vertexShader,
  fragmentShader: THREE.ShaderLib.physical.fragmentShader,
});

describe('caustics', () => {
  it('selects the two submerged source materials only', () => {
    expect(isCausticMaterial(named('V10 | submerged light / Teal glazed pool tile'))).toBe(true);
    expect(isCausticMaterial(named('V10 | submerged light / V9 | quiet honed stone / V2 | mineral c'))).toBe(true);
    expect(isCausticMaterial(named('V9 | quiet honed stone'))).toBe(false);
    expect(isCausticMaterial(Object.assign(new THREE.MeshBasicMaterial(), { name: 'V10 | submerged light / x' }))).toBe(
      false,
    );
  });

  it('adds the emission in Blender axes after the emissive map', () => {
    const shader = physical();
    patchCausticShader(shader);
    expect(shader.vertexShader).toContain('vSuiCausticPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    const fragment = shader.fragmentShader;
    expect(fragment).toContain('vec3( vSuiCausticPosition.x, - vSuiCausticPosition.z, vSuiCausticPosition.y )');
    expect(fragment.indexOf('totalEmissiveRadiance += vec3( 0.46, 0.77, 0.66 )')).toBeGreaterThan(
      fragment.indexOf('#include <emissivemap_fragment>'),
    );
    expect(fragment.indexOf('float sui_caustic_strength(')).toBeLessThan(fragment.indexOf('void main() {'));
    expect(() => patchCausticShader({ vertexShader: '', fragmentShader: '' })).toThrow();
  });

  it('defines the shared noise once next to a noise color patch', () => {
    const shader = physical();
    patchNoiseColorShader(shader);
    patchCausticShader(shader);
    expect(shader.fragmentShader.split('float sui_fbm(').length).toBe(2);
    expect(shader.fragmentShader.indexOf('float sui_fbm(')).toBeLessThan(
      shader.fragmentShader.indexOf('sui_noise_color('),
    );
  });

  it('composes with earlier hooks and keys the program', () => {
    const tile = named('V10 | submerged light / Teal glazed pool tile');
    const calls: string[] = [];
    tile.onBeforeCompile = () => calls.push('earlier');
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), tile), new THREE.Mesh(new THREE.BoxGeometry(), named('Other')));
    expect(applyCaustics(root)).toBe(1);
    const shader = { ...physical(), uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    tile.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(calls).toEqual(['earlier']);
    expect(shader.fragmentShader).toContain('sui_caustic_strength');
    expect(tile.customProgramCacheKey()).toContain('|caustics');
  });
});
