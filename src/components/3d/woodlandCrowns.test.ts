import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { broadenWoodlandCards } from './woodlandCrowns';

describe('woodland crown cards', () => {
  it('preserves branch anchors, normals, UVs and triangle counts and expands bounds only once', () => {
    const cards = [new THREE.PlaneGeometry(2, 2).translate(-4, 3, 0), new THREE.PlaneGeometry(2, 2).translate(4, 5, 2)];
    const geometry = mergeGeometries(cards);
    const uv = Array.from(geometry.attributes.uv.array);
    const normals = Array.from(geometry.attributes.normal.array);
    const indices = Array.from(geometry.index!.array);
    broadenWoodlandCards(geometry);
    const position = geometry.attributes.position;
    for (let card = 0; card < 2; card++) {
      const center = new THREE.Vector3();
      for (let i = card * 4; i < card * 4 + 4; i++) center.add(new THREE.Vector3().fromBufferAttribute(position, i));
      center.multiplyScalar(0.25);
      expect(center.distanceTo(new THREE.Vector3(card ? 4 : -4, card ? 5 : 3, card ? 2 : 0))).toBeLessThan(1e-6);
    }
    expect(geometry.boundingBox!.min.x).toBeLessThan(-5.3);
    expect(Array.from(geometry.attributes.uv.array)).toEqual(uv);
    expect(Array.from(geometry.attributes.normal.array)).toEqual(normals);
    expect(Array.from(geometry.index!.array)).toEqual(indices);
    const result = Array.from(position.array);
    broadenWoodlandCards(geometry);
    expect(Array.from(position.array)).toEqual(result);
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
