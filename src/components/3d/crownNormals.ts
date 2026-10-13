import * as THREE from 'three';
import { trunkBases, trunkFinder, WOODLAND_CARD } from './evergreenWoodland';

/** Share of a card's shading normal taken from its crown's rounded shape (the rest is the card's own). */
export const CROWN_NORMAL_WEIGHT = 0.9;
/** Least half extent of a crown (m), so a narrow crown does not shade like a blade. */
const MIN_EXTENT = 0.6;

// Cards keep the normal written for them; lit on both sides, three turns it to the viewer.
// SUI_CROWN_NORMAL keeps it as written: outward from the crown on either side of the card.
const NORMAL_BEGIN = 'vec3 nonPerturbedNormal = normal;';
if (!THREE.ShaderChunk.normal_fragment_begin.includes(NORMAL_BEGIN))
  throw new Error('three normal chunk changed; update crownNormals.ts');
if (!THREE.ShaderChunk.normal_fragment_begin.includes('SUI_CROWN_NORMAL'))
  THREE.ShaderChunk.normal_fragment_begin = THREE.ShaderChunk.normal_fragment_begin.replace(
    NORMAL_BEGIN,
    `#ifdef SUI_CROWN_NORMAL\n\tnormal = normalize( vNormal );\n#endif\n${NORMAL_BEGIN}`,
  );

/** GLSL condition for turning a two-sided normal to the viewer, which crown normals skip. */
export const TURNS_TO_VIEWER = 'defined( DOUBLE_SIDED ) && ! defined( SUI_CROWN_NORMAL )';

interface Crown {
  sum: THREE.Vector3;
  count: number;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * The woodland's leaf cards were lit as scattered flat cards facing every way, so a crown read as a
 * speckle of light and dark tufts on bare branches. Each card goes to its tree (the nearest trunk,
 * as for the evergreens) and its normals lean outward from that crown's center, scaled by the
 * crown's extents: the sunlit side of a crown is light, the far side and the underside dark, as a
 * leafy mass shades. Call before splitEvergreenWoodland (which copies the define to its clones) and the
 * model preparation. Returns the number of cards rounded.
 */
export function roundWoodlandCrowns(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const nearestTrunk = trunkFinder(trunkBases(root));
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !Array.isArray(object.material) &&
      WOODLAND_CARD.test(object.material.name) &&
      object.geometry.index &&
      object.geometry.attributes.normal
    )
      meshes.push(object);
  });
  const crowns = new Map<number, Crown>();
  const p = new THREE.Vector3();
  const local = new THREE.Vector3();
  // Each card's tree, by mesh, in the order of its cards (six indices each).
  const trees = meshes.map((mesh) => {
    const index = mesh.geometry.index!;
    const position = mesh.geometry.attributes.position;
    const owners = new Int32Array(Math.floor(index.count / 6)).fill(-1);
    for (let card = 0; card < owners.length; card++) {
      p.set(0, 0, 0);
      for (let k = card * 6; k < card * 6 + 6; k++) p.add(local.fromBufferAttribute(position, index.getX(k)));
      p.multiplyScalar(1 / 6).applyMatrix4(mesh.matrixWorld);
      const [nearest, best] = nearestTrunk(p.x, p.z);
      if (nearest < 0 || best >= 25) continue;
      owners[card] = nearest;
      const crown = crowns.get(nearest) ?? {
        sum: new THREE.Vector3(),
        count: 0,
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
      };
      crown.sum.add(p);
      crown.count++;
      crown.min.min(p);
      crown.max.max(p);
      crowns.set(nearest, crown);
    }
    return owners;
  });
  const shapes = new Map<number, { center: THREE.Vector3; extent: THREE.Vector3 }>();
  for (const [tree, crown] of crowns) {
    const extent = crown.max.clone().sub(crown.min).multiplyScalar(0.5);
    extent.set(Math.max(extent.x, MIN_EXTENT), Math.max(extent.y, MIN_EXTENT), Math.max(extent.z, MIN_EXTENT));
    // The mean of the cards: the crowns are denser where the branches carry more of them.
    shapes.set(tree, { center: crown.sum.divideScalar(crown.count), extent });
  }
  const outward = new THREE.Vector3();
  const card = new THREE.Vector3();
  const toLocal = new THREE.Matrix3();
  const toWorld = new THREE.Matrix3();
  let rounded = 0;
  meshes.forEach((mesh, m) => {
    const { geometry } = mesh;
    const index = geometry.index!;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal as THREE.BufferAttribute;
    toWorld.getNormalMatrix(mesh.matrixWorld);
    toLocal.copy(toWorld).invert();
    const done = new Uint8Array(position.count);
    trees[m].forEach((tree, c) => {
      const shape = shapes.get(tree);
      for (let k = c * 6; k < c * 6 + 6; k++) {
        const vertex = index.getX(k);
        if (done[vertex]) continue;
        done[vertex] = 1;
        card.fromBufferAttribute(normal, vertex).applyMatrix3(toWorld).normalize();
        if (!shape) {
          // A card far from any trunk keeps its own normal, turned up (it is no longer turned to the viewer).
          if (card.y < 0) card.negate();
          card.applyMatrix3(toLocal).normalize();
          normal.setXYZ(vertex, card.x, card.y, card.z);
          continue;
        }
        const { center, extent } = shape;
        // The gradient of the crown's ellipsoid at the vertex.
        p.fromBufferAttribute(position, vertex).applyMatrix4(mesh.matrixWorld).sub(center);
        outward.set(p.x / extent.x ** 2, p.y / extent.y ** 2, p.z / extent.z ** 2);
        if (outward.lengthSq() < 1e-12) outward.set(0, 1, 0);
        outward.normalize();
        if (card.dot(outward) < 0) card.negate();
        card.multiplyScalar(1 - CROWN_NORMAL_WEIGHT).addScaledVector(outward, CROWN_NORMAL_WEIGHT);
        card.applyMatrix3(toLocal).normalize();
        normal.setXYZ(vertex, card.x, card.y, card.z);
      }
      if (shape) rounded++;
    });
    normal.needsUpdate = true;
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.defines = { ...material.defines, SUI_CROWN_NORMAL: '' };
    material.needsUpdate = true;
  });
  return rounded;
}
