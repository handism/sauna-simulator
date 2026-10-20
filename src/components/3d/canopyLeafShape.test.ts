import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CANOPY_LEAF_TRIANGLES,
  CANOPY_LEAF_VERTICES,
  SMALL_LEAF,
  leafTriangles,
  leafVertices,
  shapeCanopyLeaves,
} from './canopyLeafShape';

// Exported canopy diamonds: four free vertices, two triangles around the long diagonal 0–2.
const diamonds = (centers: number[][]) => {
  const geometry = new THREE.BufferGeometry();
  const position: number[] = [];
  const index: number[] = [];
  centers.forEach(([x, y, z], leaf) => {
    position.push(x - 0.16, y, z, x, y, z - 0.075, x + 0.16, y, z, x, y, z + 0.075);
    const v = leaf * 4;
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  });
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
};

const triangleArea = (geometry: THREE.BufferGeometry, first: number, count: number) => {
  const position = geometry.attributes.position;
  const index = geometry.index!;
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let area = 0;
  for (let i = first; i < first + count; i++) {
    a.fromBufferAttribute(position, index.getX(3 * i));
    b.fromBufferAttribute(position, index.getX(3 * i + 1));
    c.fromBufferAttribute(position, index.getX(3 * i + 2));
    area += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return area;
};

describe('overhead canopy leaf shaping', () => {
  const centers = Array.from({ length: 64 }, (_, i) => [(i % 8) * 0.4 - 1.4, 7.5, Math.floor(i / 8) * 0.4 - 1.4]);

  it('turns each diamond into a varied ovate leaf around the same centre, keeping the mean area', () => {
    const geometry = diamonds(centers);
    const sourceArea = triangleArea(geometry, 0, 2);
    shapeCanopyLeaves(geometry);
    const position = geometry.attributes.position;
    expect(position.count).toBe(centers.length * CANOPY_LEAF_VERTICES);
    expect(geometry.index!.count).toBe(centers.length * CANOPY_LEAF_TRIANGLES * 3);
    const areas = centers.map((_, leaf) => triangleArea(geometry, leaf * CANOPY_LEAF_TRIANGLES, CANOPY_LEAF_TRIANGLES));
    // The fold and droop tilt the halves, so the shaped area is a little under the plan area.
    const mean = areas.reduce((sum, area) => sum + area, 0) / areas.length;
    expect(mean / sourceArea).toBeGreaterThan(0.85);
    expect(mean / sourceArea).toBeLessThan(1.1);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(2.5);
    const point = new THREE.Vector3();
    centers.forEach(([x, y, z], leaf) => {
      const midrib = new THREE.Box3();
      for (let v = 0; v < 2 + 4; v++)
        midrib.expandByPoint(point.fromBufferAttribute(position, leaf * CANOPY_LEAF_VERTICES + v));
      // The stalk end and tip straddle the source centre and stay within the leaf's size.
      const middle = midrib.getCenter(new THREE.Vector3());
      expect(Math.hypot(middle.x - x, middle.z - z)).toBeLessThan(0.02);
      expect(Math.abs(middle.y - y)).toBeLessThan(0.05);
    });
    const normal = geometry.attributes.normal;
    for (let v = 0; v < normal.count; v++) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, v);
      expect(n.length()).toBeCloseTo(1);
      // The source faces point down (−y); the shaped leaves keep that winding.
      expect(n.y).toBeLessThan(0);
    }
  });

  it("gives the garden's small leaves a lighter unfolded outline with the same mean area", () => {
    const geometry = diamonds(centers);
    const sourceArea = triangleArea(geometry, 0, 2);
    shapeCanopyLeaves(geometry, SMALL_LEAF);
    expect([leafVertices(SMALL_LEAF), leafTriangles(SMALL_LEAF)]).toEqual([6, 4]);
    expect(geometry.attributes.position.count).toBe(centers.length * 6);
    expect(geometry.index!.count).toBe(centers.length * 4 * 3);
    const areas = centers.map((_, leaf) => triangleArea(geometry, leaf * 4, 4));
    const mean = areas.reduce((sum, area) => sum + area, 0) / areas.length;
    expect(mean / sourceArea).toBeGreaterThan(0.9);
    expect(mean / sourceArea).toBeLessThan(1.1);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(2.5);
    const normal = geometry.attributes.normal;
    for (let v = 0; v < normal.count; v++) {
      const n = new THREE.Vector3().fromBufferAttribute(normal, v);
      expect(n.length()).toBeCloseTo(1);
      expect(n.y).toBeLessThan(0);
    }
  });

  it('is deterministic and runs only once', () => {
    const first = diamonds(centers);
    const second = diamonds(centers);
    shapeCanopyLeaves(first);
    shapeCanopyLeaves(second);
    expect(Array.from(first.attributes.position.array)).toEqual(Array.from(second.attributes.position.array));
    const position = first.attributes.position;
    shapeCanopyLeaves(first);
    expect(first.attributes.position).toBe(position);
  });

  it('leaves shared or unsupported topology entirely unchanged', () => {
    const shared = diamonds([[0, 7.5, 0]]);
    const original = shared.attributes.position;
    shared.setIndex([0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3]);
    shapeCanopyLeaves(shared);
    expect(shared.attributes.position).toBe(original);
    expect(shared.userData.suiCanopyShaped).toBeUndefined();
    const textured = diamonds([[0, 7.5, 0]]);
    textured.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
    const textureSource = textured.attributes.position;
    shapeCanopyLeaves(textured);
    expect(textured.attributes.position).toBe(textureSource);
  });
});
