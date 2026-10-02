import * as THREE from 'three';
import { ALPHA_TEST, LEAF_COVERAGE_GLSL } from './leafCluster';
import { refractedDepthMaterial } from './refraction';

// Almost all of a frame's GPU time is fragment shading (every light, PCSS shadows, probes), and
// the merged meshes defeat three's front-to-back sort: the sauna view shaded about 4.7 fragments
// per pixel. A depth-only pass first leaves the lit pass one shaded fragment per pixel of these
// surfaces. It draws depth-only copies of the opaque meshes on PREPASS_LAYER, children of the
// meshes so they follow their transforms and visibility, sharing the geometry.
//
// Left out, drawn by the lit pass as before: transparent and blended surfaces, and anything not on
// the default layer (side images, the mirror's lights, steam). Materials under the water draw each
// vertex at its refracted image and may discard behind the sides; their copies refract the same
// way and write no depth where the lit pass may discard (refractedDepthMaterial in refraction.ts).
// The woodland cards cut their leaves out of an alpha map, with alpha to coverage under the MSAA
// (leafCluster.ts); their copies write depth only where the lit pass covers every sample, so no
// sample behind an edge it covers partly is hidden.

export const PREPASS_LAYER = 4;

// Pushed back a little, so the lit pass's own fragments pass the less-or-equal test whatever the
// small differences of the two programs' vertex arithmetic, while nearer surfaces still hide farther.
function depthMaterial(side: THREE.Side) {
  return new THREE.MeshBasicMaterial({
    colorWrite: false,
    side,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

/**
 * The alpha map of a `material` whose only alpha is its alpha map with an alpha test (the woodland
 * cards), or null.
 */
export function cutoutOf(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial) || material.alphaTest <= 0 || !material.alphaMap) return null;
  // The map's alpha, vertex alphas, alpha hashing and refraction are not reproduced by the copies.
  if (material.map || material.vertexColors || material.alphaHash || material.defines?.SUI_REFRACTION !== undefined)
    return null;
  return material.alphaMap;
}

// The copy of a cut-out material: depth where the lit pass's alpha to coverage covers every sample
// (the woodland cards' suiLeafCoverage at 1, leafCluster.ts). Without alpha to coverage, wherever
// the lit pass draws.
function cutoutDepthMaterial(material: THREE.MeshStandardMaterial, alphaMap: THREE.Texture) {
  const copy = depthMaterial(material.side);
  copy.alphaMap = alphaMap;
  copy.alphaTest = material.alphaTest;
  copy.opacity = material.opacity;
  const covered = material.alphaToCoverage;
  copy.onBeforeCompile = (shader) => {
    if (!shader.fragmentShader.includes(ALPHA_TEST))
      throw new Error('three shader chunks changed; update depthPrepass.ts');
    if (covered)
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${LEAF_COVERAGE_GLSL}\nvoid main() {`)
        .replace(ALPHA_TEST, 'if ( suiLeafCoverage( diffuseColor.a, vAlphaMapUv ) < 1.0 ) discard;');
  };
  copy.customProgramCacheKey = () => `sui-cutout-depth|${covered}`;
  return copy;
}

/** Whether the lit pass's `material` can take its depth from the depth-only pass. */
export function takesPrepassDepth(material: THREE.Material) {
  const cutout = cutoutOf(material) !== null;
  return (
    material.visible &&
    !material.transparent &&
    material.blending === THREE.NormalBlending &&
    material.depthTest &&
    material.depthWrite &&
    material.colorWrite &&
    (cutout ||
      (!material.alphaTest && !material.alphaToCoverage && !(material as THREE.MeshStandardMaterial).alphaMap)) &&
    !(material as THREE.MeshStandardMaterial).displacementMap &&
    !(material instanceof THREE.ShaderMaterial)
  );
}

export function createDepthPrepass() {
  const materials = new Map<string, THREE.MeshBasicMaterial>();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const cutouts = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  const materialFor = (material: THREE.Material) => {
    const alphaMap = cutoutOf(material);
    if (alphaMap) {
      if (!cutouts.has(material))
        cutouts.set(material, cutoutDepthMaterial(material as THREE.MeshStandardMaterial, alphaMap));
      return cutouts.get(material)!;
    }
    const level = (material as { defines?: Record<string, unknown> }).defines?.SUI_REFRACTION;
    const key = `${material.side}|${level ?? ''}`;
    if (!materials.has(key))
      materials.set(
        key,
        level === undefined ? depthMaterial(material.side) : refractedDepthMaterial(String(level), material.side),
      );
    return materials.get(key)!;
  };
  const defaultLayer = new THREE.Layers();
  return {
    /** Adds depth-only copies of `root`'s eligible meshes; returns how many. */
    add(root: THREE.Object3D) {
      const sources: THREE.Mesh[] = [];
      root.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          !(object instanceof THREE.InstancedMesh) &&
          !(object instanceof THREE.SkinnedMesh) &&
          !object.morphTargetInfluences &&
          object.layers.mask === defaultLayer.mask
        )
          sources.push(object);
      });
      let added = 0;
      for (const source of sources) {
        const list: THREE.Material[] = Array.isArray(source.material) ? source.material : [source.material];
        const depth = list.map((material) => (takesPrepassDepth(material) ? materialFor(material) : hidden));
        if (depth.every((material) => material === hidden)) continue;
        const copy = new THREE.Mesh(source.geometry, Array.isArray(source.material) ? depth : depth[0]);
        copy.name = `${source.name} depth`;
        copy.layers.set(PREPASS_LAYER);
        copy.castShadow = copy.receiveShadow = false;
        copy.renderOrder = source.renderOrder;
        copy.frustumCulled = source.frustumCulled;
        source.add(copy);
        added++;
      }
      return added;
    },
    dispose() {
      for (const material of [...materials.values(), ...cutouts.values()]) material.dispose();
      hidden.dispose();
    },
  };
}
export type DepthPrepass = ReturnType<typeof createDepthPrepass>;
