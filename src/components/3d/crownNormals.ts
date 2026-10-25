import * as THREE from 'three';
import { trunkBases, trunkFinder, WOODLAND_CARD } from './evergreenWoodland';
import type { CrownFootprint } from './forestFloor';
import { LEAF_SHELL_LEVELS } from './leafCluster';

/** Share of a card's shading normal taken from its crown's rounded shape (the rest is the card's own). */
export const CROWN_NORMAL_WEIGHT = 0.9;
/**
 * Not in the source: the woodland leaves' summer color scale and roughness. The source's cards are
 * a dark green (linear green 0.065–0.157, under half the maple's) with a glossy roughness of 0.54;
 * without the light a canopy scatters through its leaves, the crowns read as dark specks under a
 * blue-grey sheen of the sky even on their sunlit tops. The spring and autumn colors are their own.
 */
export const WOODLAND_ALBEDO = 1.7;
export const WOODLAND_ROUGHNESS = 0.8;
/**
 * Not in the source: the share of the reflection probes' sky the woodland cards keep by day. A card in
 * a crown sees mostly other leaves along its mirror direction, but the probes hold the open sky there;
 * on the dark leaves that sky was most of their light and turned the sunlit crowns teal-grey (hue about
 * 145°, the leaves' own about 100°); taking all of it changed little more. Kept on the outer shell,
 * the crown tops stayed grey. At dusk and night the sheen stays: the darker silhouettes stood out more against
 * the sky while looking around (docs/3d-qa/crown-specular/).
 */
export const WOODLAND_SPECULAR = 0.25;
/** A card's ellipsoid radius where its crown's outer shell (`LEAF_SHELL_LEVELS`) starts and is outermost. */
const SHELL_FROM = 1.0;
const SHELL_TO = 1.45;
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

/**
 * Each tree's own leaf color, as a multiplier by its trunk's position: brightness 0.84–1.12 and a
 * shift between a warmer and a bluer green. Every crown of the woodland had the same green and read
 * as one flat wall; neighbors now differ a little, as trees of one kind do in age, light and health.
 */
export function crownTint(x: number, z: number): [number, number, number] {
  const hash = (seed: number) => {
    const v = Math.sin(Math.round(x * 10) * 12.9898 + Math.round(z * 10) * 78.233 + seed) * 43758.5453;
    return v - Math.floor(v);
  };
  const brightness = 0.84 + 0.28 * hash(1.7);
  const hue = hash(5.3);
  return [brightness * (1.08 + (0.9 - 1.08) * hue), brightness, brightness * (0.8 + (1.1 - 0.8) * hue)];
}

/**
 * The shade inside a crown, by the vertex's place in it (its ellipsoid radius `r`, 0 at the center,
 * and height `up`, −1 at the bottom to 1 at the top): the inner and lower leaves see less of the sky.
 * The baked probes hold the crowns as they were (scattered cards), so they do not darken the inside.
 */
export function crownShade(r: number, up: number) {
  const outer = Math.min(1, Math.max(0, (r - 0.25) / 0.7));
  const below = Math.min(1, Math.max(0, -up));
  return (0.7 + 0.3 * outer * outer * (3 - 2 * outer)) * (1 - 0.14 * below);
}

// SUI_CROWN_TINT multiplies the base color by the vertex attribute `suiCrownTint`. Not vertex colors:
// a material with vertexColors leaves the depth prepass and the shadow mask's cut-out copies
// (depthPrepass.ts cutoutOf), which made the woodland about a third slower to draw. The same define
// scales the probes' reflection on the cards (WOODLAND_SPECULAR).
const CROWN_SPECULAR = `#ifdef SUI_IRRADIANCE
	reflectedLight.indirectSpecular *= mix( ${WOODLAND_SPECULAR.toFixed(2)}, 1.0, suiIrradianceEvening );
#endif`;
const TINT_CHUNKS: [keyof typeof THREE.ShaderChunk, string][] = [
  ['color_pars_vertex', 'attribute vec3 suiCrownTint;\nvarying vec3 vSuiCrownTint;'],
  ['color_vertex', 'vSuiCrownTint = suiCrownTint;'],
  ['color_pars_fragment', 'varying vec3 vSuiCrownTint;'],
  ['color_fragment', 'diffuseColor.rgb *= vSuiCrownTint;'],
  // After the lights, with the ambient occlusion: only the probes' reflection (the sun has no gloss),
  // by day only (the evening weight, irradiance.ts).
  ['aomap_fragment', CROWN_SPECULAR],
];
for (const [chunk, code] of TINT_CHUNKS)
  if (!THREE.ShaderChunk[chunk].includes('SUI_CROWN_TINT'))
    THREE.ShaderChunk[chunk] += `\n#ifdef SUI_CROWN_TINT\n\t${code}\n#endif\n`;
