import * as THREE from 'three';

// Thin leaves, fern fronds and conifer sprays. Fallen leaves and moss lie on the ground.
const FOLIAGE = /\b(leaf|foliage|fern)\b|maple fresh olive/i;

export function isFoliageMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return material instanceof THREE.MeshStandardMaterial && FOLIAGE.test(material.name);
}

// Cycles shades both faces of the single leaf planes, and passes no light to the far face: the
// source leaves have no translucency and at most 0.08 Subsurface Weight, and lit from behind in
// Cycles they return under 0.1% of their front-lit radiance. The probes light the viewer side.
export function applyFoliage(material: THREE.MeshStandardMaterial) {
  material.side = THREE.DoubleSide;
  material.needsUpdate = true;
}
