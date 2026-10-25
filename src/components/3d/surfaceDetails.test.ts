import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applySurfaceDetails,
  MOSS_FREE,
  patchSurfaceDetailShader,
  ROOM_FLOOR,
  surfaceDetailOf,
} from './surfaceDetails';
import { applyWinterSnow } from './winterSnow';

describe('deck, stone and procedural flat-color surface details', () => {
  it('targets outdoor and flat-colored procedural surfaces without changing indoor timber, pool tiles or submerged light materials', () => {
    expect(surfaceDetailOf('V2 | outdoor ash / grain & wear')).toBe('deck');
    expect(surfaceDetailOf('V7 | locally damp ash.035')).toBe('deck');
    expect(surfaceDetailOf('V2 | pale mineral paving')).toBe('stone');
    expect(surfaceDetailOf('Garden mineral charcoal stone')).toBe('stone');
    expect(surfaceDetailOf('V9 | layered living moss')).toBe('ground');
    expect(surfaceDetailOf('V3 | moss and woodland earth')).toBe('ground');
    expect(surfaceDetailOf('Warm limestone plaster')).toBe('plaster');
    expect(surfaceDetailOf('Unbleached linen')).toBe('linen');
    expect(surfaceDetailOf('V7 | oatmeal woven towel')).toBe('towel');
    expect(surfaceDetailOf('V6 | fine soft linen')).toBe('towel');
    expect(surfaceDetailOf('Loyly | split olivine')).toBe('heater');
    expect(surfaceDetailOf('Tree bark')).toBe('bark');
    expect(surfaceDetailOf('Fine garden gravel')).toBe('gravel');
    for (const name of [
      'V2 | warm open-grain timber',
      'Teal glazed pool tile',
      'Low iron architectural glass',
      'V10 | submerged light / V9 | quiet honed stone / V2 | mineral c',
      'V7 | shaded moss garden',
    ])
      expect(surfaceDetailOf(name)).toBeNull();
  });

  it.each(['deck', 'stone', 'ground', 'plaster', 'linen', 'towel', 'heater', 'bark', 'gravel'] as const)(
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
        shader.fragmentShader.indexOf('diffuseColor.rgb = mix(diffuseColor.rgb, suiSnowColor'),
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

  it('lays the room floor boards and contact shadows only under SUI_ROOM_FLOOR', () => {
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchSurfaceDetailShader(shader, 'deck');
    const fragment = shader.fragmentShader;
    const boards = fragment.indexOf('#ifdef SUI_ROOM_FLOOR');
    expect(boards).toBeGreaterThan(-1);
    // Before the grain reads the board's seed, inside the define.
    expect(boards).toBeLessThan(fragment.indexOf('float suiBend'));
    expect(fragment.indexOf('suiBoardSeed = suiSurfaceHash')).toBeGreaterThan(boards);
    expect(fragment.indexOf('suiBoardSeed = suiSurfaceHash')).toBeLessThan(fragment.indexOf('#endif', boards));
    for (const { center } of [ROOM_FLOOR.stove, ROOM_FLOOR.pail])
      expect(fragment).toContain(`vec2(${center[0].toFixed(4)}, ${center[1].toFixed(4)})`);
  });

  it('grows moss only on the charcoal stones, outside the room, deck and plunge', () => {
    const named = (name: string) => {
      const material = new THREE.MeshStandardMaterial({ name });
      applySurfaceDetails(material, 'stone');
      return material.defines ?? {};
    };
    expect(named('V2 | mineral charcoal stone')).toHaveProperty('SUI_STONE_MOSS');
    expect(named('Garden mineral charcoal stone')).toHaveProperty('SUI_STONE_MOSS');
    expect(named('V2 | pale mineral paving')).not.toHaveProperty('SUI_STONE_MOSS');
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    patchSurfaceDetailShader(shader, 'stone');
    const moss = shader.fragmentShader.indexOf('#ifdef SUI_STONE_MOSS');
    expect(moss).toBeGreaterThan(-1);
    expect(shader.fragmentShader.indexOf('suiMossColor')).toBeGreaterThan(moss);
    for (const box of [MOSS_FREE.indoor, MOSS_FREE.deck, MOSS_FREE.plunge])
      expect(shader.fragmentShader).toContain(
        `vec3(${box.min.x.toFixed(4)}, ${box.min.y.toFixed(4)}, ${box.min.z.toFixed(4)})`,
      );
    // The table on the deck and the plunge's rim stay bare.
    expect(MOSS_FREE.deck.containsPoint(new THREE.Vector3(4.9, 0.45, 0))).toBe(true);
    expect(MOSS_FREE.plunge.containsPoint(new THREE.Vector3(1.2, 1.0, -0.5))).toBe(true);
  });

  it('rejects incompatible shader chunks', () => {
    expect(() => patchSurfaceDetailShader({ vertexShader: '', fragmentShader: '' }, 'deck')).toThrow('shader chunks');
  });
});
