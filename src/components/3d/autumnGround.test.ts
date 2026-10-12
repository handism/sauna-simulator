import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyAutumnGround, patchAutumnGroundShader } from './autumnGround';
import { createSeasonColors } from './season';
import { patchSurfaceDetailShader } from './surfaceDetails';
import { patchWinterSnowShader } from './winterSnow';

const standard = () => ({
  vertexShader: THREE.ShaderLib.standard.vertexShader,
  fragmentShader: THREE.ShaderLib.standard.fragmentShader,
});

describe('autumn ground', () => {
  it('runs after the ground details, before the roughness clamp and under the snow', () => {
    const shader = standard();
    patchSurfaceDetailShader(shader, 'ground');
    patchAutumnGroundShader(shader);
    patchWinterSnowShader(shader);
    const at = (text: string) => shader.fragmentShader.indexOf(text);
    const autumn = at('if (suiAutumnGround > 0.0)');
    expect(autumn).toBeGreaterThan(at('float suiDry'));
    expect(autumn).toBeLessThan(at('#include <roughnessmap_fragment>'));
    expect(autumn).toBeLessThan(at('roughnessFactor = clamp(roughnessFactor + suiSurfaceRoughness'));
    expect(autumn).toBeLessThan(at('diffuseColor.rgb = mix(diffuseColor.rgb, suiSnowColor'));
  });
  it('needs the ground details', () => {
    const shader = standard();
    patchSurfaceDetailShader(shader, 'stone');
    expect(() => patchAutumnGroundShader(shader)).toThrow();
  });
  it('is turned on by the autumn season only on the meadow and forest floor', () => {
    const root = new THREE.Group();
    const materials = ['V9 | layered living moss', 'V3 | moss and woodland earth', 'V2 | pale mineral paving'].map(
      (name) => {
        const material = new THREE.MeshStandardMaterial({ name });
        root.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
        return material;
      },
    );
    const seasons = createSeasonColors();
    seasons.add(root, 'summer');
    expect(seasons.autumnGroundMaterials).toBe(2);
    const shader = { ...standard(), uniforms: {} as Record<string, { value: number }> };
    patchSurfaceDetailShader(shader, 'ground');
    materials[0].onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(shader.uniforms.suiAutumnGround.value).toBe(0);
    expect(seasons.update('autumn')).toBe(true);
    expect(shader.uniforms.suiAutumnGround.value).toBe(1);
    expect(seasons.update('autumn')).toBe(false);
    expect(seasons.update('winter')).toBe(true);
    expect(shader.uniforms.suiAutumnGround.value).toBe(0);
    expect(materials[0].customProgramCacheKey()).toContain('autumn-ground-v1');
    expect(materials[2].customProgramCacheKey()).not.toContain('autumn-ground');
  });
  it('composes existing hooks', () => {
    const material = new THREE.MeshStandardMaterial();
    material.customProgramCacheKey = () => 'existing';
    material.onBeforeCompile = (shader) => patchSurfaceDetailShader(shader, 'ground');
    applyAutumnGround(material, { value: 1 });
    const shader = { ...standard(), uniforms: {} as Record<string, { value: number }> };
    material.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('uniform float suiAutumnGround');
    expect(material.customProgramCacheKey()).toBe('existing|autumn-ground-v1');
  });
});