// The same daytime cut of the probes' reflection without the tint (the garden maples, mapleLeafTilt.ts).
if (!THREE.ShaderChunk.aomap_fragment.includes('SUI_CROWN_SPECULAR'))
  THREE.ShaderChunk.aomap_fragment += `\n#if defined( SUI_CROWN_SPECULAR ) && ! defined( SUI_CROWN_TINT )\n\t${CROWN_SPECULAR}\n#endif\n`;

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
 * leafy mass shades. The cards' `suiCrownTint` attribute carries each tree's tint (`crownTint`) and the shade
 * inside its crown (`crownShade`). Call before splitEvergreenWoodland (which copies the define to its
 * clones) and the model preparation. Returns the number of cards rounded; `footprints` receives each
 * crown's place across the ground (forestFloor.ts).
 */
export function roundWoodlandCrowns(root: THREE.Object3D, footprints?: CrownFootprint[]) {
  root.updateMatrixWorld(true);
  const bases = trunkBases(root);
  const nearestTrunk = trunkFinder(bases);
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
    const center = crown.sum.divideScalar(crown.count);
    shapes.set(tree, { center, extent });
    footprints?.push({ x: center.x, z: center.z, rx: extent.x, rz: extent.z });
  }
  const outward = new THREE.Vector3();
  const card = new THREE.Vector3();
  const toLocal = new THREE.Matrix3();
  const toWorld = new THREE.Matrix3();
  let rounded = 0;
  const shells = new Array<number>(LEAF_SHELL_LEVELS + 1).fill(0);
  meshes.forEach((mesh, m) => {
    const { geometry } = mesh;
    const index = geometry.index!;
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal as THREE.BufferAttribute;
    const uv = geometry.attributes.uv as THREE.BufferAttribute | undefined;
    const color = new THREE.BufferAttribute(new Float32Array(position.count * 3).fill(1), 3);
    toWorld.getNormalMatrix(mesh.matrixWorld);
    toLocal.copy(toWorld).invert();
    const done = new Uint8Array(position.count);
    trees[m].forEach((tree, c) => {
      const shape = shapes.get(tree);
      if (shape && uv) {
        // The card's level in the outer shell, in its UVs' integer part (leafCluster.ts).
        p.set(0, 0, 0);
        for (let k = c * 6; k < c * 6 + 6; k++) p.add(local.fromBufferAttribute(position, index.getX(k)));
        p.multiplyScalar(1 / 6)
          .applyMatrix4(mesh.matrixWorld)
          .sub(shape.center);
        const r = Math.hypot(p.x / shape.extent.x, p.y / shape.extent.y, p.z / shape.extent.z);
        const level = Math.round(
          THREE.MathUtils.clamp((r - SHELL_FROM) / (SHELL_TO - SHELL_FROM), 0, 1) * LEAF_SHELL_LEVELS,
        );
        const shifted = new Set<number>();
        for (let k = c * 6; k < c * 6 + 6; k++) shifted.add(index.getX(k));
        for (const vertex of shifted) uv.setX(vertex, uv.getX(vertex) + 2 * level);
        shells[level]++;
      }
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
        const [r, g, b] = crownTint(bases[tree].x, bases[tree].y);
        const shade = crownShade(Math.hypot(p.x / extent.x, p.y / extent.y, p.z / extent.z), p.y / extent.y);
        color.setXYZ(vertex, r * shade, g * shade, b * shade);
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
    if (uv) uv.needsUpdate = true;
    geometry.setAttribute('suiCrownTint', color);
    const material = mesh.material as THREE.MeshStandardMaterial;
    // Before the evergreens copy it and the seasons keep it as the summer color.
    material.color.multiplyScalar(WOODLAND_ALBEDO);
    material.roughness = WOODLAND_ROUGHNESS;
    material.defines = { ...material.defines, SUI_CROWN_NORMAL: '', SUI_CROWN_TINT: '' };
    material.needsUpdate = true;
  });
  return rounded;
}
