import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createDownwardRay } from './downwardRay';

// Uneven, turned and scaled terrain pieces that overlap, indexed or not, on every side.
function terrain() {
  const root = new THREE.Group();
  const hilly = new THREE.PlaneGeometry(20, 16, 23, 19);
  const position = hilly.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setZ(i, Math.sin(position.getX(i) * 0.7) * Math.cos(position.getY(i) * 0.5) * 1.3);
  }
  const ground = new THREE.Mesh(hilly, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }));
  ground.rotation.set(-Math.PI / 2, 0, 0.4);
  ground.scale.set(1.1, 0.9, 1.2);
  ground.position.set(1.5, 0.2, -0.7);
  const gravel = new THREE.Mesh(
    new THREE.CircleGeometry(3, 17).toNonIndexed(),
    new THREE.MeshStandardMaterial({ side: THREE.FrontSide }),
  );
  gravel.rotation.x = -Math.PI / 2 + 0.15;
  gravel.position.set(-2, 0.9, 1);
  // Seen from above only from the back: the ray hits it only with its BackSide material.
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6, 3, 3),
    new THREE.MeshStandardMaterial({ side: THREE.BackSide }),
  );
  under.rotation.x = Math.PI / 2;
  under.position.set(3, 0.6, 2);
  const ranged = new THREE.Mesh(new THREE.PlaneGeometry(8, 8, 4, 4), new THREE.MeshStandardMaterial());
  ranged.rotation.x = -Math.PI / 2;
  ranged.position.y = 1.1;
  ranged.geometry.setDrawRange(6, 30);
  root.add(ground, gravel, under, ranged);
  root.updateMatrixWorld(true);
  return [ground, gravel, under, ranged];
}

describe('downward ray', () => {
  it('finds the raycaster’s first hit to the bit, misses included', () => {
    const meshes = terrain();
    const downward = createDownwardRay(meshes, 25, 0.7);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    let hits = 0;
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let n = 0; n < 4000; n++) {
      const x = -16 + random() * 32;
      const z = -14 + random() * 28;
      raycaster.ray.origin.set(x, 25, z);
      const expected = raycaster.intersectObjects(meshes, false)[0]?.point.y;
      if (expected !== undefined) hits++;
      expect(downward(x, z)).toBe(expected);
    }
    // Both hits and misses were compared.
    expect(hits).toBeGreaterThan(1000);
    expect(hits).toBeLessThan(4000);
  });
  it('takes the raycaster for meshes it does not bin', () => {
    const [ground] = terrain();
    ground.geometry.morphAttributes.position = [ground.geometry.attributes.position.clone()];
    const raycaster = new THREE.Raycaster(new THREE.Vector3(1, 25, 2), new THREE.Vector3(0, -1, 0));
    expect(createDownwardRay([ground], 25)(1, 2)).toBe(raycaster.intersectObject(ground, false)[0]?.point.y);
  });
  it('misses everywhere without triangles', () => {
    expect(createDownwardRay([], 25)(0, 0)).toBeUndefined();
  });
});
