import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createMirrorUniforms } from './planarReflection';
import { applyRainWetness, DECK_AREA, DECK_LEVEL, deckMirrorSurface, patchRainWetnessShader } from './rainWetness';
import { patchSurfaceDetailShader } from './surfaceDetails';
import { patchWinterSnowShader } from './winterSnow';

const mesh = (name: string) => new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ name }));

describe('rain-wet surfaces', () => {
  it('runs after the surface details, snow and normal maps, before lighting', () => {
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchSurfaceDetailShader(shader, 'stone');
    patchWinterSnowShader(shader);
    patchRainWetnessShader(shader);
    const at = (text: string) => shader.fragmentShader.indexOf(text);
    const wet = at('float suiWet =');
    // After the surface details' roughness clamp, so the film can be smoother than it.
    expect(wet).toBeGreaterThan(at('roughnessFactor = clamp(roughnessFactor + suiSurfaceRoughness'));
    expect(wet).toBeGreaterThan(at('suiSnowGradient'));
    expect(wet).toBeGreaterThan(at('#include <normal_fragment_maps>'));
    expect(wet).toBeLessThan(at('#include <lights_fragment_begin>'));
    expect(shader.vertexShader).toContain('vSuiWetPosition = (modelMatrix');
  });
  it('wets only the outdoor deck, stone and ground', () => {
    const root = new THREE.Group();
    const deck = mesh('V7 | locally damp ash.012');
    const stone = mesh('V2 | pale mineral paving');
    const moss = mesh('V9 | layered living moss');
    const others = [
      'V10 | submerged light / Teal glazed pool tile',
      'Low iron architectural glass',
      'V3 | fern 2',
      'Warm limestone plaster',
      'Unbleached linen',
      'Tree bark',
      'Fine garden gravel',
    ].map(mesh);
    root.add(deck, stone, moss, ...others);
    expect(applyRainWetness(root, { value: 0 })).toBe(3);
    const defines = (object: THREE.Mesh) => (object.material as THREE.MeshStandardMaterial).defines ?? {};
    expect(defines(stone).SUI_WET_ROUGHNESS).toBe('0.300');
    expect(defines(deck).SUI_WET_DARKEN).toBe('0.500');
    expect(defines(moss).SUI_WET_ROUGHNESS).toBe('1.000');
    for (const object of others) expect(defines(object).SUI_WET_DARKEN).toBeUndefined();
    // Prepared twice (the garden after the body) a material keeps one patch.
    expect(applyRainWetness(root, { value: 0 })).toBe(0);
  });
  it('composes existing hooks and shares the mutable rain uniform', () => {
    const object = mesh('V2 | mineral charcoal stone');
    const material = object.material as THREE.MeshStandardMaterial;
    material.customProgramCacheKey = () => 'existing';
    material.onBeforeCompile = (shader) => {
      shader.uniforms.existing = { value: 1 };
    };
    const amount = { value: 0 };
    applyRainWetness(object, amount);
    const shader = { ...THREE.ShaderLib.standard, uniforms: {} as Record<string, { value: unknown }> };
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.uniforms.existing.value).toBe(1);
    expect(shader.uniforms.suiRainWet).toBe(amount);
    expect(material.customProgramCacheKey()).toBe('existing|rain-wet-v2');
    amount.value = 1;
    expect(shader.uniforms.suiRainWet.value).toBe(1);
  });
  it('mirrors the deck and stones but not the moss or the receivers with local irradiance', () => {
    const root = new THREE.Group();
    const deck = mesh('V2 | outdoor ash / grain & wear');
    const stone = mesh('V2 | mineral charcoal stone');
    const moss = mesh('V9 | layered living moss');
    const stoneTops = mesh('V2 | mineral charcoal stone');
    (stoneTops.material as THREE.Material).userData.suiDeckReceiver = true;
    const roomFloor = mesh('V2 | outdoor ash / grain & wear');
    (roomFloor.material as THREE.Material).userData.suiRoomReceiver = true;
    root.add(deck, stone, moss, stoneTops, roomFloor);
    const uniforms = createMirrorUniforms();
    const time = { value: 0 };
    expect(applyRainWetness(root, { value: 0 }, { uniforms, time })).toBe(5);
    const defines = (object: THREE.Mesh) => (object.material as THREE.MeshStandardMaterial).defines ?? {};
    expect(defines(deck).SUI_WET_MIRROR).toBe(DECK_LEVEL.toFixed(3));
    expect(defines(deck).SUI_WET_ROUGHNESS).toBe('0.400');
    expect(defines(deck).SUI_WET_MIRROR_ROUGHNESS).toBe('0.300');
    expect(defines(stone).SUI_WET_POOL).toBeDefined();
    for (const object of [moss, stoneTops, roomFloor]) expect(defines(object).SUI_WET_MIRROR).toBeUndefined();
    const material = deck.material as THREE.MeshStandardMaterial;
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
    material.onBeforeCompile(shader as Parameters<typeof material.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiWetMirror).toBe(uniforms.suiMirror);
    expect(shader.uniforms.suiWetMirrorAmount).toBe(uniforms.suiMirrorAmount);
    expect(shader.uniforms.suiWetTime).toBe(time);
    // The mirror replaces the probes' reflection after it is added and before it is applied.
    const at = (text: string) => shader.fragmentShader.indexOf(text);
    expect(at('radiance = mix( radiance, suiWetImage')).toBeGreaterThan(at('#include <lights_fragment_begin>'));
    expect(at('radiance = mix( radiance, suiWetImage')).toBeLessThan(at('#include <lights_fragment_end>'));
  });
  it('bounds the mirror by a plane over the deck at its height', () => {
    const surface = deckMirrorSurface();
    const box = new THREE.Box3().setFromObject(surface);
    expect(box.min.y).toBeCloseTo(DECK_LEVEL);
    expect(box.max.y).toBeCloseTo(DECK_LEVEL);
    expect(box.min.x).toBeCloseTo(DECK_AREA.min.x);
    expect(box.min.z).toBeCloseTo(DECK_AREA.min.y);
    expect(box.max.z).toBeCloseTo(DECK_AREA.max.y);
  });
});
