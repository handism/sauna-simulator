import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { prepareModel } from './modelMaterials';

describe('model shadows', () => {
  it('lets glass block direct light like Cycles while water and opaque parts keep their rules', () => {
    const root = new THREE.Group();
    const mesh = (name: string, transparent: boolean) => {
      const object = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({ name, transparent }));
      root.add(object);
      return object;
    };
    const glass = mesh('Low iron architectural glass', true);
    const water = mesh('V4 | wet surface', true);
    const wall = mesh('Warm limestone plaster', false);
    prepareModel(root);
    expect([glass.castShadow, glass.receiveShadow]).toEqual([true, false]);
    expect([water.castShadow, water.receiveShadow]).toEqual([false, false]);
    expect([wall.castShadow, wall.receiveShadow]).toEqual([true, true]);
  });
});
