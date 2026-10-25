import * as THREE from 'three';
import { SMALL_LEAF, shapeCanopyLeaves } from './canopyLeafShape';
import { shapeFernLeaflets } from './fernShape';
import { roundMapleCrowns, tiltMapleLeaves } from './mapleLeafTilt';
import { applySurfaceDetails, surfaceDetailOf, type SurfaceDetail } from './surfaceDetails';
import { broadenWoodlandCards } from './woodlandCrowns';
import { INTERIOR_BOX, shadeStovePile } from './interiorLights';
import { applyFoliage, isFoliageMaterial } from './foliage';
import { applyLeafCluster, createLeafClusterTexture, leafClusterOf } from './leafCluster';
import { applyImageRamp, imageRampOf, type ImageRamp } from './imageRamp';
import { applyNoiseColor, noiseColorOf, type NoiseColor } from './noiseColor';

export function disposeTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  // Depth-only copies (depthPrepass.ts) share their source's geometry.
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
      geometries.add(object.geometry);
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
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export interface PreparedModelStats {
  foliageMaterials: number;
  noiseColorMaterials: number;
  imageRampMaterials: number;
  leafClusterMaterials: number;
  tiltedMapleLeaves: number;
}

/**
 * Applies the browser-side material extensions recorded by the exporter and the
 * shadow/visibility rules. Returns per-extension material counts for the DOM metrics.
 */
const CONCEALED_LED = '2700K concealed LED';
/** The share of the concealed bench strip's emission kept for its look. */
export const CONCEALED_LED_GLOW = 0.1;

export function prepareModel(root: THREE.Object3D): PreparedModelStats {
  const foliage = new Set<THREE.MeshStandardMaterial>();
  const noiseColors = new Map<THREE.MeshStandardMaterial, NoiseColor>();
  const imageRamps = new Map<THREE.MeshStandardMaterial, ImageRamp>();
  const surfaces = new Map<THREE.MeshStandardMaterial, SurfaceDetail>();
  const leafClusters = new Map<number, THREE.DataTexture>();
  let leafClusterMaterials = 0;
  let tiltedMapleLeaves = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (
      materials.every(
        (material) => /^V6 woodland leaf \d+ card(?: evergreen)?$/.test(material.name) && leafClusterOf(material),
      )
    ) {
      // Exclusion is in the card geometry's local space, including transformed mesh parents.
      object.updateWorldMatrix(true, false);
      const excluded = INTERIOR_BOX.clone().expandByScalar(0.15).applyMatrix4(object.matrixWorld.clone().invert());
      broadenWoodlandCards(object.geometry, excluded);
    }
    if (materials.every((material) => /^V3 \| fern [0-2]$/.test(material.name))) {
      shapeFernLeaflets(object.geometry);
    }
    if (materials.every((material) => /^V5 forest leaf \d+$/.test(material.name))) {
      shapeCanopyLeaves(object.geometry);
    }
    // The garden's near maples (V11). The body's V7 maple behind the wall has no level lobed leaves.
    if (materials.every((material) => /^V11 \| maple leaf \d+$/.test(material.name))) {
      tiltedMapleLeaves += tiltMapleLeaves(object.geometry);
      roundMapleCrowns(object);
    }
    // The garden's fine canopy behind the building: the lighter outline for 78k small leaves.
    if (materials.every((material) => /^Forest leaf tone \d+$/.test(material.name))) {
      shapeCanopyLeaves(object.geometry, SMALL_LEAF);
    }
    for (const material of materials) {
      shadeStovePile(material);
      // Not in the source: the strip under the lower bench, which the lips hide, showed through the
      // gaps between the slats as thin white lines: the under-bench area light right at it lit its
      // warm base color far past white. It is the light, so it takes none (black base color) and
      // keeps a share of its glow; its light on the room stays the area lights' (interiorLights.ts).
      if (
        material.name === CONCEALED_LED &&
        material instanceof THREE.MeshStandardMaterial &&
        !material.userData.suiDimmed
      ) {
        material.color.setScalar(0);
        material.emissiveIntensity *= CONCEALED_LED_GLOW;
        material.userData.suiDimmed = true;
      }
      if (isFoliageMaterial(material)) foliage.add(material);
      const noise = noiseColorOf(material);
      if (noise) {
        const fern = /^V3 \| fern [0-2]$/.test(material.name);
        noiseColors.set(
          material as THREE.MeshStandardMaterial,
          fern
            ? {
                ...noise,
                stops: noise.stops.map(([at, r, g, b]) => [at, r * 0.85, g * 0.85, b * 0.85]),
              }
            : noise,
        );
      }
      const detail = surfaceDetailOf(material.name);
      if (detail && material instanceof THREE.MeshStandardMaterial) surfaces.set(material, detail);
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
    // Water and steam cast no shadow. Cycles glass passes no direct light (only refracted view
    // rays), so glass shadows every light but receives none.
    object.receiveShadow = materials.every((material) => !material.transparent);
    object.castShadow = object.receiveShadow || materials.some((material) => /glass/i.test(material.name));
    // Replace the exported closed water volume with the bounded realtime surface.
    // Drawing both creates a milky double layer when the viewer sits in the pool.
    if (materials.every((material) => material.name === 'V4 | clear spring water')) object.visible = false;
  });
  foliage.forEach(applyFoliage);
  noiseColors.forEach((noise, material) => applyNoiseColor(material, noise));
  imageRamps.forEach((ramp, material) => applyImageRamp(material, ramp));
  surfaces.forEach((kind, material) => applySurfaceDetails(material, kind));
  return {
    foliageMaterials: foliage.size,
    noiseColorMaterials: noiseColors.size,
    imageRampMaterials: imageRamps.size,
    leafClusterMaterials,
    tiltedMapleLeaves,
  };
}
