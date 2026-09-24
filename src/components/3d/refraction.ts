import * as THREE from 'three';
import { WATER_BOX } from './interiorLights';

// The plunge seen through its flat surface. Cycles refracts the camera rays at the water (IOR
// 1.333), so the tub looks shallow and its inner walls nearly vanish; the browser surface is a
// blended layer that does not bend the view. Here each vertex under the water is drawn at its
// image instead: the ray from the camera meets the surface at P where Snell's law holds, and
// the point is seen along the camera ray through P. Placing the image on the vertical through
// the point puts it at the apparent depth b' = b·cosθ1 / (n·cosθ2) below the surface (b is the
// true depth, θ1 and θ2 the angles above and below the surface), which is b/n straight down and
// thins toward grazing views. Only gl_Position moves: lighting, probes and shadows keep the true
// position (the shadow passes use their own depth materials). Ripples and the rippled source
// surface are left out.
//
// The view through the water is tinted as in the source: once by the transmission color of the
// surface (its Base Color, transmission 1) and by the volume absorption (color (0.57, 0.84, 0.78),
// density 0.12: Cycles absorbs density·(1 − color) per meter) along the refracted path under the
// water, which the vertex stage passes on.
//
// The image is not linear in the position, so triangles in the water with long edges (the tub
// walls reach from the floor to the coping in one triangle) are cut at the surface and on a grid
// of axis-aligned planes. Planes cut shared edges at the same points on both sides, so the moved
// meshes stay closed. The individual tiles are already small and are left as they are.

export const WATER_IOR = 1.333;
/** Spacing of the cutting planes, in meters. */
export const SLICE_SPACING = 0.1;
/** Meshes with an underwater edge longer than this are cut. */
const LONG_EDGE = 0.3;

/** Apparent depth below a flat surface of a point `depth` under it, seen from `height` above it at `distance` horizontally. */
export function apparentDepth(height: number, depth: number, distance: number, ior = WATER_IOR) {
  if (distance < 1e-6) return depth / ior;
  // Horizontal offset x of the surface point: x/√(x²+a²) = n·(D−x)/√((D−x)²+b²), increasing in x.
  let lo = 0;
  let hi = distance;
  for (let i = 0; i < 24; i++) {
    const x = (lo + hi) / 2;
    const rest = distance - x;
    if (x / Math.hypot(x, height) < (ior * rest) / Math.hypot(rest, depth)) lo = x;
    else hi = x;
  }
  const x = (lo + hi) / 2;
  const cos1 = height / Math.hypot(x, height);
  const sin2 = x / Math.hypot(x, height) / ior;
  return (depth * cos1) / (ior * Math.sqrt(1 - sin2 * sin2));
}

/** The water surface's transmission color and the volume absorption per meter (Cycles). */
export const WATER_TINT = [0.93, 0.985, 0.975] as const;
export const WATER_ABSORPTION = [0.57, 0.84, 0.78].map((c) => 0.12 * (1 - c));

/** Linear transmittance of the view through the surface and `path` meters of water. */
export const waterTransmittance = (path: number) =>
  WATER_TINT.map((tint, i) => tint * Math.exp(-WATER_ABSORPTION[i] * path));

const vec2 = (v: THREE.Vector3) => `vec2( ${v.x.toFixed(4)}, ${v.z.toFixed(4)} )`;

// Same bisection as apparentDepth (16 steps: under 0.1 mm across the plunge).
const refraction = (level: string) => /* glsl */ `
#ifdef SUI_REFRACTION
vSuiWaterPath = 0.0;
{
	vec3 suiWorld = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
	float suiHeight = cameraPosition.y - ${level};
	float suiDepth = ${level} - suiWorld.y;
	if ( suiHeight > 0.0 && suiDepth > 0.0 && suiWorld.y >= ${WATER_BOX.min.y.toFixed(4)} && all( greaterThanEqual( suiWorld.xz, ${vec2(WATER_BOX.min)} ) ) && all( lessThanEqual( suiWorld.xz, ${vec2(WATER_BOX.max)} ) ) ) {
		float suiDistance = length( suiWorld.xz - cameraPosition.xz );
		float suiLo = 0.0;
		float suiHi = suiDistance;
		for ( int i = 0; i < 16; i ++ ) {
			float x = 0.5 * ( suiLo + suiHi );
			float rest = suiDistance - x;
			if ( x * length( vec2( rest, suiDepth ) ) < ${WATER_IOR} * rest * length( vec2( x, suiHeight ) ) ) suiLo = x;
			else suiHi = x;
		}
		float x = 0.5 * ( suiLo + suiHi );
		float suiCos1 = suiHeight / length( vec2( x, suiHeight ) );
		float suiSin2 = x / length( vec2( x, suiHeight ) ) / ${WATER_IOR};
		float suiCos2 = sqrt( 1.0 - suiSin2 * suiSin2 );
		float suiApparent = suiDepth * suiCos1 / ( ${WATER_IOR} * suiCos2 );
		vSuiWaterPath = suiDepth / suiCos2;
		gl_Position = projectionMatrix * ( mvPosition + viewMatrix * vec4( 0.0, suiDepth - suiApparent, 0.0, 0.0 ) );
	}
}
#endif
`;

