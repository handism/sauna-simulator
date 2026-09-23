import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  LEAF_CLUSTER_SIZE,
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
});
