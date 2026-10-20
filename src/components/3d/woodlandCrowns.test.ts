import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { broadenWoodlandCards, CROWN_FILL_COPIES } from './woodlandCrowns';

describe('woodland crown cards', () => {
  it('rounds narrow branch tufts without increasing their area beyond the existing broadening', () => {
    const geometry = new THREE.PlaneGeometry(4, 1).translate(3, 5, 2);
    broadenWoodlandCards(geometry);
    const p = geometry.attributes.position;
    const point = (i: number) => new THREE.Vector3().fromBufferAttribute(p, i);
    const width = point(0).distanceTo(point(1));
    const height = point(0).distanceTo(point(2));
    expect(width / height).toBeLessThan(2);
    expect(width / height).toBeGreaterThan(1);
    expect(width * height).toBeGreaterThanOrEqual(4 * 1.15 ** 2);
    expect(width * height).toBeLessThanOrEqual(4 * 1.35 ** 2);
    expect(
      point(0)
        .add(point(3))
        .multiplyScalar(0.5)
        .distanceTo(new THREE.Vector3(3, 5, 2)),
    ).toBeLessThan(1e-6);
    geometry.dispose();
  });

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

  it('guides the existing copy into the crown while keeping its reach and original branch anchor', () => {
    const geometry = new THREE.PlaneGeometry(2, 2).translate(4, 5, 0);
    // A tree to the left: these are outward crown shading normals, not the plane's +Z normal.
    const normals = geometry.attributes.normal;
    for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 1, 0, 0);
    const before = Array.from(normals.array);
    broadenWoodlandCards(geometry);
    const p = geometry.attributes.position;
    const center = (start: number) => {
      const sum = new THREE.Vector3();
      for (let i = start; i < start + 4; i++) sum.add(new THREE.Vector3().fromBufferAttribute(p, i));
      return sum.multiplyScalar(0.25);
    };
    const anchor = new THREE.Vector3(4, 5, 0);
    expect(center(0).distanceTo(anchor)).toBeLessThan(1e-6);
    const direction = center(4).sub(anchor);
    expect(direction.clone().normalize().x).toBeLessThan(-0.9);
    const size = new THREE.Vector3()
      .fromBufferAttribute(p, 0)
      .distanceTo(new THREE.Vector3().fromBufferAttribute(p, 3));
    expect(direction.length() / size).toBeGreaterThanOrEqual(0.55 - 1e-6);
    expect(direction.length() / size).toBeLessThanOrEqual(0.75 + 1e-6);
    expect(Array.from(geometry.attributes.normal.array)).toEqual([...before, ...before]);
    expect(p.count).toBe(8);
    expect(geometry.index!.count).toBe(12);
    geometry.dispose();
  });

  it('keeps the old scatter when an inward copy would overlap the protected room', () => {
    const make = (normalX: number) => {
      const geometry = new THREE.PlaneGeometry(2, 2).translate(4, 5, 0);
      for (let i = 0; i < 4; i++) geometry.attributes.normal.setXYZ(i, normalX, 0, 0);
      return geometry;
    };
    const inward = make(1);
    broadenWoodlandCards(inward);
    const bounds = new THREE.Box3();
    for (let i = 4; i < 8; i++)
      bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(inward.attributes.position, i));
    // Clear of the card itself (x ≥ 2.81 after broadening), which would otherwise be moved out.
    bounds.max.x = Math.min(bounds.max.x, 2.7);
    const protectedCard = make(1);
    broadenWoodlandCards(protectedCard, bounds);
    const oldScatter = make(0); // No normal direction: the original random placement.
    broadenWoodlandCards(oldScatter);
    expect(Array.from(protectedCard.attributes.position.array)).toEqual(
      Array.from(oldScatter.attributes.position.array),
    );
    expect(Array.from(inward.attributes.position.array)).not.toEqual(Array.from(oldScatter.attributes.position.array));
    for (const geometry of [inward, protectedCard, oldScatter]) geometry.dispose();
  });

  it('moves cards that already reach into the protected room out of it, with their copies', () => {
    // A card at the eaves dipping 0.3 below the room's top.
    const geometry = new THREE.PlaneGeometry(1, 1).translate(0, 3.2, 0);
    const room = new THREE.Box3(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 3, 3));
    broadenWoodlandCards(geometry, room);
    const p = geometry.attributes.position;
    expect(p.count).toBe(8);
    for (let card = 0; card < 2; card++) {
      const bounds = new THREE.Box3();
      for (let i = 4 * card; i < 4 * card + 4; i++) bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(p, i));
      expect(room.intersectsBox(bounds)).toBe(false);
    }
    geometry.dispose();
  });

  it('leaves continuous meshes intact', () => {
    const geometry = new THREE.PlaneGeometry(2, 2, 2, 2);
    const positions = Array.from(geometry.attributes.position.array);
    broadenWoodlandCards(geometry);
    expect(Array.from(geometry.attributes.position.array)).toEqual(positions);
    geometry.dispose();
  });
});
