import * as THREE from 'three';

// The garden's near maples (V11) keep the source's lobed leaves (11 vertices, 10 triangles, the
// lobes folded ~45° but the whole leaf exactly level). From the seated eye height they are seen
// edge-on, as thin dashes with the sky between them, which made the maples read as a lace of specks
// (most in autumn, where the leaves are bright). Each level leaf is turned about a horizontal axis
// through its centroid, in a direction and by an angle from its position. Other components (the
// small tilted quads) are kept.
export const MAPLE_TILT_MIN = 0.35;
export const MAPLE_TILT_MAX = 1.1;
const LEAF_VERTICES = 11;
const LEAF_TRIANGLES = 10;
/** A leaf counts as level when its area-weighted normal is within ~11° of vertical. */
const LEVEL = 0.98;

const hash = (x: number, y: number, z: number, salt: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + salt * 4.581) * 43758.5453;
  return s - Math.floor(s);
};

/** The turn for a leaf centered at `center`: about a level axis, by MAPLE_TILT_MIN..MAX radians. */
export function mapleLeafTurn(center: THREE.Vector3, target = new THREE.Quaternion()) {
  const azimuth = hash(center.x, center.y, center.z, 1) * 2 * Math.PI;
  const angle = MAPLE_TILT_MIN + hash(center.x, center.y, center.z, 2) * (MAPLE_TILT_MAX - MAPLE_TILT_MIN);
  return target.setFromAxisAngle(new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth)), angle);
}

/** Tilts the level lobed leaves in place; returns how many. Run once before shadow setup. */
export function tiltMapleLeaves(geometry: THREE.BufferGeometry) {
  if (geometry.userData.suiMapleTilted !== undefined) return geometry.userData.suiMapleTilted as number;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  if (!position || !index) return 0;
  // Connected components by shared vertices.
  const parent = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (v: number): number => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  for (let i = 0; i < index.count; i += 3) {
    const root = find(index.getX(i));
    parent[find(index.getX(i + 1))] = root;
    parent[find(index.getX(i + 2))] = root;
  }
  const triangles = new Map<number, number[]>();
  for (let i = 0; i < index.count; i += 3) {
    const root = find(index.getX(i));
    let list = triangles.get(root);
    if (!list) triangles.set(root, (list = []));
    list.push(i);
  }
  const vertices = new Map<number, number[]>();
  for (let v = 0; v < position.count; v++) {
    const root = find(v);
    let list = vertices.get(root);
    if (!list) vertices.set(root, (list = []));
    list.push(v);
  }
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    face = new THREE.Vector3(),
    area = new THREE.Vector3(),
    center = new THREE.Vector3(),
    point = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  let tilted = 0;
  for (const [root, leaf] of triangles) {
    const corners = vertices.get(root)!;
    if (leaf.length !== LEAF_TRIANGLES || corners.length !== LEAF_VERTICES) continue;
    // The lobes are folded (faces ~45° off level), so test the area-weighted normal of the whole leaf.
    area.set(0, 0, 0);
    for (const t of leaf) {
      a.fromBufferAttribute(position, index.getX(t));
      b.fromBufferAttribute(position, index.getX(t + 1));
      c.fromBufferAttribute(position, index.getX(t + 2));
      area.add(face.subVectors(b, a).cross(c.sub(a)));
    }
    const level = area.lengthSq() > 0 && Math.abs(area.normalize().y) > LEVEL;
    if (!level) continue;
    center.set(0, 0, 0);
    for (const v of corners) center.add(point.fromBufferAttribute(position, v));
    center.divideScalar(corners.length);
    mapleLeafTurn(center, turn);
    for (const v of corners) {
      point.fromBufferAttribute(position, v).sub(center).applyQuaternion(turn).add(center);
      position.setXYZ(v, point.x, point.y, point.z);
      if (normal) {
        point.fromBufferAttribute(normal, v).applyQuaternion(turn);
        normal.setXYZ(v, point.x, point.y, point.z);
      }
    }
    tilted++;
  }
  if (tilted) {
    position.needsUpdate = true;
    if (normal) normal.needsUpdate = true;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }
  geometry.userData.suiMapleTilted = tilted;
  return tilted;
}
