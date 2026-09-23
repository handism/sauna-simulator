import * as THREE from 'three';
import { applyFoliageTransmission, isFoliageMaterial } from './foliage';
import { applyLeafCluster, createLeafClusterTexture, leafClusterOf } from './leafCluster';
import { applyImageRamp, imageRampOf, type ImageRamp } from './imageRamp';
import { applyNoiseColor, noiseColorOf, type NoiseColor } from './noiseColor';

export function disposeTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    texture.dispose();
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close();
  }
  for (const material of materials) material.dispose();
}

export interface PreparedModelStats {
  foliageMaterials: number;
  noiseColorMaterials: number;
  imageRampMaterials: number;
  leafClusterMaterials: number;
}

/**
 * Applies the browser-side material extensions recorded by the exporter and the
 * shadow/visibility rules. Returns per-extension material counts for the DOM metrics.
 */
export function prepareModel(root: THREE.Object3D): PreparedModelStats {
  const foliage = new Set<THREE.MeshStandardMaterial>();
  const noiseColors = new Map<THREE.MeshStandardMaterial, NoiseColor>();
  const imageRamps = new Map<THREE.MeshStandardMaterial, ImageRamp>();
  const leafClusters = new Map<number, THREE.DataTexture>();
  let leafClusterMaterials = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (isFoliageMaterial(material)) foliage.add(material);
      const noise = noiseColorOf(material);
      if (noise) noiseColors.set(material as THREE.MeshStandardMaterial, noise);
      const ramp = imageRampOf(material);
      if (ramp) imageRamps.set(material as THREE.MeshStandardMaterial, ramp);
      const cluster = leafClusterOf(material);
      if (cluster && material instanceof THREE.MeshStandardMaterial && !material.alphaMap) {
        // One mask per leaf count; disposeTree releases it with the materials.
        if (!leafClusters.has(cluster.leaves)) leafClusters.set(cluster.leaves, createLeafClusterTexture(cluster));
        applyLeafCluster(material, leafClusters.get(cluster.leaves)!);
        leafClusterMaterials++;
      }
    }
    // Glass and water must not cast opaque silhouettes onto the garden.
    object.castShadow = materials.every((material) => !material.transparent);
    object.receiveShadow = object.castShadow;
    // Replace the exported closed water volume with the bounded realtime surface.
    // Drawing both creates a milky double layer when the viewer sits in the pool.
    if (materials.every((material) => material.name === 'V4 | clear spring water')) object.visible = false;
  });
  foliage.forEach(applyFoliageTransmission);
  noiseColors.forEach((noise, material) => applyNoiseColor(material, noise));
  imageRamps.forEach((ramp, material) => applyImageRamp(material, ramp));
  return {
    foliageMaterials: foliage.size,
    noiseColorMaterials: noiseColors.size,
    imageRampMaterials: imageRamps.size,
    leafClusterMaterials,
  };
}
