import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MAPLE_TILT_MAX, MAPLE_TILT_MIN, mapleLeafTurn, tiltMapleLeaves } from './mapleLeafTilt';

/**
 * A level leaf like the export's: a fan of 10 triangles around a center vertex (11 vertices), its
 * lobe tips raised so each face is folded well off level while the whole leaf stays level.
 */
function levelLeaf(center: THREE.Vector3, positions: number[], normals: number[], indices: number[]) {
  const base = positions.length / 3;
  positions.push(center.x, center.y, center.z);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * 2 * Math.PI;
    const radius = i % 2 ? 0.03 : 0.07;
    positions.push(
      center.x + Math.cos(angle) * radius,
      center.y + (i % 2 ? 0 : 0.03),
      center.z + Math.sin(angle) * radius,
    );
  }
  for (let i = 0; i < 11; i++) normals.push(0, 1, 0);
  for (let i = 0; i < 10; i++) indices.push(base, base + 1 + ((i + 1) % 10), base + 1 + i);
}

function geometry() {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  levelLeaf(new THREE.Vector3(1, 2, 3), positions, normals, indices);
  levelLeaf(new THREE.Vector3(-2, 2.5, 5), positions, normals, indices);
  // A small tilted quad, like the export's other maple leaves: kept as it is.
  const base = positions.length / 3;
  positions.push(0, 1, 0, 0.03, 1.02, 0, 0.03, 1.04, 0.02, 0, 1.02, 0.02);
  normals.push(0, 0.7, 0.7, 0, 0.7, 0.7, 0, 0.7, 0.7, 0, 0.7, 0.7);
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  result.setIndex(indices);
  return result;
}

describe('tiltMapleLeaves', () => {
  it('turns each level lobed leaf about its centroid by a bounded angle', () => {
    const shape = geometry();
    const before = (shape.getAttribute('position').array as Float32Array).slice();
    expect(tiltMapleLeaves(shape)).toBe(2);
    const position = shape.getAttribute('position');
    const normal = shape.getAttribute('normal');
    for (const first of [0, 11]) {
      // The turn is about the leaf's exported centroid, which stays put.
      const center = new THREE.Vector3();
      for (let v = first; v < first + 11; v++) center.add(new THREE.Vector3().fromArray(before, 3 * v));
      center.divideScalar(11);
      const centroid = new THREE.Vector3();
      for (let v = first; v < first + 11; v++) centroid.add(new THREE.Vector3().fromBufferAttribute(position, v));
      expect(centroid.divideScalar(11).distanceTo(center)).toBeLessThan(1e-5);
      // The normal follows the turn: tilted from vertical by MAPLE_TILT_MIN..MAX.
      const up = new THREE.Vector3().fromBufferAttribute(normal, first);
      const angle = Math.acos(THREE.MathUtils.clamp(up.y, -1, 1));
      expect(angle).toBeGreaterThanOrEqual(MAPLE_TILT_MIN - 1e-5);
      expect(angle).toBeLessThanOrEqual(MAPLE_TILT_MAX + 1e-5);
      expect(up.length()).toBeCloseTo(1, 5);
      // Rigid: the turn keeps every vertex's distance from the center.
      for (let v = first; v < first + 11; v++) {
        const was = new THREE.Vector3(before[3 * v], before[3 * v + 1], before[3 * v + 2]);
        expect(new THREE.Vector3().fromBufferAttribute(position, v).distanceTo(center)).toBeCloseTo(
          was.distanceTo(center),
          5,
        );
      }
      // The same turn as the leaf's exported centroid decides.
      const expected = new THREE.Vector3(0, 1, 0).applyQuaternion(mapleLeafTurn(center));
      expect(up.distanceTo(expected)).toBeLessThan(1e-5);
    }
    // The quad is not a lobed leaf.
    for (let i = 22 * 3; i < before.length; i++) expect(position.array[i]).toBe(before[i]);
  });

  it('spreads the directions and runs once', () => {
    const shape = geometry();
    tiltMapleLeaves(shape);
    const once = (shape.getAttribute('position').array as Float32Array).slice();
    expect(tiltMapleLeaves(shape)).toBe(2);
    expect(shape.getAttribute('position').array).toEqual(once);
    const angles: number[] = [];
    for (let i = 0; i < 200; i++) {
      // The turn's axis is the quaternion's vector part, level.
      const turn = mapleLeafTurn(new THREE.Vector3(i * 0.37, 2, i * 0.11));
      expect(Math.abs(turn.y)).toBeLessThan(1e-9);
      angles.push(Math.atan2(turn.z, turn.x));
    }
    // Directions fall in all four quadrants.
    for (const quadrant of [0, 1, 2, 3]) {
      expect(angles.some((a) => Math.floor(((a + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 2)) === quadrant)).toBe(
        true,
      );
    }
  });
});
