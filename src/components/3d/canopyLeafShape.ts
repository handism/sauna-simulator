import * as THREE from 'three';

/** Half widths (relative to the widest) at fractions of the length from the stalk to the
 * tip. With a midrib, each station also holds a vein vertex the leaf folds along. */
export interface LeafOutline {
  stations: readonly (readonly [number, number])[];
  midrib: boolean;
}

/** The overhead canopy's leaves: ovate, widest a little below the middle, with a pointed
 * tip, folded along the midrib (14 vertices, 16 triangles). */
export const OVATE_LEAF: LeafOutline = {
  stations: [
    [0.16, 0.62],
    [0.38, 1],
    [0.62, 0.86],
    [0.84, 0.48],
  ],
  midrib: true,
};
/** The garden's small canopy leaves (6–14 cm, seen from metres away): the same ovate
 * outline with two stations and no fold (6 vertices, 4 triangles). */
export const SMALL_LEAF: LeafOutline = {
  stations: [
    [0.3, 1],
    [0.64, 0.72],
  ],
  midrib: false,
};

export const leafVertices = ({ stations, midrib }: LeafOutline) => 2 + (midrib ? 3 : 2) * stations.length;
export const leafTriangles = ({ stations, midrib }: LeafOutline) => (midrib ? 4 : 2) * stations.length;
/** Vertices and triangles of one shaped overhead canopy leaf. */
export const CANOPY_LEAF_VERTICES = leafVertices(OVATE_LEAF);
export const CANOPY_LEAF_TRIANGLES = leafTriangles(OVATE_LEAF);

// The outline's area over (length × widest half width), from the trapezoids between stations.
const outlineArea = ({ stations }: LeafOutline) =>
  stations.reduce(
    (sum, [t, w], i) => {
      const [pt, pw] = i ? stations[i - 1] : [0, 0];
      return sum + (t - pt) * (w + pw);
    },
    (1 - stations[stations.length - 1][0]) * stations[stations.length - 1][1],
  );

const fraction = (value: number) => value - Math.floor(value);

/** One leaf's points (length fraction, signed half width) and triangles: stalk, midrib
 * stations, tip, then the left (+across) and right edges, wound like the source
 * (axis × across = normal). */
function leafTemplate({ stations, midrib }: LeafOutline) {
  const n = stations.length;
  const points: [number, number][] = [[0, 0]];
  if (midrib) for (const [t] of stations) points.push([t, 0]);
  points.push([1, 0]);
  for (const sign of [1, -1]) for (const [t, w] of stations) points.push([t, sign * w]);
  const tip = midrib ? n + 1 : 1;
  const left = (i: number) => tip + 1 + i;
  const right = (i: number) => tip + 1 + n + i;
  const indices: number[] = [];
  if (midrib) {
    for (const [sign, edge] of [
      [1, left],
      [-1, right],
    ] as const) {
      const half = (p: number, q: number, r: number) => indices.push(...(sign > 0 ? [p, q, r] : [p, r, q]));
      half(0, 1, edge(0));
      for (let i = 0; i < n - 1; i++) {
        half(i + 1, i + 2, edge(i));
        half(edge(i), i + 2, edge(i + 1));
      }
      half(n, tip, edge(n - 1));
    }
  } else {
    indices.push(0, right(0), left(0));
    for (let i = 0; i < n - 1; i++) indices.push(left(i), right(i), right(i + 1), left(i), right(i + 1), left(i + 1));
    indices.push(right(n - 1), tip, left(n - 1));
  }
  return { points: points.flat(), indices };
}

/** Area-weighted vertex normals, as BufferGeometry.computeVertexNormals on plain arrays. */
function vertexNormals(positions: Float32Array, indices: ArrayLike<number>) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const p = 3 * indices[i],
      q = 3 * indices[i + 1],
      r = 3 * indices[i + 2];
    const ux = positions[r] - positions[q],
      uy = positions[r + 1] - positions[q + 1],
      uz = positions[r + 2] - positions[q + 2];
    const vx = positions[p] - positions[q],
      vy = positions[p + 1] - positions[q + 1],
      vz = positions[p + 2] - positions[q + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    for (let k = 0; k < 3; k++) {
      const v = 3 * indices[i + k];
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]) || 1;
    normals[v] /= length;
    normals[v + 1] /= length;
    normals[v + 2] /= length;
  }
  return normals;
}

/** Replace each exported canopy diamond (two triangles around its long diagonal) with a
 * leaf of the given outline. The diagonal's midpoint and the leaf's plane stay; length,
 * width, in-plane angle and stalk end vary per leaf from its position, with the mean area
 * kept, so the canopy no longer reads as rows of equal diamonds. Shared or unsupported
 * topology is left alone. Run once before shadow setup.
 */
