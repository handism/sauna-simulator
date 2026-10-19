import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { shapeFernLeaflets } from './fernShape';

const leaflet = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0.08, 0.02, -0.04, 0.2, 0, 0, 0.08, 0, 0.04], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
};

describe('fern leaflet shaping', () => {
  it('keeps the attachment, tip and topology and creates finite curved normals only once', () => {
    const geometry = leaflet();
    const indices = geometry.index;
    shapeFernLeaflets(geometry);
    const position = geometry.attributes.position;
    expect(position.count).toBe(4);
    expect(geometry.index).toBe(indices);
    for (const v of [0, 2]) {
      expect(position.getY(v)).toBe(0);
      expect(position.getZ(v)).toBe(0);
    }
    expect(position.getX(0)).toBe(0);
    expect(position.getX(2)).toBeCloseTo(0.2);
    const normal = geometry.attributes.normal;
    for (let v = 0; v < normal.count; v++) {
      expect(new THREE.Vector3().fromBufferAttribute(normal, v).length()).toBeCloseTo(1);
    }
    expect(normal.getZ(1) * normal.getZ(3)).toBeLessThan(0);
    const values = Array.from(position.array);
    shapeFernLeaflets(geometry);
    expect(Array.from(geometry.attributes.position.array)).toEqual(values);
    expect(geometry.attributes.position).toBe(position);
  });

  it('leaves shared or unsupported topology entirely unchanged', () => {
    const geometry = leaflet();
    const original = geometry.attributes.position;
    // A second leaf sharing the vein: changing it independently would tear its neighbor.
    geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]);
    shapeFernLeaflets(geometry);
    expect(geometry.attributes.position).toBe(original);
    expect(geometry.userData.suiFernShaped).toBeUndefined();
  });
});
