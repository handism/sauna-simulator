import * as THREE from 'three';
import { SMALL_LEAF, shapeCanopyLeaves } from './canopyLeafShape';
import { shapeFernLeaflets } from './fernShape';
import { roundMapleCrowns, tiltMapleLeaves } from './mapleLeafTilt';
import { applySurfaceDetails, surfaceDetailOf, type SurfaceDetail } from './surfaceDetails';
import { broadenWoodlandCards } from './woodlandCrowns';
import { INTERIOR_BOX, WATER_BOX, shadeStovePile } from './interiorLights';
import { applyFoliage, isFoliageMaterial } from './foliage';
import { applyLeafCluster, createLeafClusterTexture, leafClusterOf, NEEDLE_LEAF } from './leafCluster';
// The woodland's evergreen share (evergreenWoodland.ts) draws needle sprays.
const EVERGREEN_CARD = /card evergreen$/;
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

/**
 * The ferns' noise ramp (not in the source): darker and greener. At 0.85 of the source's grey-green
 * the fronds, thin leaflets over the meadow of nearly their color, read as pale translucent ghosts.
 */
export const FERN_TINT = [0.62, 0.8, 0.5] as const;

const PLUNGE_SIDE = 'V10 | submerged light / V9 | quiet honed stone / V2 | mineral c';
/**
 * The plunge's outer sides share the stone of its walls under water, whose source mixes 64% of a
 * flat dark color over the basalt image for the submerged look. Out of the water (from the sauna
 * through the glass, the long face beside the bench) that left one featureless dark slab.
 */
export const PLUNGE_OUTER_MIX = 0.15;
// Past the walls' inner faces (WATER_BOX reaches the slab 2.5 cm beyond them) and short of the
// outer ones about 30 cm further out.
const PLUNGE_INNER = WATER_BOX.clone().expandByVector(new THREE.Vector3(0.1, 0, 0.1));

/**
 * Moves the plunge stone's triangles outside the pool's walls to a copy of the material with
 * PLUNGE_OUTER_MIX, before prepareModel. Attributes stay shared; the copy differs only in the mix
 * uniform and has no underwater triangles. Returns the triangles moved.
 */
export function exposePlungeSides(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      object.material instanceof THREE.MeshStandardMaterial &&
      object.material.name === PLUNGE_SIDE &&
      !object.material.userData.suiPlungeOuter
    )
      meshes.push(object);
  });
  const point = new THREE.Vector3();
  let triangles = 0;
  for (const mesh of meshes) {
    const source = mesh.geometry;
    const index = source.index;
    const ramp = imageRampOf(mesh.material as THREE.MeshStandardMaterial);
    if (!index || !ramp?.mix) throw Error('Expected the indexed plunge stone with its mix');
    const position = source.getAttribute('position');
    const kept: number[] = [],
      outer: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      point.set(0, 0, 0);
      for (const v of vertices)
        point.add(new THREE.Vector3().fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld));
      point.divideScalar(3);
      const outside =
        point.x < PLUNGE_INNER.min.x ||
        point.x > PLUNGE_INNER.max.x ||
        point.z < PLUNGE_INNER.min.z ||
        point.z > PLUNGE_INNER.max.z;
      (outside ? outer : kept).push(...vertices);
    }
    if (!outer.length) continue;
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(outer);
    source.setIndex(kept);
    const material = (mesh.material as THREE.MeshStandardMaterial).clone();
    material.userData.suiPlungeOuter = true;
    // Laid blocks (surfaceDetails.ts PLUNGE_BLOCKS).
    material.defines = { ...material.defines, SUI_PLUNGE_BLOCKS: '' };
    material.userData.suiImageRamp = { ...ramp, mix: { ...ramp.mix, factor: PLUNGE_OUTER_MIX } };
    const sides = new THREE.Mesh(geometry, material);
    sides.name = 'Plunge outer sides';
    sides.castShadow = mesh.castShadow;
    sides.receiveShadow = mesh.receiveShadow;
    mesh.add(sides);
    triangles += outer.length / 3;
  }
  return triangles;
}

export function prepareModel(root: THREE.Object3D): PreparedModelStats {
  const foliage = new Set<THREE.MeshStandardMaterial>();
  const noiseColors = new Map<THREE.MeshStandardMaterial, NoiseColor>();
  const imageRamps = new Map<THREE.MeshStandardMaterial, ImageRamp>();
  const surfaces = new Map<THREE.MeshStandardMaterial, SurfaceDetail>();
  const leafClusters = new Map<string, THREE.DataTexture>();
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
        // The fronds take the crowns' daytime cut of the sky's gloss (crownNormals.ts).
        // Their color tints the ramp (season.ts turns them in autumn), white otherwise.
        if (fern) {
          material.defines = { ...material.defines, SUI_CROWN_SPECULAR: '', SUI_NOISE_TINT: '' };
          (material as THREE.MeshStandardMaterial).color.setScalar(1);
        }
        noiseColors.set(
          material as THREE.MeshStandardMaterial,
          fern
            ? {
                ...noise,
                stops: noise.stops.map(([at, r, g, b]) => [at, r * FERN_TINT[0], g * FERN_TINT[1], b * FERN_TINT[2]]),
              }
            : noise,
        );
      }
      // The plunge's outer sides take the speckle and grain of the other dry stone.
      const detail = material.userData.suiPlungeOuter ? 'stone' : surfaceDetailOf(material.name);
      if (detail && material instanceof THREE.MeshStandardMaterial) surfaces.set(material, detail);
      const ramp = imageRampOf(material);
      if (ramp) imageRamps.set(material as THREE.MeshStandardMaterial, ramp);
      const cluster = leafClusterOf(material);
      if (cluster && material instanceof THREE.MeshStandardMaterial && !material.alphaMap) {
        // One mask per leaf count and form; disposeTree releases it with the materials.
        const needles = EVERGREEN_CARD.test(material.name);
        const key = `${cluster.leaves}${needles ? ' needles' : ''}`;
        if (!leafClusters.has(key))
          leafClusters.set(key, createLeafClusterTexture(cluster, needles ? NEEDLE_LEAF : undefined));
        applyLeafCluster(material, leafClusters.get(key)!);
        leafClusterMaterials++;
      }
    }
    // Water and steam cast no shadow. Cycles glass passes no direct light (only refracted view
    // rays), so glass shadows every light but receives none (nor does the pail's water, glass.ts).
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