export function shapeCanopyLeaves(geometry: THREE.BufferGeometry, outline: LeafOutline = OVATE_LEAF) {
  if (geometry.userData.suiCanopyShaped) return;
  const source = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (
    !source ||
    !index ||
    index.count % 6 !== 0 ||
    Object.keys(geometry.attributes).some((name) => name !== 'position' && name !== 'normal') ||
    Object.keys(geometry.morphAttributes).length
  )
    return;
  const { midrib } = outline;
  const count = index.count / 6;
  // Per leaf: the two vein ends, the two side corners, then the first triangle's corners.
  const corners = new Uint32Array(count * 7);
  const uses = new Uint8Array(source.count);
  const ids = index.array;
  for (let leaf = 0, i = 0; leaf < count; leaf++, i += 6) {
    const p = ids[i],
      q = ids[i + 1],
      r = ids[i + 2];
    const inSecond = (v: number) => v === ids[i + 3] || v === ids[i + 4] || v === ids[i + 5];
    // The first triangle's corner missing from the second is one side; the vein keeps its order.
    const s0 = inSecond(p) ? (inSecond(q) ? r : q) : p;
    const v0 = s0 === p ? q : p,
      v1 = s0 === r ? q : r;
    if (!inSecond(v0) || !inSecond(v1) || inSecond(s0)) return;
    const s1 = ids[i + 3] + ids[i + 4] + ids[i + 5] - v0 - v1;
    const c = leaf * 7;
    corners[c] = v0;
    corners[c + 1] = v1;
    corners[c + 2] = s0;
    corners[c + 3] = s1;
    corners[c + 4] = p;
    corners[c + 5] = q;
    corners[c + 6] = r;
    for (let k = c; k < c + 4; k++) {
      if (uses[corners[k]]) return;
      uses[corners[k]] = 1;
    }
  }
  const perLeaf = leafVertices(outline);
  const positions = new Float32Array(count * perLeaf * 3);
  const indices = new (count * perLeaf > 65535 ? Uint32Array : Uint16Array)(count * leafTriangles(outline) * 3);
  const area = outlineArea(outline);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    side = new THREE.Vector3(),
    center = new THREE.Vector3();
  const axis = new THREE.Vector3(),
    across = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    up = new THREE.Vector3(),
    point = new THREE.Vector3();
  const template = leafTemplate(outline);
  let vertex = 0;
  for (let leaf = 0; leaf < count; leaf++) {
    const at = (k: number) => corners[leaf * 7 + k];
    a.fromBufferAttribute(source, at(0));
    b.fromBufferAttribute(source, at(1));
    center.addVectors(a, b).multiplyScalar(0.5);
    axis.subVectors(b, a);
    const length = axis.length();
    axis.divideScalar(length);
    // Keep the source winding: the first triangle's face normal.
    point.fromBufferAttribute(source, at(4));
    side.fromBufferAttribute(source, at(5)).sub(point);
    normal.fromBufferAttribute(source, at(6)).sub(point);
    normal.crossVectors(side, normal).normalize();
    across.crossVectors(normal, axis);
    let halfWidth = 0;
    for (const k of [2, 3]) halfWidth += Math.abs(side.fromBufferAttribute(source, at(k)).sub(center).dot(across)) / 2;
    const seed = Math.sin(center.x * 12.9898 + center.y * 78.233 + center.z * 37.719) * 43758.5453;
    const random = (k: number) => fraction(seed * (k + 1) * 1.618034);
    // Area scale uniform in [0.36, 1.64] (length scale 0.6–1.28) averages the source area.
    const scale = Math.sqrt(0.36 + 1.28 * random(0));
    const aspect = 0.85 + 0.35 * random(1);
    const turn = (random(2) - 0.5) * 1;
    axis.applyAxisAngle(normal, turn);
    across.crossVectors(normal, axis);
    // Either diagonal end may hold the stalk.
    if (random(3) < 0.5) {
      axis.negate();
      across.negate();
    }
    const leafLength = (length * scale) / Math.sqrt(aspect);
    // The diamond covers length × halfWidth; the outline covers leafLength × widest × area.
    const widest = (halfWidth * scale * Math.sqrt(aspect)) / area;
    // Up projected perpendicular to the midrib; leaves facing sideways keep a flat fold.
    up.set(0, 1, 0).addScaledVector(axis, -axis.y);
    if (up.lengthSq() > 1e-6) up.normalize();
    // A shallow fold: deeper ones shade the smooth midrib like a lit pod.
    const fold = midrib ? 0.08 + 0.1 * random(4) : 0;
    const droop = 0.04 + 0.08 * random(5);
    const base = vertex;
    for (let k = 0; k < template.points.length; k += 2) {
      const t = template.points[k],
        w = template.points[k + 1];
      point
        .copy(center)
        .addScaledVector(axis, (t - 0.5) * leafLength)
        .addScaledVector(across, w * widest)
        .addScaledVector(up, -(Math.abs(w) * widest * fold + droop * leafLength * t * t));
      positions[3 * vertex] = point.x;
      positions[3 * vertex + 1] = point.y;
      positions[3 * vertex++ + 2] = point.z;
    }
    const offset = leaf * template.indices.length;
    for (let i = 0; i < template.indices.length; i++) indices[offset + i] = base + template.indices[i];
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(vertexNormals(positions, indices), 3));
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.suiCanopyShaped = true;
}
