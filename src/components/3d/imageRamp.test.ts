import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyImageRamp, imageRampOf, patchImageRampShader, type ImageRamp } from './imageRamp';

const coping: ImageRamp = { luminance: [.2126, .7152, .0722],
  stops: [[.05, .022, .029, .028], [.58, .19, .215, .2]], random: [[0, .72, .72, .72], [1, 1.1, 1.1, 1.1]],
  mix: { factor: .64, color: [.105, .12, .115] } };
const named = (name: string, suiImageRamp?: unknown) =>
  Object.assign(new THREE.MeshStandardMaterial(), { name, userData: suiImageRamp ? { suiImageRamp } : {} });
const physical = () => ({ vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader });

describe('image ramp', () => {
  it('reads exported ramps and rejects malformed ones', () => {
    expect(imageRampOf(named('V9 | quiet honed stone', coping))).toBe(coping);
    expect(imageRampOf(named('V6 | fine soft linen', { ...coping, mix: null }))).not.toBeNull();
    expect(imageRampOf(named('Tree bark'))).toBeNull();
    expect(imageRampOf(Object.assign(new THREE.MeshBasicMaterial(), { userData: { suiImageRamp: coping } }))).toBeNull();
    expect(() => imageRampOf(named('bad', { ...coping, luminance: [1, 1] }))).toThrow();
    expect(() => imageRampOf(named('bad', { ...coping, random: [] }))).toThrow();
    expect(() => imageRampOf(named('bad', { ...coping, stops: [coping.stops[1], coping.stops[0]] }))).toThrow();
    expect(() => imageRampOf(named('bad', { ...coping, mix: { factor: .5 } }))).toThrow();
  });

  it('replaces the texel color after the vertex color chunk', () => {
    const shader = physical();
    patchImageRampShader(shader);
    const fragment = shader.fragmentShader;
    expect(fragment.indexOf('diffuseColor.rgb = mix( suiRampColor')).toBeGreaterThan(fragment.indexOf('#include <color_fragment>'));
    expect(fragment).toContain('dot( sampledDiffuseColor.rgb, suiRampLuminance )');
    expect(fragment).toContain('sui_ramp( vColor.r, suiRandomStops, suiRandomStopCount )');
    expect(() => patchImageRampShader({ fragmentShader: 'void main() {}' })).toThrow();
  });

  it('needs the texture and per-object vertex colors and sets uniforms', () => {
    expect(() => applyImageRamp(named('stone', coping), coping)).toThrow();
    const stone = named('stone', coping);
    stone.map = new THREE.Texture();
    stone.vertexColors = true;
    applyImageRamp(stone, coping);
    const shader = { ...physical(), uniforms: {} as Record<string, THREE.IUniform> };
    stone.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiRampStopCount.value).toBe(2);
    expect(shader.uniforms.suiRandomStops.value.map((stop: THREE.Vector4) => stop.y)).toEqual([.72, 1.1, 1.1, 1.1]);
    expect(shader.uniforms.suiRampMix.value.toArray()).toEqual([.105, .12, .115, .64]);
    expect(stone.customProgramCacheKey()).toMatch(/\|image-ramp$/);
    const linen = named('linen', { ...coping, mix: null });
    linen.map = new THREE.Texture();
    linen.vertexColors = true;
    applyImageRamp(linen, imageRampOf(linen)!);
    linen.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiRampMix.value.w).toBe(0);
  });
});
