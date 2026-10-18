import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CROWN_NORMAL_WEIGHT, crownShade, crownTint, roundWoodlandCrowns } from './crownNormals';
import type { CrownFootprint } from './forestFloor';
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

  it('colors each tree by its trunk and darkens the inside of its crown', () => {
    const { root, leaves } = woodland();
    const footprints: CrownFootprint[] = [];
    roundWoodlandCrowns(root, footprints);
    expect(footprints).toHaveLength(1);
    expect(footprints[0].x).toBeCloseTo(0.1, 1);
    expect(footprints[0].rx).toBeGreaterThan(1.4);
    const material = leaves.material as THREE.MeshStandardMaterial;
    // Not vertex colors, which would take the cards out of the depth prepass (depthPrepass.ts).
    expect(material.vertexColors).toBe(false);
    expect(material.defines?.SUI_CROWN_TINT).toBe('');
    const color = leaves.geometry.attributes.suiCrownTint;
    const [r, g, b] = crownTint(0, 0);
    // Every ring card sits on the crown's rim, where the shade is least.
    const shade = color.getY(0) / g;
    expect(shade).toBeGreaterThan(0.75);
    expect(color.getX(0) / shade).toBeCloseTo(r, 5);
    expect(color.getZ(0) / shade).toBeCloseTo(b, 5);
    // Cards with no tree keep white.
    expect([color.getX(12 * 4), color.getY(12 * 4), color.getZ(12 * 4)]).toEqual([1, 1, 1]);
  });

  it('varies the tint within a modest range and shades the center and underside most', () => {
    for (let x = -40; x <= 40; x += 7.3) {
      const [r, g, b] = crownTint(x, x * 0.7);
      expect(g).toBeGreaterThanOrEqual(0.84);
      expect(g).toBeLessThanOrEqual(1.12);
      expect(r / g).toBeGreaterThanOrEqual(0.9 - 1e-9);
      expect(b / g).toBeLessThanOrEqual(1.1 + 1e-9);
    }
    expect(crownTint(3, 4)).toEqual(crownTint(3.01, 4.01));
    expect(crownShade(0, 0)).toBeCloseTo(0.6);
    expect(crownShade(1, 0)).toBeCloseTo(1);
    expect(crownShade(1, -1)).toBeLessThan(crownShade(1, 1));
  });
});
