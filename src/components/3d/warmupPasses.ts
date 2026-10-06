import * as THREE from 'three';
import { PREPASS_LAYER } from './depthPrepass';
import { MIRROR_LAYER } from './planarReflection';
import { SHADOW_MASK_LAYER } from './shadowMask';

export type WarmupPass = 'main' | 'mirror';

export interface WarmupPassOptions {
  mainLayers: THREE.Layers;
  mirrorEnabled: boolean;
  shadowMaskEnabled: boolean;
  waterLevel: number;
}

/** Conservative eligibility, not proof of a draw. Recollect after each view/configuration change.
 * The caller updates world matrices and side-image visibility before collecting.
 */
export function collectWarmupPasses(root: THREE.Object3D, options: WarmupPassOptions) {
  const main = new THREE.Layers();
  main.mask = options.mainLayers.mask;
  main.enable(PREPASS_LAYER);
  const mirror = new THREE.Layers();
  mirror.enable(MIRROR_LAYER);
  if (options.shadowMaskEnabled) {
    for (const layers of [main, mirror]) {
      layers.enable(PREPASS_LAYER);
      layers.enable(SHADOW_MASK_LAYER);
    }
  }
  const result = new Map<THREE.Material, Set<WarmupPass>>();
  const sphere = new THREE.Sphere();
  root.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const passes: WarmupPass[] = [];
    if (object.layers.test(main)) passes.push('main');
    if (options.mirrorEnabled && object.layers.test(mirror)) {
      const instance = object as THREE.InstancedMesh;
      const batch = object as THREE.BatchedMesh;
      const bounded = instance.isInstancedMesh ? instance : batch.isBatchedMesh ? batch : mesh.geometry;
      let aboveWater = true;
      if (object.frustumCulled && bounded) {
        if (bounded.boundingSphere === null) bounded.computeBoundingSphere();
        // Missing/nonfinite bounds must not falsely mark a material as unnecessary.
        if (bounded.boundingSphere) {
          sphere.copy(bounded.boundingSphere).applyMatrix4(object.matrixWorld);
          const top = sphere.center.y + sphere.radius;
          aboveWater = !Number.isFinite(top) || top >= options.waterLevel;
        }
      }
      if (aboveWater) passes.push('mirror');
    }
    if (!passes.length) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material.visible) continue;
      const needed = result.get(material) ?? new Set<WarmupPass>();
      for (const pass of passes) needed.add(pass);
      result.set(material, needed);
    }
  });
  return result;
}
