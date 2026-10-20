import * as THREE from 'three';

// Half widths (relative to the widest) at fractions of the length from the stalk to the
// tip: an ovate leaf, widest a little below the middle, with a pointed tip.
const STATIONS = [
  [0.16, 0.62],
  [0.38, 1],
  [0.62, 0.86],
  [0.84, 0.48],
] as const;
// The outline's area over (length × widest half width), from the trapezoids between stations.
const OUTLINE_AREA = STATIONS.reduce(
  (sum, [t, w], i) => {
    const [pt, pw] = i ? STATIONS[i - 1] : [0, 0];
    return sum + (t - pt) * (w + pw);
  },
  (1 - STATIONS[STATIONS.length - 1][0]) * STATIONS[STATIONS.length - 1][1],
);
/** Vertices and triangles of one shaped leaf. */
export const CANOPY_LEAF_VERTICES = 2 + 3 * STATIONS.length;
export const CANOPY_LEAF_TRIANGLES = 4 * STATIONS.length;

const fraction = (value: number) => value - Math.floor(value);

/** Replace each exported overhead canopy diamond (two triangles around its long diagonal)
 * with an ovate leaf folded along the midrib. The diagonal's midpoint and the leaf's plane
 * stay; length, width, in-plane angle and stalk end vary per leaf from its position, with
 * the mean area kept, so the canopy no longer reads as rows of equal diamonds. Shared or
 * unsupported topology is left alone. Run once before shadow setup.
 */
export function shapeCanopyLeaves(geometry: THREE.BufferGeometry) {
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
  const uses = new Uint8Array(source.count);
  const leaves: { vein: number[]; sides: number[]; face: number[] }[] = [];
  for (let i = 0; i < index.count; i += 6) {
    const first = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const second = [index.getX(i + 3), index.getX(i + 4), index.getX(i + 5)];
    const vertices = [...new Set([...first, ...second])];
    const vein = first.filter((v) => second.includes(v));
    if (vertices.length !== 4 || vein.length !== 2 || vertices.some((v) => uses[v])) return;
    vertices.forEach((v) => (uses[v] = 1));
    leaves.push({ vein, sides: vertices.filter((v) => !vein.includes(v)), face: first });
  }
  const positions = new Float32Array(leaves.length * CANOPY_LEAF_VERTICES * 3);
  const indices = new (leaves.length * CANOPY_LEAF_VERTICES > 65535 ? Uint32Array : Uint16Array)(
    leaves.length * CANOPY_LEAF_TRIANGLES * 3,
  );
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    side = new THREE.Vector3(),
    center = new THREE.Vector3();
  const axis = new THREE.Vector3(),
    across = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    up = new THREE.Vector3(),
    point = new THREE.Vector3();
  let vertex = 0,
    corner = 0;
  for (const { vein, sides, face } of leaves) {
    a.fromBufferAttribute(source, vein[0]);
    b.fromBufferAttribute(source, vein[1]);
    center.addVectors(a, b).multiplyScalar(0.5);
    axis.subVectors(b, a);
    const length = axis.length();
    axis.divideScalar(length);
    // Keep the source winding: the first triangle's face normal.
    point.fromBufferAttribute(source, face[0]);
    side.fromBufferAttribute(source, face[1]).sub(point);
    normal.fromBufferAttribute(source, face[2]).sub(point);
    normal.crossVectors(side, normal).normalize();
    across.crossVectors(normal, axis);
    let halfWidth = 0;
    for (const v of sides) halfWidth += Math.abs(side.fromBufferAttribute(source, v).sub(center).dot(across)) / 2;
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
    // The diamond covers length × halfWidth; the outline covers leafLength × widest × OUTLINE_AREA.
    const widest = (halfWidth * scale * Math.sqrt(aspect)) / OUTLINE_AREA;
    // Up projected perpendicular to the midrib; leaves facing sideways keep a flat fold.
    up.set(0, 1, 0).addScaledVector(axis, -axis.y);
    if (up.lengthSq() > 1e-6) up.normalize();
    // A shallow fold: deeper ones shade the smooth midrib like a lit pod.
    const fold = 0.08 + 0.1 * random(4);
    const droop = 0.04 + 0.08 * random(5);
    const first = vertex;
    const put = (t: number, w: number) => {
      point
        .copy(center)
        .addScaledVector(axis, (t - 0.5) * leafLength)
        .addScaledVector(across, w * widest)
        .addScaledVector(up, -(Math.abs(w) * widest * fold + droop * leafLength * t * t));
      positions.set([point.x, point.y, point.z], 3 * vertex++);
    };
    // Stalk, midrib stations, tip, then the left and right edges.
    put(0, 0);
    for (const [t] of STATIONS) put(t, 0);
    put(1, 0);
    for (const sign of [1, -1]) for (const [t, w] of STATIONS) put(t, sign * w);
    const rib = (i: number) => first + i;
    const tip = first + STATIONS.length + 1;
    for (const [sign, edges] of [
      [1, first + STATIONS.length + 2],
      [-1, first + 2 * STATIONS.length + 2],
    ] as const) {
      const edge = (i: number) => edges + i;
      // Wind both halves like the source (axis × across = normal) before any flip.
      const triangle = (p: number, q: number, r: number) =>
        indices.set(sign > 0 ? [p, q, r] : [p, r, q], (corner += 3) - 3);
      triangle(rib(0), rib(1), edge(0));
      for (let i = 0; i < STATIONS.length - 1; i++) {
        triangle(rib(i + 1), rib(i + 2), edge(i));
        triangle(edge(i), rib(i + 2), edge(i + 1));
      }
      triangle(rib(STATIONS.length), tip, edge(STATIONS.length - 1));
    }
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.clearGroups();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.suiCanopyShaped = true;
}
