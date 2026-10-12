import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { broadenWoodlandCards, CROWN_FILL_COPIES } from './woodlandCrowns';

describe('woodland crown cards', () => {
  it('keeps branch anchors, UVs and normals, adds lit-alike copies beside each card, and runs once', () => {
    const cards = [new THREE.PlaneGeometry(2, 2).translate(-4, 3, 0), new THREE.PlaneGeometry(2, 2).translate(4, 5, 2)];
    const geometry = mergeGeometries(cards);
    const uv = Array.from(geometry.attributes.uv.array);
    const normals = Array.from(geometry.attributes.normal.array);
    const indices = Array.from(geometry.index!.array);
    broadenWoodlandCards(geometry);
    const position = geometry.attributes.position;
    const copies = 2 * CROWN_FILL_COPIES;
    expect(position.count).toBe(8 + 4 * copies);
    expect(geometry.index!.count).toBe(indices.length * (1 + CROWN_FILL_COPIES));
    const centerOf = (first: number) => {
      const center = new THREE.Vector3();
      for (let i = first; i < first + 4; i++) center.add(new THREE.Vector3().fromBufferAttribute(position, i));
      return center.multiplyScalar(0.25);
    };
    const anchors = [new THREE.Vector3(-4, 3, 0), new THREE.Vector3(4, 5, 2)];
    for (let card = 0; card < 2; card++) {
      expect(centerOf(card * 4).distanceTo(anchors[card])).toBeLessThan(1e-6);
      for (let copy = 0; copy < CROWN_FILL_COPIES; copy++) {
        const first = 8 + (card * CROWN_FILL_COPIES + copy) * 4;
        // Beside its card (within one broadened card size), not on top of it.
        const offset = centerOf(first).distanceTo(anchors[card]);
        expect(offset).toBeGreaterThan(0.3);
        expect(offset).toBeLessThan(3.3);
        for (let i = 0; i < 4; i++) {
          expect(Array.from(geometry.attributes.uv.array.slice((first + i) * 2, (first + i) * 2 + 2))).toEqual(
            uv.slice((card * 4 + i) * 2, (card * 4 + i) * 2 + 2),
          );
          expect(Array.from(geometry.attributes.normal.array.slice((first + i) * 3, (first + i) * 3 + 3))).toEqual(
            normals.slice((card * 4 + i) * 3, (card * 4 + i) * 3 + 3),
          );
        }
      }
    }
    expect(geometry.boundingBox!.min.x).toBeLessThan(-5.3);
    expect(Array.from(geometry.attributes.uv.array.slice(0, uv.length))).toEqual(uv);
    expect(Array.from(geometry.attributes.normal.array.slice(0, normals.length))).toEqual(normals);
    expect(Array.from(geometry.index!.array.slice(0, indices.length))).toEqual(indices);
    // Every copy keeps its card's two triangles, on its own vertices.
    const added = Array.from(geometry.index!.array.slice(indices.length));
    expect(Math.min(...added)).toBe(8);
    expect(Math.max(...added)).toBe(position.count - 1);
    const result = Array.from(position.array);
    broadenWoodlandCards(geometry);
    expect(Array.from(geometry.attributes.position.array)).toEqual(result);
    geometry.dispose();
    cards.forEach((card) => card.dispose());
  });

  it('leaves continuous meshes intact', () => {
    const geometry = new THREE.PlaneGeometry(2, 2, 2, 2);
    const positions = Array.from(geometry.attributes.position.array);
    broadenWoodlandCards(geometry);
    expect(Array.from(geometry.attributes.position.array)).toEqual(positions);
    geometry.dispose();
  });
});
