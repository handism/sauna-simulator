import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EVERGREEN_CONE, isEvergreenTree, shapeEvergreenCones, splitEvergreenWoodland } from './evergreenWoodland';
import { createSeasonColors } from './season';

/** Leaf cards (two triangles over four vertices each) around a trunk, in the crown. */
function cards(x: number, z: number, count: number) {
  const positions: number[] = [];
  const index: number[] = [];
  for (let n = 0; n < count; n++) {
    const a = (n / count) * Math.PI * 2;
    const [cx, cz] = [x + Math.cos(a) * 1.5, z + Math.sin(a) * 1.5];
    const base = positions.length / 3;
    positions.push(cx, 3, cz, cx + 0.2, 3, cz, cx + 0.2, 3.2, cz, cx, 3.2, cz);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return geometry;
}

function woodland() {
  // One evergreen and one deciduous trunk position, as the product chooses them.
  const spots = Array.from({ length: 200 }, (_, i) => i * 7.3 + 0.03);
  const evergreen = spots.find((x) => isEvergreenTree(x, 0))!;
  const deciduous = spots.find((x) => !isEvergreenTree(x, 0))!;
  const root = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ name: 'Tree bark' });
  const trunks = mergeGeometries([
    new THREE.CylinderGeometry(0.1, 0.15, 4).translate(evergreen, 2, 0),
    new THREE.CylinderGeometry(0.1, 0.15, 4).translate(deciduous, 2, 0),
  ]);
  const leaf = new THREE.MeshStandardMaterial({ name: 'V6 woodland leaf 2 card', color: 0x6f8f45 });
  leaf.userData.suiLeafCluster = { leaves: 20 };
  const leaves = new THREE.Mesh(mergeGeometries([cards(evergreen, 0, 12), cards(deciduous, 0, 8)]), leaf);
  leaves.name = 'V6 clustered tree leaves';
  root.add(new THREE.Mesh(trunks, bark), leaves);
  return { root, leaves, evergreen, deciduous };
}

describe('evergreen woodland', () => {
  it('moves whole trees into darker evergreen crowns and keeps every card', () => {
    const { root, leaves, evergreen } = woodland();
    expect(splitEvergreenWoodland(root)).toBe(1);
    const crowns = root.getObjectByName('V6 clustered tree leaves evergreen') as THREE.Mesh;
    const material = crowns.material as THREE.MeshStandardMaterial;
    expect(material.name).toBe('V6 woodland leaf 2 card evergreen');
    expect(material.userData.suiLeafCluster).toEqual({ leaves: 20 });
    expect(material.color.g).toBeLessThan((leaves.material as THREE.MeshStandardMaterial).color.g);
    expect(crowns.geometry.index!.count).toBe(12 * 6);
    expect(leaves.geometry.index!.count).toBe(8 * 6);
    // Each card keeps its four vertices, all around the evergreen trunk.
    const position = crowns.geometry.attributes.position;
    expect(position.count).toBe(12 * 4);
    for (let i = 0; i < position.count; i++) expect(Math.abs(position.getX(i) - evergreen)).toBeLessThan(2);
  });

  it('keeps the evergreen crowns through autumn colors and the winter leaf fall', () => {
    const { root, leaves } = woodland();
    splitEvergreenWoodland(root);
    const crowns = root.getObjectByName('V6 clustered tree leaves evergreen') as THREE.Mesh;
    const summer = (crowns.material as THREE.MeshStandardMaterial).color.clone();
    const seasons = createSeasonColors();
    seasons.add(root, 'autumn');
    expect((crowns.material as THREE.MeshStandardMaterial).color.equals(summer)).toBe(true);
    seasons.update('winter');
    expect(leaves.visible).toBe(false);
    expect(crowns.visible).toBe(true);
  });

  it('gathers the evergreen cards into a slender cone and leaves the deciduous cards in place', () => {
    const { root, leaves, evergreen, deciduous } = woodland();
    const before = Float32Array.from(leaves.geometry.attributes.position.array);
    expect(shapeEvergreenCones(root)).toBe(12);
    const position = leaves.geometry.attributes.position;
    const centers = Array.from({ length: 20 }, (_, card) => {
      const center = new THREE.Vector3();
      for (let k = 0; k < 4; k++) center.add(new THREE.Vector3().fromBufferAttribute(position, card * 4 + k));
      return center.multiplyScalar(1 / 4);
    });
    const top = 3.1 + EVERGREEN_CONE.TIP;
    const bottom = Math.max(EVERGREEN_CONE.LOW, top * EVERGREEN_CONE.BASE);
    const radius = THREE.MathUtils.clamp((top - bottom) * EVERGREEN_CONE.SLENDER, ...EVERGREEN_CONE.RADIUS);
    const cone = centers.slice(0, 12);
    // Up the cone from near its base to its tip, narrower toward the top.
    expect(Math.min(...cone.map((c) => c.y))).toBeLessThan(bottom + 0.5);
    expect(Math.max(...cone.map((c) => c.y))).toBeGreaterThan(top - 1.2);
    for (const c of cone) {
      const t = (c.y - bottom) / (top - bottom);
      const reach = Math.hypot(c.x - evergreen, c.z);
      expect(reach).toBeLessThanOrEqual((radius * (1 - t) + 0.15) * (1 + EVERGREEN_CONE.JITTER) + 1e-4);
    }
    // The cards turn to face out of the cone (either side), raised toward the sky.
    for (let card = 0; card < 12; card++) {
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, card * 4 + k));
      const facing = b.sub(a).cross(c.sub(a)).normalize();
      const out = new THREE.Vector3(centers[card].x - evergreen, 0, centers[card].z).normalize();
      if (facing.dot(out) < 0) facing.negate();
      expect(facing.dot(out)).toBeGreaterThan(0.5);
      expect(facing.y).toBeGreaterThan(0.1);
    }
    // The cards shrink about their centers.
    const side = new THREE.Vector3()
      .fromBufferAttribute(position, 1)
      .distanceTo(new THREE.Vector3().fromBufferAttribute(position, 0));
    expect(side).toBeCloseTo(0.2 * EVERGREEN_CONE.CARD, 5);
    // The deciduous tree's cards did not move.
    expect(Array.from(position.array.slice(12 * 12))).toEqual(Array.from(before.slice(12 * 12)));
    for (const c of centers.slice(12)) expect(Math.hypot(c.x - deciduous, c.z)).toBeLessThan(1.7);
  });

  it('leaves a woodland without trunks unchanged', () => {
    const { leaves } = woodland();
    const root = new THREE.Group();
    root.add(leaves);
    const geometry = leaves.geometry;
    expect(splitEvergreenWoodland(root)).toBe(0);
    expect(leaves.geometry).toBe(geometry);
  });
});
