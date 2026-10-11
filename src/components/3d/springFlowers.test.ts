import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { addSpringFlowers } from './springFlowers';
import { createSeasonColors } from './season';

function garden() {
  const root = new THREE.Group();
  root.position.y = 1.2;
  const material = new THREE.MeshStandardMaterial();
  material.name = 'V9 | layered living moss';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), material);
  root.add(ground);
  return root;
}

describe('spring flowers', () => {
  it('anchors one merged mesh to transformed ground with deterministic geometry', () => {
    const first = garden();
    const second = garden();
    expect(addSpringFlowers(first)).toBe(70);
    expect(addSpringFlowers(second)).toBe(70);
    const flower = first.getObjectByName('Spring wildflowers') as THREE.Mesh;
    const other = second.getObjectByName('Spring wildflowers') as THREE.Mesh;
    flower.geometry.computeBoundingBox();
    expect(flower.geometry.boundingBox!.min.y).toBeCloseTo(0.008, 5);
    expect(flower.geometry.boundingBox!.max.y).toBeLessThan(0.3);
    expect(flower.geometry.attributes.position.array).toEqual(other.geometry.attributes.position.array);
    expect(Array.from(flower.geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
    const seasons = createSeasonColors();
    seasons.add(first, 'winter');
    expect(flower.visible).toBe(false);
    expect(seasons.flowerCount).toBe(0);
    expect(seasons.update('spring')).toBe(true);
    expect(flower.visible).toBe(true);
    expect(seasons.flowerCount).toBe(70);
    seasons.update('summer');
    expect(flower.visible).toBe(false);
    expect(seasons.flowerCount).toBe(0);
  });
  it('does not invent a floor or put flowers on water or indoor surfaces', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    material.name = 'V4 | clear spring water';
    root.add(new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), material));
    expect(addSpringFlowers(root)).toBe(0);
    expect(root.children).toHaveLength(1);
  });
});