const glslVec3 = (v: readonly number[]) => `vec3( ${v.map((c) => c.toFixed(5)).join(', ')} )`;
// suiWorldPosition is the fragment's true position (interiorLights.ts, lights_fragment_begin).
const tint = (level: string) => /* glsl */ `
#ifdef SUI_REFRACTION
if ( cameraPosition.y > ${level} && suiWorldPosition.y < ${level} && suiWorldPosition.y >= ${WATER_BOX.min.y.toFixed(4)} && all( greaterThanEqual( suiWorldPosition.xz, ${vec2(WATER_BOX.min)} ) ) && all( lessThanEqual( suiWorldPosition.xz, ${vec2(WATER_BOX.max)} ) ) )
	gl_FragColor.rgb *= ${glslVec3(WATER_TINT)} * exp( - ${glslVec3(WATER_ABSORPTION)} * vSuiWaterPath );
#endif
`;

// Polygon corners as barycentric weights of the source triangle.
type Polygon = THREE.Vector3[];

function split(polygon: Polygon, corners: THREE.Vector3[], axis: 'x' | 'y' | 'z', plane: number): Polygon[] {
  const side = polygon.map((w) => corners[0][axis] * w.x + corners[1][axis] * w.y + corners[2][axis] * w.z - plane);
  if (side.every((s) => s >= -1e-7) || side.every((s) => s <= 1e-7)) return [polygon];
  const below: Polygon = [];
  const above: Polygon = [];
  polygon.forEach((w, i) => {
    const j = (i + 1) % polygon.length;
    if (side[i] <= 0) below.push(w);
    if (side[i] >= 0) above.push(w);
    if ((side[i] < 0 && side[j] > 0) || (side[i] > 0 && side[j] < 0)) {
      const cut = w.clone().lerp(polygon[j], side[i] / (side[i] - side[j]));
      below.push(cut);
      above.push(cut.clone());
    }
  });
  return [below, above].filter((p) => p.length >= 3);
}

/**
 * Cuts the triangles of `geometry` (world transform `matrix`) that reach under the water at the
 * surface and on the slicing grid. Returns the number of triangles added and the material indices
 * (0 without groups) that have triangles under the water.
 */
