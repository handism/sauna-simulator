import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CAUSTIC_OVERCAST,
  CAUSTIC_SCENES,
  CELLS,
  applyCaustics,
  causticCells,
  causticLight,
  isCausticMaterial,
  patchCausticShader,
} from './caustics';
import { sceneWeights } from './lighting';
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
    expect(fragment).toContain('uniform float suiCausticLight;');
    expect(fragment).toContain('* ( suiCausticLight * sui_caustic_strength(');
    expect(fragment.indexOf('totalEmissiveRadiance += vec3( 0.276, 0.462, 0.396 )')).toBeGreaterThan(
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

  it('reads the cached cells when given them', () => {
    const cells = causticCells();
    expect([cells.image.width, cells.image.height, cells.image.depth]).toEqual(CELLS.size);
    const shader = { ...physical(), uniforms: {} as Record<string, THREE.IUniform> };
    patchCausticShader(shader, cells);
    expect(shader.fragmentShader).toContain('#define SUI_CAUSTIC_CELLS');
    expect(shader.uniforms.suiCausticCells.value).toBe(cells);
    const plain = physical();
    patchCausticShader(plain);
    expect(plain.fragmentShader).not.toContain('#define SUI_CAUSTIC_CELLS');
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
    expect(shader.uniforms.suiCausticLight.value).toBe(1);
    const cells = shader.uniforms.suiCausticCells.value as THREE.Texture;
    let freed = 0;
    cells.addEventListener('dispose', () => freed++);
    tile.dispose();
    expect(freed).toBe(1);
  });

  it('shares the scene light with every material', () => {
    const light = { value: 0.5 };
    const tile = named('V10 | submerged light / Teal glazed pool tile');
    applyCaustics(new THREE.Mesh(new THREE.BoxGeometry(), tile), light);
    const shader = { ...physical(), uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    tile.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiCausticLight).toBe(light);
  });

  it('fades the caustics with the sun and under an overcast', () => {
    expect(causticLight(sceneWeights(0), 0)).toBe(1);
    expect(causticLight(sceneWeights(1), 0)).toBeCloseTo(CAUSTIC_SCENES[1]);
    expect(causticLight(sceneWeights(2), 0)).toBeCloseTo(CAUSTIC_SCENES[2]);
    expect(causticLight(sceneWeights(0.5), 0)).toBeCloseTo((1 + CAUSTIC_SCENES[1]) / 2);
    expect(causticLight(sceneWeights(0), 1)).toBeCloseTo(CAUSTIC_OVERCAST);
    expect(causticLight(sceneWeights(0), 2)).toBeCloseTo(CAUSTIC_OVERCAST);
    // Dimmer at every later hour than by day, though the exposure opens.
    for (const time of [0.25, 0.5, 1, 1.5, 2]) expect(causticLight(sceneWeights(time), 0)).toBeLessThan(1);
  });
});
