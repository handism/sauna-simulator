import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PLUNGE_OUTER_MIX, exposePlungeSides, prepareModel, disposeTree } from './modelMaterials';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';

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
    const pail = mesh('Loyly | recessed pail water', true);
    prepareModel(root);
    expect([pail.castShadow, pail.receiveShadow]).toEqual([false, true]);
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

describe('plunge outer sides', () => {
  const ramp = {
    luminance: [0.2126, 0.7152, 0.0722],
    stops: [
      [0.05, 0.02, 0.03, 0.03],
      [0.58, 0.19, 0.21, 0.2],
    ],
    random: [
      [0, 0.72, 0.72, 0.72],
      [1, 1.1, 1.1, 1.1],
    ],
    mix: { factor: 0.64, color: [0.1, 0.12, 0.11] },
  };
  it('moves only the faces outside the walls to a dry copy with the stone details', () => {
    const root = new THREE.Group();
    root.position.set(0.5, 0, 0);
    // One face on the inner wall (in the water) and one on the outer side facing the sauna.
    const geometry = new THREE.BufferGeometry();
    const inner = WATER_BOX.min.x - 0.5 + 0.02;
    const outer = WATER_BOX.min.x - 0.5 - 0.3;
    // prettier-ignore
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      inner, 0.3, -2, inner, 0.6, -2, inner, 0.3, -1.5,
      outer, 0.3, -2, outer, 0.6, -2, outer, 0.3, -1.5,
    ], 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(0.5), 3));
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const material = new THREE.MeshStandardMaterial({
      name: 'V10 | submerged light / V9 | quiet honed stone / V2 | mineral c',
      map: new THREE.Texture(),
      vertexColors: true,
    });
    material.userData.suiImageRamp = ramp;
    const mesh = new THREE.Mesh(geometry, material);
    root.add(mesh);
    expect(exposePlungeSides(root)).toBe(1);
    expect(Array.from(geometry.index!.array)).toEqual([0, 1, 2]);
    const sides = mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(Array.from(sides.geometry.index!.array)).toEqual([3, 4, 5]);
    expect(sides.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
    expect(sides.material.userData.suiImageRamp.mix.factor).toBe(PLUNGE_OUTER_MIX);
    expect(material.userData.suiImageRamp.mix.factor).toBe(0.64);
    // Nothing is left outside, and the copy is not split again.
    expect(exposePlungeSides(root)).toBe(0);
    prepareModel(root);
    expect(sides.material.customProgramCacheKey()).toContain('surface-details-stone');
    expect(material.customProgramCacheKey()).not.toContain('surface-details');
    disposeTree(root);
  });
});