export function sliceUnderwater(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, level: number) {
  const wet = new Set<number>();
  const position = geometry.getAttribute('position');
  if (!position || Object.keys(geometry.morphAttributes).length) return { triangles: 0, materials: wet };
  const index = geometry.index ? Array.from(geometry.index.array) : [...Array(position.count).keys()];
  const world = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix),
  );
  const region = new THREE.Box3(WATER_BOX.min, new THREE.Vector3(WATER_BOX.max.x, level, WATER_BOX.max.z));
  const triangle = new THREE.Box3();
  const inWater = (t: number) =>
    triangle.setFromPoints([world[index[t]], world[index[t + 1]], world[index[t + 2]]]).intersectsBox(region) &&
    triangle.min.y < level;
  const grouped = geometry.groups.length > 0;
  const groups = grouped ? geometry.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
  let long = false;
  for (const group of groups)
    for (let t = group.start; t < Math.min(group.start + group.count, index.length); t += 3)
      if (inWater(t)) {
        wet.add(group.materialIndex ?? 0);
        for (let e = 0; e < 3; e++)
          if (world[index[t + e]].distanceTo(world[index[t + ((e + 1) % 3)]]) > LONG_EDGE) long = true;
      }
  if (!long) return { triangles: 0, materials: wet };

  const names = Object.keys(geometry.attributes);
  const values = names.map((name) => {
    const attribute = geometry.getAttribute(name);
    const list: number[] = [];
    for (let i = 0; i < attribute.count; i++)
      for (let c = 0; c < attribute.itemSize; c++) list.push(attribute.getComponent(i, c));
    return list;
  });
  let count = position.count;
  const add = (corners: number[], w: THREE.Vector3) => {
    names.forEach((name, a) => {
      const size = geometry.getAttribute(name).itemSize;
      const item = Array.from({ length: size }, (_, c) =>
        name === 'tangent' && c === 3
          ? values[a][corners[0] * size + c]
          : w.x * values[a][corners[0] * size + c] +
            w.y * values[a][corners[1] * size + c] +
            w.z * values[a][corners[2] * size + c],
      );
      if (name === 'normal' || name === 'tangent') {
        const length = Math.hypot(item[0], item[1], item[2]) || 1;
        for (let c = 0; c < 3; c++) item[c] /= length;
      }
      values[a].push(...item);
    });
    return count++;
  };

  const next: number[] = [];
  const nextGroups: typeof geometry.groups = [];
  let added = 0;
  for (const group of groups) {
    const start = next.length;
    for (let t = group.start; t < Math.min(group.start + group.count, index.length); t += 3) {
      const source = [index[t], index[t + 1], index[t + 2]];
      if (!inWater(t)) {
        next.push(...source);
        continue;
      }
      const corners = source.map((i) => world[i]);
      let pieces: Polygon[] = [[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]];
      pieces = pieces.flatMap((p) => split(p, corners, 'y', level));
      const cut = (axis: 'x' | 'y' | 'z', from: number, to: number) => {
        for (let k = Math.ceil(from / SLICE_SPACING); k * SLICE_SPACING < to; k++)
          pieces = pieces.flatMap((p) => split(p, corners, axis, k * SLICE_SPACING));
      };
      const lo = triangle.setFromPoints(corners).min.clone().max(region.min);
      const hi = triangle.max.clone().min(region.max);
      // Only the part under the surface is cut on the grid.
      const under = pieces.filter((p) =>
        p.every((w) => corners[0].y * w.x + corners[1].y * w.y + corners[2].y * w.z <= level + 1e-7),
      );
      const over = pieces.filter((p) => !under.includes(p));
      pieces = under;
      cut('x', lo.x, hi.x);
      cut('y', lo.y, hi.y);
      cut('z', lo.z, hi.z);
      pieces.push(...over);
      if (pieces.length === 1 && pieces[0].length === 3) {
        next.push(...source);
        continue;
      }
      for (const piece of pieces) {
        const ids = piece.map((w) => {
          const corner = [w.x, w.y, w.z].findIndex((v) => v > 1 - 1e-9);
          return corner >= 0 ? source[corner] : add(source, w);
        });
        for (let i = 1; i + 1 < ids.length; i++) next.push(ids[0], ids[i], ids[i + 1]);
        added += ids.length - 2;
      }
      added -= 1;
    }
    nextGroups.push({ start, count: next.length - start, materialIndex: group.materialIndex });
  }

  names.forEach((name, a) => {
    const old = geometry.getAttribute(name) as THREE.BufferAttribute;
    const Typed = old.array.constructor as Float32ArrayConstructor;
    const attribute = new THREE.BufferAttribute(new Typed(count * old.itemSize), old.itemSize, old.normalized);
    for (let i = 0; i < count; i++)
      for (let c = 0; c < old.itemSize; c++) attribute.setComponent(i, c, values[a][i * old.itemSize + c]);
    geometry.setAttribute(name, attribute);
  });
  geometry.setIndex(next);
  geometry.clearGroups();
  if (grouped) for (const g of nextGroups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { triangles: added, materials: wet };
}

/**
 * Draws the model's underwater surfaces at their refracted image below the water surface at
 * `level` (glTF y). Returns the materials drawn so and the triangles the cutting added.
 */
export function applyRefraction(root: THREE.Object3D, level: number) {
  const materials = new Set<THREE.MeshStandardMaterial>();
  const region = new THREE.Box3(WATER_BOX.min, new THREE.Vector3(WATER_BOX.max.x, level, WATER_BOX.max.z));
  const bounds = new THREE.Box3();
  let triangles = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!bounds.setFromObject(object).intersectsBox(region)) return;
    const cut = sliceUnderwater(object.geometry, object.matrixWorld, level);
    triangles += cut.triangles;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of [...cut.materials].map((i) => list[i]))
      if (material instanceof THREE.MeshStandardMaterial) {
        material.defines = { ...material.defines, SUI_REFRACTION: level.toFixed(4) };
        material.needsUpdate = true;
        materials.add(material);
      }
  });
  return { materials: materials.size, triangles };
}

// three 0.186 is pinned: project_vertex ends with gl_Position from mvPosition, opaque_fragment
// with gl_FragColor from the outgoing light, and interiorLights.ts has defined suiWorldPosition.
const PROJECT = 'gl_Position = projectionMatrix * mvPosition;';
const OPAQUE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
if (!THREE.ShaderChunk.project_vertex.includes('SUI_REFRACTION')) {
  if (
    !THREE.ShaderChunk.project_vertex.trimEnd().endsWith(PROJECT) ||
    !THREE.ShaderChunk.opaque_fragment.trimEnd().endsWith(OPAQUE) ||
    !THREE.ShaderChunk.lights_fragment_begin.includes('vec3 suiWorldPosition')
  )
    throw new Error('three shader chunks changed; update refraction.ts');
  const level = 'float( SUI_REFRACTION )';
  THREE.ShaderChunk.common += '\n#ifdef SUI_REFRACTION\nvarying float vSuiWaterPath;\n#endif\n';
  THREE.ShaderChunk.project_vertex += refraction(level);
  THREE.ShaderChunk.opaque_fragment += tint(level);
}
