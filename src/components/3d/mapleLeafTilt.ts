import * as THREE from 'three';
// The crowns' shader chunks (SUI_CROWN_SPECULAR), registered on import.
import './crownNormals';

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

/** Share of a maple leaf's shading normal taken from its crown's rounded shape. */
export const MAPLE_CROWN_NORMAL_WEIGHT = 0.6;
/** Leaves whose centers are this close (m) belong to one crown. */
const MAPLE_CROWN_LINK = 0.9;
/** Least half extent of a maple crown (m), and the fewest leaves that make one. */
const MAPLE_MIN_EXTENT = 0.4;
const MAPLE_MIN_LEAVES = 12;

/**
 * Not in the source: the maples' leaves, lit each by its own folded lobes facing every way, read as a
 * hard speckle of bright yellow-green and dark leaves (a sprite more than a crown). As the woodland's
 * cards (crownNormals.ts), each leaf's normals lean outward from its crown's ellipsoid by
 * MAPLE_CROWN_NORMAL_WEIGHT, less than the cards' so the lobes still show; the crowns are the
 * leaves grouped by their centers. The materials take SUI_CROWN_NORMAL (normals as written, not
 * turned to the viewer); a leaf in no crown keeps its own normal turned up. Run after
 * tiltMapleLeaves, once per geometry. Returns the number of leaves rounded.
 */
export function roundMapleCrowns(mesh: THREE.Mesh) {
  const { geometry } = mesh;
  if (geometry.userData.suiMapleRounded !== undefined) return geometry.userData.suiMapleRounded as number;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const index = geometry.getIndex();
  geometry.userData.suiMapleRounded = 0;
  if (!position || !normal || !index) return 0;
  mesh.updateWorldMatrix(true, false);
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
  const leafOf = new Map<number, number>();
  const members: number[][] = [];
  for (let v = 0; v < position.count; v++) {
    const root = find(v);
    let leaf = leafOf.get(root);
    if (leaf === undefined) {
      leafOf.set(root, (leaf = members.length));
      members.push([]);
    }
    members[leaf].push(v);
  }
  const point = new THREE.Vector3();
  const centers = members.map((vertices) => {
    const center = new THREE.Vector3();
    for (const v of vertices) center.add(point.fromBufferAttribute(position, v));
    return center.divideScalar(vertices.length).applyMatrix4(mesh.matrixWorld);
  });
  // Crowns: leaves linked through neighbors closer than MAPLE_CROWN_LINK, found on a grid.
  const crownParent = Int32Array.from({ length: centers.length }, (_, i) => i);
  const findCrown = (l: number): number => {
    while (crownParent[l] !== l) l = crownParent[l] = crownParent[crownParent[l]];
    return l;
  };
  const cell = (c: THREE.Vector3) => [c.x, c.y, c.z].map((x) => Math.floor(x / MAPLE_CROWN_LINK));
  const grid = new Map<string, number[]>();
  centers.forEach((c, l) => {
    const key = cell(c).join();
    const list = grid.get(key);
    if (list) list.push(l);
    else grid.set(key, [l]);
  });
  centers.forEach((c, l) => {
    const [x, y, z] = cell(c);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const other of grid.get(`${x + dx},${y + dy},${z + dz}`) ?? [])
            if (other > l && c.distanceToSquared(centers[other]) < MAPLE_CROWN_LINK ** 2)
              crownParent[findCrown(other)] = findCrown(l);
  });
  const crowns = new Map<number, { leaves: number[]; min: THREE.Vector3; max: THREE.Vector3; sum: THREE.Vector3 }>();
  centers.forEach((c, l) => {
    const root = findCrown(l);
    let crown = crowns.get(root);
    if (!crown)
      crowns.set(
        root,
        (crown = {
          leaves: [],
          min: new THREE.Vector3(Infinity, Infinity, Infinity),
          max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
          sum: new THREE.Vector3(),
        }),
      );
    crown.leaves.push(l);
    crown.min.min(c);
    crown.max.max(c);
    crown.sum.add(c);
  });
  const toWorld = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const toLocal = toWorld.clone().invert();
  const own = new THREE.Vector3();
  const outward = new THREE.Vector3();
  let rounded = 0;
  for (const crown of crowns.values()) {
    const shaped = crown.leaves.length >= MAPLE_MIN_LEAVES;
    const center = crown.sum.divideScalar(crown.leaves.length);
    const extent = crown.max
      .clone()
      .sub(crown.min)
      .multiplyScalar(0.5)
      .max(new THREE.Vector3().setScalar(MAPLE_MIN_EXTENT));
    for (const l of crown.leaves) {
      for (const v of members[l]) {
        own.fromBufferAttribute(normal, v).applyMatrix3(toWorld).normalize();
        if (shaped) {
          point.fromBufferAttribute(position, v).applyMatrix4(mesh.matrixWorld).sub(center);
          outward.set(point.x / extent.x ** 2, point.y / extent.y ** 2, point.z / extent.z ** 2);
          if (outward.lengthSq() < 1e-12) outward.set(0, 1, 0);
          outward.normalize();
          if (own.dot(outward) < 0) own.negate();
          own.multiplyScalar(1 - MAPLE_CROWN_NORMAL_WEIGHT).addScaledVector(outward, MAPLE_CROWN_NORMAL_WEIGHT);
        } else if (own.y < 0) own.negate();
        own.applyMatrix3(toLocal).normalize();
        normal.setXYZ(v, own.x, own.y, own.z);
      }
      if (shaped) rounded++;
    }
  }
  normal.needsUpdate = true;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    // By day the leaves' gloss caught the probes' open sky and the sunlit tops of the crowns read
    // cream (crownNormals.ts WOODLAND_SPECULAR, as for the woodland's cards).
    material.defines = { ...material.defines, SUI_CROWN_NORMAL: '', SUI_CROWN_SPECULAR: '' };
    material.needsUpdate = true;
  }
  geometry.userData.suiMapleRounded = rounded;
  return rounded;
}
