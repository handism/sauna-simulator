import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CROWN_NORMAL_WEIGHT, roundWoodlandCrowns } from './crownNormals';
import { splitEvergreenWoodland } from './evergreenWoodland';

/** Upright leaf cards facing +z or -z, on a ring around (x, 0) at 3–3.2m. */
function ring(x: number, count: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (let n = 0; n < count; n++) {
    const a = (n / count) * Math.PI * 2;
    const [cx, cz] = [x + Math.cos(a) * 1.5, Math.sin(a) * 1.5];
    const base = positions.length / 3;
    positions.push(cx, 3, cz, cx + 0.2, 3, cz, cx + 0.2, 3.2, cz, cx, 3.2, cz);
    const facing = n % 2 ? 1 : -1;
    for (let k = 0; k < 4; k++) normals.push(0, 0, facing);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  return geometry;
}

function woodland(withTrunk = true) {
  const root = new THREE.Group();
  const leaf = new THREE.MeshStandardMaterial({ name: 'V6 woodland leaf 1 card', side: THREE.DoubleSide });
  const leaves = new THREE.Mesh(mergeGeometries([ring(0, 12), ring(40, 4)]), leaf);
  root.add(leaves);
  if (withTrunk)
    root.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.15, 4).translate(0, 2, 0),
        new THREE.MeshStandardMaterial({ name: 'Tree bark' }),
      ),
    );
  return { root, leaves };
}

describe('woodland crown normals', () => {
  it('leans every card of a tree outward from its crown, on either side of the card', () => {
    const { root, leaves } = woodland();
    expect(roundWoodlandCrowns(root)).toBe(12);
    const position = leaves.geometry.attributes.position;
    const normal = leaves.geometry.attributes.normal;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < 12 * 4; i++) {
      p.fromBufferAttribute(position, i);
      n.fromBufferAttribute(normal, i);
      expect(n.length()).toBeCloseTo(1, 5);
      // Outward on the ring, whichever way the card faced.
      expect(n.x * p.x + n.z * p.z).toBeGreaterThan(0);
    }
    // A card facing along the ring's tangent still turns mostly outward.
    p.fromBufferAttribute(position, 0);
    n.fromBufferAttribute(normal, 0);
    expect((n.x * p.x + n.z * p.z) / Math.hypot(p.x, p.z)).toBeGreaterThan(CROWN_NORMAL_WEIGHT * 0.9);
  });

  it('keeps the normals of cards far from any trunk and marks the material', () => {
    const { root, leaves } = woodland();
    const before = Array.from(leaves.geometry.attributes.normal.array).slice(12 * 4 * 3);
    roundWoodlandCrowns(root);
    expect(Array.from(leaves.geometry.attributes.normal.array).slice(12 * 4 * 3)).toEqual(before);
    expect((leaves.material as THREE.MeshStandardMaterial).defines?.SUI_CROWN_NORMAL).toBe('');
  });

  it('keeps the define on the evergreen clones', () => {
    const { root } = woodland();
    roundWoodlandCrowns(root);
    splitEvergreenWoodland(root);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && /leaf/.test((object.material as THREE.Material).name))
        expect((object.material as THREE.MeshStandardMaterial).defines?.SUI_CROWN_NORMAL).toBe('');
    });
  });

  it('rounds no card of a woodland without trunks', () => {
    const { root } = woodland(false);
    expect(roundWoodlandCrowns(root)).toBe(0);
  });
});
