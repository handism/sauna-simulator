import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { prepareModel, disposeTree } from './modelMaterials';
import { INTERIOR_BOX } from './interiorLights';

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
  it('moves leaf cards out of the room even under a transformed parent', () => {
    const root = new THREE.Group();
    root.position.set(-3, 1.8, -2);
    root.rotation.y = 0.4;
    root.scale.set(1.2, 1, 0.8);
    const geometry = new THREE.PlaneGeometry(0.3, 0.3);
    for (let i = 0; i < 4; i++) geometry.attributes.normal.setXYZ(i, 1, 0, 0);
    const material = new THREE.MeshStandardMaterial({ name: 'V6 woodland leaf 0 card' });
    material.userData.suiLeafCluster = { leaves: 20 };
    const mesh = new THREE.Mesh(geometry, material);
    root.add(mesh);
    prepareModel(root);
    expect(geometry.attributes.position.count).toBe(8);
    for (let card = 0; card < 2; card++) {
      const bounds = new THREE.Box3();
      for (let i = 4 * card; i < 4 * card + 4; i++)
        bounds.expandByPoint(
          new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld),
        );
      expect(INTERIOR_BOX.intersectsBox(bounds)).toBe(false);
    }
    disposeTree(root);
  });
});
