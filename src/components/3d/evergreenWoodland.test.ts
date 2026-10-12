import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isEvergreenTree, splitEvergreenWoodland } from './evergreenWoodland';
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

  it('leaves a woodland without trunks unchanged', () => {
    const { leaves } = woodland();
    const root = new THREE.Group();
    root.add(leaves);
    const geometry = leaves.geometry;
    expect(splitEvergreenWoodland(root)).toBe(0);
    expect(leaves.geometry).toBe(geometry);
  });
});
