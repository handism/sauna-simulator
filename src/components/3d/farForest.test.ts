import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FAR_FOREST_RADIUS, createFarForest, crownHeight, farForestCrowns } from './farForest';

describe('far forest', () => {
  it('rings the woodland with the same crowns on every load, about a third evergreen', () => {
    const crowns = farForestCrowns();
    expect(crowns).toEqual(farForestCrowns());
    expect(crowns.length).toBeGreaterThan(80);
    const evergreen = crowns.filter((crown) => crown.evergreen).length / crowns.length;
    expect(evergreen).toBeGreaterThan(0.25);
    expect(evergreen).toBeLessThan(0.45);
    for (const crown of crowns) {
      expect(crown.top).toBeGreaterThan(4.5);
      // Below the ridges' crest as seen from the deck: taller, the band made the skyline.
      expect(crown.top).toBeLessThan(9.5);
    }
  });
  it('rounds broadleaf crowns and points the evergreens, peaking on their axis', () => {
    const [broad, ever] = [false, true].map((evergreen) => ({
      angle: 0,
      radius: 2,
      top: 10,
      evergreen,
      shade: 0,
      pick: 0,
    }));
    expect(crownHeight(broad, 0)).toBe(10);
    expect(crownHeight(ever, 0)).toBe(10);
    expect(crownHeight(broad, 2.1)).toBe(-Infinity);
    // Halfway out, the dome has barely fallen and the cone has lost half its height and more.
    expect(10 - crownHeight(broad, 1)).toBeLessThan(0.5);
    expect(10 - crownHeight(ever, 1)).toBeGreaterThan(2);
  });
  it('stands on its ring between the woodland and the ridges, recolored by season and lit by the caller', () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const position = forest.mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 97) {
      const radius = Math.hypot(position.getX(i), position.getZ(i));
      expect(radius).toBeGreaterThanOrEqual(47 - 1e-4);
      expect(radius).toBeLessThanOrEqual(FAR_FOREST_RADIUS + 1e-4);
      expect(position.getY(i)).toBeLessThan(16);
    }
    // The bridge is separated in depth from the backing, stays outside the real trees,
    // and uses finite geometry even at a crown's open ends.
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    const radii = Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i), position.getZ(i)));
    expect(radii.some((r) => r < 51)).toBe(true);
    expect(radii.some((r) => r > 53.9)).toBe(true);
    const color = forest.mesh.geometry.attributes.color;
    forest.update('summer', new THREE.Color(0.45, 0.45, 0.45));
    const summer = Array.from(color.array);
    expect(summer.every(Number.isFinite)).toBe(true);
    forest.update('autumn', new THREE.Color(0.45, 0.45, 0.45));
    const autumn = Array.from(color.array);
    expect(autumn).not.toEqual(summer);
    // Autumn reds and ochres: more red than green on average.
    const mean = (values: number[], k: number) => values.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0);
    expect(mean(autumn, 0)).toBeGreaterThan(mean(autumn, 1));
    expect(mean(summer, 1)).toBeGreaterThan(mean(summer, 0));
    forest.update('summer', new THREE.Color(0.1, 0.2, 0.3));
    expect(Array.from(color.array)).toEqual(summer);
    // The frayed outline over each vertex; none where a crown covers the understory's top.
    const edge = forest.mesh.geometry.attributes.gardenEdge;
    expect(edge.count).toBe(position.count);
    for (let i = 0; i < position.count; i++) expect(edge.getX(i)).toBeGreaterThanOrEqual(position.getY(i) - 1e-4);
    // Kept out of the depth prepass, whose depth would hide the sky behind the frayed edge.
    expect((forest.mesh.material as THREE.MeshBasicMaterial).alphaTest).toBeGreaterThan(0);
    expect((forest.mesh.material as THREE.MeshBasicMaterial).color.toArray()).toEqual([0.1, 0.2, 0.3]);
  });
});
