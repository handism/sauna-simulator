import * as THREE from 'three';

// Almost all of a frame's GPU time is fragment shading (every light, PCSS shadows, probes), and
// the merged meshes defeat three's front-to-back sort: the sauna view shaded about 4.7 fragments
// per pixel. A depth-only pass first leaves the lit pass one shaded fragment per pixel of these
// surfaces. It draws depth-only copies of the opaque meshes on PREPASS_LAYER, children of the
// meshes so they follow their transforms and visibility, sharing the geometry.
//
// Left out, drawn by the lit pass as before: transparent and blended surfaces; alpha tested and
// alpha-to-coverage leaves (their depth needs the mask); materials under the water, whose vertex
// stage draws each vertex at its refracted place (refraction.ts) and whose fragments may discard;
// and anything not on the default layer (side images, the mirror's lights, steam).

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

/** Whether the lit pass's `material` can take its depth from the depth-only pass. */
export function takesPrepassDepth(material: THREE.Material) {
  return (
    material.visible &&
    !material.transparent &&
    material.blending === THREE.NormalBlending &&
    material.depthTest &&
    material.depthWrite &&
    material.colorWrite &&
    !material.alphaTest &&
    !material.alphaToCoverage &&
    !(material as THREE.MeshStandardMaterial).alphaMap &&
    !(material as THREE.MeshStandardMaterial).displacementMap &&
    !(material instanceof THREE.ShaderMaterial) &&
    (material as { defines?: Record<string, unknown> }).defines?.SUI_REFRACTION === undefined
  );
}

export function createDepthPrepass() {
  const materials = new Map<THREE.Side, THREE.MeshBasicMaterial>();
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const materialFor = (side: THREE.Side) => {
    if (!materials.has(side)) materials.set(side, depthMaterial(side));
    return materials.get(side)!;
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
        const depth = list.map((material) => (takesPrepassDepth(material) ? materialFor(material.side) : hidden));
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
      for (const material of materials.values()) material.dispose();
      hidden.dispose();
    },
  };
}
export type DepthPrepass = ReturnType<typeof createDepthPrepass>;
