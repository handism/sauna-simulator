import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  ALPHA_MAP,
  ALPHA_TEST,
  LEAF_CLUSTER_SIZE,
  LEAF_COVERAGE_GLSL,
  LEAF_ALPHA_MAP,
  LEAF_FAR_BIAS,
  LEAF_FAR_FILL,
  LEAF_FAR_RAMP,
  applyLeafCluster,
  createLeafClusterTexture,
  leafClusterCoverage,
  leafClusterMips,
  leafClusterOf,
} from './leafCluster';

const share = (alpha: Float32Array | Uint8Array, cutoff: number) =>
  alpha.filter((value) => value >= cutoff).length / alpha.length;

describe('woodland leaf cluster cards', () => {
  it('reads only a positive integer leaf count from glTF extras', () => {
    const material = (extras: unknown) =>
      Object.assign(new THREE.MeshStandardMaterial(), { userData: { suiLeafCluster: extras } });
    expect(leafClusterOf(material({ leaves: 20 }))).toEqual({ leaves: 20 });
    for (const extras of [undefined, {}, { leaves: 0 }, { leaves: 2.5 }, { leaves: '20' }])
      expect(leafClusterOf(material(extras))).toBeNull();
  });

  it('draws the same leaves every time and covers about half of the card', () => {
    const coverage = leafClusterCoverage(20);
    expect(coverage).toEqual(leafClusterCoverage(20));
    // The leaves may overlap a little; the exporter assumes half of the card is leaf.
    const mean = coverage.reduce((sum, value) => sum + value, 0) / coverage.length;
    expect(mean).toBeGreaterThan(0.42);
    expect(mean).toBeLessThanOrEqual(0.5);
    // Whole leaves: nothing touches the card border.
    for (let i = 0; i < LEAF_CLUSTER_SIZE; i++) {
      expect(coverage[i]).toBe(0);
      expect(coverage[i * LEAF_CLUSTER_SIZE]).toBe(0);
    }
  });

  it('draws ovate leaves of varied size rather than equal diamonds', () => {
    const coverage = leafClusterCoverage(20);
    const size = LEAF_CLUSTER_SIZE;
    // Label the texels above the cutoff into connected leaves (touching leaves merge).
    const label = new Int32Array(coverage.length).fill(-1);
    const areas: number[] = [];
    for (let start = 0; start < coverage.length; start++) {
      if (coverage[start] < 0.5 || label[start] >= 0) continue;
      const stack = [start];
      label[start] = areas.length;
      let area = 0;
      while (stack.length) {
        const texel = stack.pop()!;
        area++;
        const [x, y] = [texel % size, Math.floor(texel / size)];
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const [nx, ny] = [x + dx, y + dy];
          const next = ny * size + nx;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size || coverage[next] < 0.5 || label[next] >= 0) continue;
          label[next] = areas.length;
          stack.push(next);
        }
      }
      areas.push(area);
    }
    expect(areas.length).toBeGreaterThan(5);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(2);
  });

  it('keeps the alpha-tested coverage in the mip levels that distant cards sample', () => {
    const levels = leafClusterMips(leafClusterCoverage(20), LEAF_CLUSTER_SIZE);
    expect(levels.map((level) => level.length)).toEqual([4096, 1024, 256, 64, 16, 4, 1]);
    const base = share(levels[0], 0.5);
    for (const level of levels.slice(1, 5)) expect(Math.abs(share(level, 0.5) - base)).toBeLessThan(0.05);
    // A plain box filter thins the cutout once a card spans a few texels (0.44 -> 0.31 at 4x4).
    let box = levels[0];
    for (let width = 32; width >= 4; width /= 2) {
      box = Float32Array.from({ length: width * width }, (_, i) => {
        const x = i % width,
          y = Math.floor(i / width);
        return (
          [0, 1, width * 2, width * 2 + 1].reduce((sum, offset) => sum + box[2 * y * width * 2 + 2 * x + offset], 0) / 4
        );
      });
    }
    expect(share(box, 0.5)).toBeLessThan(base - 0.1);
  });

  it('uploads explicit mips and cuts out cards with alpha to coverage', () => {
    const texture = createLeafClusterTexture({ leaves: 20 });
    expect(texture.generateMipmaps).toBe(false);
    const mips = texture.mipmaps as { data: Uint8Array; width: number }[];
    expect(mips.map((level) => level.width)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    expect(texture.image.data).toBe(mips[0].data);
    expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    // alphaMap samples green; all channels carry the coverage.
    const data = mips[2].data;
    expect(data.filter((_, i) => i % 4 === 1)).toEqual(data.filter((_, i) => i % 4 === 0));
    const material = new THREE.MeshStandardMaterial();
    const version = material.version;
    applyLeafCluster(material, texture);
    expect(material).toMatchObject({ alphaMap: texture, alphaTest: 0.5, alphaToCoverage: true, transparent: false });
    expect(material.version).toBeGreaterThan(version);
    texture.dispose();
  });

  it('replaces the alpha test with the coverage that widens its ramp for distant cards', () => {
    const material = new THREE.MeshStandardMaterial();
    const calls: string[] = [];
    material.onBeforeCompile = () => void calls.push('earlier');
    material.customProgramCacheKey = () => 'earlier';
    applyLeafCluster(material, new THREE.Texture());
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(calls).toEqual(['earlier']);
    expect(shader.fragmentShader).not.toContain(ALPHA_TEST);
    expect(shader.fragmentShader).toContain('diffuseColor.a = suiLeafCoverage( diffuseColor.a, vAlphaMapUv );');
    // The mask read up to LEAF_FAR_BIAS mips blurrier far off, before the coverage.
    expect(shader.fragmentShader).not.toContain(ALPHA_MAP);
    expect(shader.fragmentShader).toContain(LEAF_ALPHA_MAP);
    expect(shader.fragmentShader).toContain(
      `return ${LEAF_FAR_BIAS.toFixed(1)} * smoothstep( 2.0, 4.0, suiLeafFootprint( uv ) );`,
    );
    expect(shader.fragmentShader.indexOf(LEAF_ALPHA_MAP)).toBeLessThan(
      shader.fragmentShader.indexOf('diffuseColor.a = suiLeafCoverage'),
    );
    // Defined before main, centred on the cutoff, widened to LEAF_FAR_RAMP past two texels per pixel,
    // the cutoff lowered by LEAF_FAR_FILL from one to three.
    expect(shader.fragmentShader.indexOf(LEAF_COVERAGE_GLSL)).toBeLessThan(
      shader.fragmentShader.indexOf('void main() {'),
    );
    expect(LEAF_COVERAGE_GLSL).toContain('0.20 * smoothstep( 1.0, 2.0, footprint )');
    expect(LEAF_COVERAGE_GLSL).toContain('float cutoff = 0.5 - 0.32 * smoothstep( 1.0, 3.0, footprint );');
    expect(LEAF_COVERAGE_GLSL).toContain('smoothstep( cutoff - ramp, cutoff + ramp, alpha )');
    expect(LEAF_FAR_FILL).toBe(0.32);
    expect(LEAF_FAR_RAMP).toBe(0.2);
    // The card's shell level from its UVs' integer part; the rim lift before the air and tone mapping.
    expect(LEAF_COVERAGE_GLSL).toContain('min( floor( uv.x * 0.5 ), 7.0 ) / 7.0');
    const rim = shader.fragmentShader.indexOf('suiLeafRim( vAlphaMapUv ) * ( 1.0 - suiIrradianceEvening )');
    expect(rim).toBeGreaterThan(shader.fragmentShader.indexOf('suiLeafCoverage( diffuseColor.a'));
    expect(rim).toBeLessThan(shader.fragmentShader.indexOf('#include <tonemapping_fragment>'));
    expect(material.customProgramCacheKey()).toBe('earlier|leaf-cluster');
  });
});
