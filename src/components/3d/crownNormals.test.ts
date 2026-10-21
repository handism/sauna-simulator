import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  CROWN_NORMAL_WEIGHT,
  WOODLAND_ALBEDO,
  WOODLAND_ROUGHNESS,
  WOODLAND_SPECULAR,
  crownShade,
  crownTint,
  roundWoodlandCrowns,
} from './crownNormals';
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

  it("carries each card's place in its crown's outer shell in its UVs' integer part", () => {
    // Four cards at the crown's center and two at opposite corners of its extent (radius √2).
    const centers = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [1, 1],
      [-1, -1],
    ];
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    for (const [n, [x, z]] of centers.entries()) {
      positions.push(x - 0.1, 3, z, x + 0.1, 3, z, x + 0.1, 3.2, z, x - 0.1, 3.2, z);
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      index.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        new Array(positions.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)),
        3,
      ),
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: 'V6 woodland leaf 1 card' })));
    root.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.15, 4).translate(0, 2, 0),
        new THREE.MeshStandardMaterial({ name: 'Tree bark' }),
      ),
    );
    roundWoodlandCrowns(root);
    const uv = geometry.attributes.uv;
    const level = (card: number) => Math.floor(uv.getX(card * 4) / 2);
    expect([0, 1, 2, 3].map(level)).toEqual([0, 0, 0, 0]);
    expect(level(4)).toBe(6);
    expect(level(5)).toBe(6);
    // The leaves within each card are where they were.
    for (let v = 0; v < uv.count; v++) expect(uv.getX(v) - 2 * level(Math.floor(v / 4))).toBe(uvs[v * 2]);
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

  it('lightens and roughens the summer leaves once, before the evergreens copy them', () => {
    const { root, leaves } = woodland();
    const material = leaves.material as THREE.MeshStandardMaterial;
    const before = material.color.clone();
    roundWoodlandCrowns(root);
    expect(material.color.g).toBeCloseTo(before.g * WOODLAND_ALBEDO, 6);
    expect(material.color.r / material.color.g).toBeCloseTo(before.r / before.g, 6);
    expect(material.roughness).toBe(WOODLAND_ROUGHNESS);
    splitEvergreenWoodland(root);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh && /leaf/.test((object.material as THREE.Material).name))
        expect((object.material as THREE.MeshStandardMaterial).roughness).toBe(WOODLAND_ROUGHNESS);
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
    expect(crownShade(0, 0)).toBeCloseTo(0.7);
    expect(crownShade(1, 0)).toBeCloseTo(1);
    expect(crownShade(1, -1)).toBeLessThan(crownShade(1, 1));
  });

  it("keeps a quarter of the probes' reflection on the cards by day, after the lights and before the sum", () => {
    expect(WOODLAND_SPECULAR).toBeGreaterThan(0);
    expect(WOODLAND_SPECULAR).toBeLessThan(1);
    const fragment = THREE.ShaderLib.standard.fragmentShader.replace(
      /#include <(\w+)>/g,
      (_, chunk: keyof typeof THREE.ShaderChunk) => THREE.ShaderChunk[chunk],
    );
    const scale = fragment.indexOf(
      `reflectedLight.indirectSpecular *= mix( ${WOODLAND_SPECULAR.toFixed(2)}, 1.0, suiIrradianceEvening );`,
    );
    expect(scale).toBeGreaterThan(0);
    expect(fragment.lastIndexOf('#ifdef SUI_CROWN_TINT', scale)).toBeGreaterThan(
      fragment.indexOf('RE_IndirectSpecular('),
    );
    expect(scale).toBeLessThan(fragment.indexOf('vec3 totalSpecular'));
  });
});
