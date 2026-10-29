import * as THREE from 'three';

/** Share of the woodland trees that keep their leaves through autumn and winter. */
export const EVERGREEN_SHARE = 0.35;
/** Evergreen crowns are a deeper, cooler green than the deciduous summer tones. */
const EVERGREEN_TINT = new THREE.Color(0.58, 0.7, 0.6);
export const WOODLAND_CARD = /^V6 woodland leaf \d+ card$/;

/**
 * A choice by the trunk's position (to 10cm, so rounding in the base does not flip it) that survives
 * material batching and index reordering.
 */
export function isEvergreenTree(x: number, z: number) {
  let h = Math.imul(Math.round(x * 10), 0x9e3779b1) ^ Math.imul(Math.round(z * 10), 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296 < EVERGREEN_SHARE;
}

/** The base (mean of the lowest 0.3m) of every bark piece rising more than 2m from near the ground. */
export function trunkBases(root: THREE.Object3D) {
  const bases: THREE.Vector2[] = [];
  const p = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material) || !/tree bark/i.test(object.material.name))
      return;
    const position = object.geometry.attributes.position;
    const index = object.geometry.index;
    const parent = Int32Array.from({ length: position.count }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    // Each exported branch curve is one connected piece, so the index alone finds the trunks.
    const world = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++)
      p.fromBufferAttribute(position, i)
        .applyMatrix4(object.matrixWorld)
        .toArray(world, i * 3);
    const corners = index ? index.count : position.count;
    for (let t = 0; t < corners; t += 3) {
      const at = (k: number) => (index ? index.getX(t + k) : t + k);
      parent[find(at(1))] = find(at(0));
      parent[find(at(2))] = find(at(0));
    }
    const pieces = new Map<number, number[]>();
    for (let i = 0; i < position.count; i++) {
      const list = pieces.get(find(i)) ?? [];
      list.push(i);
      pieces.set(find(i), list);
    }
    for (const vertices of pieces.values()) {
      let low = Infinity;
      let high = -Infinity;
      for (const i of vertices) {
        low = Math.min(low, world[i * 3 + 1]);
        high = Math.max(high, world[i * 3 + 1]);
      }
      if (low > 0.6 || high - low < 2) continue;
      const base = new THREE.Vector2();
      let n = 0;
      for (const i of vertices)
        if (world[i * 3 + 1] < low + 0.3) {
          base.x += world[i * 3];
          base.y += world[i * 3 + 2];
          n++;
        }
      bases.push(base.divideScalar(n));
    }
  });
  return bases;
}

/**
 * The nearest of the trunk bases to a point on the ground and its squared distance, or -1 past 5m.
 * Trunks go in 5m cells: a card's nearest trunk within 5m is in its cell or the eight around it.
 */
export function trunkFinder(trunks: THREE.Vector2[]) {
  const cells = new Map<string, number[]>();
  const cellOf = (x: number, z: number) => `${Math.floor(x / 5)},${Math.floor(z / 5)}`;
  trunks.forEach((base, i) => {
    const key = cellOf(base.x, base.y);
    cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  return (x: number, z: number) => {
    let nearest = -1;
    let best = Infinity;
    const [cx, cz] = [Math.floor(x / 5), Math.floor(z / 5)];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++)
        for (const i of cells.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d = (trunks[i].x - x) ** 2 + (trunks[i].y - z) ** 2;
          if (d < best) [best, nearest] = [d, i];
        }
    return [nearest, best] as const;
  };
}

/**
 * Not in the source: the evergreen crowns' cone. The woodland's trees all carry their cards as a
 * broadleaf crown high on a bare stem, so the evergreen share read as summer broadleaf trees in the
 * snow even with the needle mask. The cone starts `BASE` of the way up (at least `LOW` above the
 * ground), reaches `TIP` past the highest card, and is `SLENDER` times its height across at the
 * base (clamped to `RADIUS`); `JITTER` frays its outline card by card. The cards shrink to `CARD` of
 * their size: at full size the near trees' needle sprays still blurred into broad leaves.
 */
export const EVERGREEN_CONE = {
  BASE: 0.16,
  LOW: 0.9,
  TIP: 0.5,
  SLENDER: 0.3,
  RADIUS: [1.3, 2.4],
  JITTER: 0.18,
  CARD: 0.75,
};

const cardHash = (x: number, z: number) => {
  let h = Math.imul(Math.round(x * 100), 0x27d4eb2d) ^ Math.imul(Math.round(z * 100), 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
};

/**
 * Moves the cards of the evergreen trees (`isEvergreenTree`) into a slender cone around their
 * trunk, keeping each card's tilt and bearing from the trunk. Cards go up the cone by their
 * height's rank in the tree, denser low where the cone is wider, and out by their distance's rank,
 * mostly toward the surface where they make the outline. Call before roundWoodlandCrowns, so the
 * crown normals and the forest floor's footprints follow the cone. Returns the number of cards moved.
 */
export function shapeEvergreenCones(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const trunks = trunkBases(root);
  const chosen = trunks.map((base) => isEvergreenTree(base.x, base.y));
  if (!chosen.some(Boolean)) return 0;
  const nearestTrunk = trunkFinder(trunks);
  const cards: { mesh: THREE.Mesh; first: number; center: THREE.Vector3; tree: number }[] = [];
  const local = new THREE.Vector3();
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      Array.isArray(object.material) ||
      !WOODLAND_CARD.test(object.material.name) ||
      !object.geometry.index
    )
      return;
    const { index } = object.geometry;
    const position = object.geometry.attributes.position;
    for (let t = 0; t < index.count; t += 6) {
      const center = new THREE.Vector3();
      for (let k = t; k < t + 6; k++) center.add(local.fromBufferAttribute(position, index.getX(k)));
      center.multiplyScalar(1 / 6).applyMatrix4(object.matrixWorld);
      const [tree, best] = nearestTrunk(center.x, center.z);
      if (tree >= 0 && best < 25 && chosen[tree]) cards.push({ mesh: object, first: t, center, tree });
    }
  });
  const byTree = new Map<number, typeof cards>();
  for (const card of cards) byTree.set(card.tree, [...(byTree.get(card.tree) ?? []), card]);
  const moved = new Map<THREE.Mesh, Set<number>>();
  const target = new THREE.Vector3();
  const toLocal = new THREE.Matrix4();
  for (const [tree, list] of byTree) {
    const { x, y: z } = trunks[tree];
    const distance = (c: (typeof list)[number]) => Math.hypot(c.center.x - x, c.center.z - z);
    const top = Math.max(...list.map((c) => c.center.y)) + EVERGREEN_CONE.TIP;
    const bottom = Math.max(EVERGREEN_CONE.LOW, top * EVERGREEN_CONE.BASE);
    const [low, high] = EVERGREEN_CONE.RADIUS;
    const radius = THREE.MathUtils.clamp((top - bottom) * EVERGREEN_CONE.SLENDER, low, high);
    const heightRank = new Map([...list].sort((a, b) => a.center.y - b.center.y).map((c, i) => [c, i]));
    const outRank = new Map([...list].sort((a, b) => distance(a) - distance(b)).map((c, i) => [c, i]));
    const last = Math.max(1, list.length - 1);
    for (const card of list) {
      // Cone surface area by height falls as (1 − t): the inverse of its share up to t.
      const t = 1 - Math.sqrt(1 - heightRank.get(card)! / last);
      const out = 0.4 + 0.6 * Math.sqrt(outRank.get(card)! / last);
      const fray = 1 + EVERGREEN_CONE.JITTER * (2 * cardHash(card.center.x, card.center.z) - 1);
      const reach = (radius * (1 - t) + 0.15) * out * fray;
      const bearing = Math.atan2(card.center.z - z, card.center.x - x);
      target.set(x + Math.cos(bearing) * reach, bottom + t * (top - bottom), z + Math.sin(bearing) * reach);
      // The move in the mesh's own space (the garden's meshes are not scaled or rotated per tree).
      toLocal.copy(card.mesh.matrixWorld).invert();
      const from = card.center.clone().applyMatrix4(toLocal);
      const to = target.applyMatrix4(toLocal);
      const { index } = card.mesh.geometry;
      const position = card.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const done = moved.get(card.mesh) ?? new Set<number>();
      moved.set(card.mesh, done);
      for (let k = card.first; k < card.first + 6; k++) {
        const vertex = index!.getX(k);
        if (done.has(vertex)) continue;
        done.add(vertex);
        local.fromBufferAttribute(position, vertex).sub(from).multiplyScalar(EVERGREEN_CONE.CARD).add(to);
        position.setXYZ(vertex, local.x, local.y, local.z);
      }
    }
  }
  for (const mesh of moved.keys()) {
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  return cards.length;
}

/** The listed vertices and the triangles among them, as a compact indexed geometry. */
function subset(geometry: THREE.BufferGeometry, vertices: number[], triangles: number[]) {
  const remap = new Map<number, number>();
  vertices.forEach((vertex, i) => remap.set(vertex, i));
  const part = new THREE.BufferGeometry();
  for (const [name, source] of Object.entries(geometry.attributes)) {
    const attribute = source as THREE.BufferAttribute;
    const Array = attribute.array.constructor as new (length: number) => THREE.TypedArray;
    const array = new Array(vertices.length * attribute.itemSize);
    vertices.forEach((vertex, i) => {
      for (let c = 0; c < attribute.itemSize; c++)
        array[i * attribute.itemSize + c] = attribute.array[vertex * attribute.itemSize + c];
    });
    part.setAttribute(name, new THREE.BufferAttribute(array, attribute.itemSize, attribute.normalized));
  }
  const order = vertices.length > 65535 ? new Uint32Array(triangles.length) : new Uint16Array(triangles.length);
  triangles.forEach((vertex, i) => (order[i] = remap.get(vertex)!));
  part.setIndex(new THREE.BufferAttribute(order, 1));
  return part;
}

/**
 * Splits the woodland's leaf cards by tree (each card goes to the nearest trunk across the ground)
 * and moves about a third of the trees into evergreen meshes with their own darker material. The
 * deciduous meshes keep their names for the seasonal colors and the winter leaf fall; in winter the
 * woodland stood as bare poles only. Call before the model preparation, which broadens the cards.
 * Returns the number of evergreen trees.
 */
export function splitEvergreenWoodland(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const trunks = trunkBases(root);
  const chosen = trunks.map((base) => isEvergreenTree(base.x, base.y));
  if (!chosen.some(Boolean)) return 0;
  const nearestTrunk = trunkFinder(trunks);
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !Array.isArray(object.material) &&
      WOODLAND_CARD.test(object.material.name) &&
      object.geometry.index
    )
      meshes.push(object);
  });
  const p = new THREE.Vector3();
  const local = new THREE.Vector3();
  for (const mesh of meshes) {
    const { geometry } = mesh;
    const index = geometry.index!;
    const position = geometry.attributes.position;
    const corners = index.array;
    const keep = { vertices: [] as number[], triangles: [] as number[] };
    const move = { vertices: [] as number[], triangles: [] as number[] };
    // Cards are four-vertex islands written two triangles at a time. 1 keeps a vertex, 2 moves it.
    const side = new Uint8Array(position.count);
    let shared = false;
    for (let t = 0; t < index.count; t += 6) {
      // The mean of the six corners is near enough the card's center to pick its tree.
      p.set(0, 0, 0);
      for (let k = t; k < t + 6; k++) p.add(local.fromBufferAttribute(position, corners[k]));
      p.multiplyScalar(1 / 6).applyMatrix4(mesh.matrixWorld);
      const [nearest, best] = nearestTrunk(p.x, p.z);
      // Crowns reach a few meters around their trunk; farther cards stay with the deciduous trees.
      const moved = best < 25 && chosen[nearest];
      const target = moved ? move : keep;
      for (let k = t; k < t + 6; k++) {
        const vertex = corners[k];
        if (!side[vertex]) {
          side[vertex] = moved ? 2 : 1;
          target.vertices.push(vertex);
        } else shared ||= side[vertex] !== (moved ? 2 : 1);
        target.triangles.push(vertex);
      }
    }
    // A vertex shared by cards on both sides would make broken islands; keep such meshes whole.
    if (!move.triangles.length || shared) continue;
    const material = mesh.material as THREE.MeshStandardMaterial;
    const evergreenMaterial = material.clone();
    evergreenMaterial.name = `${material.name} evergreen`;
    // Material.copy leaves the defines behind (crownNormals.ts marks the cards before the split).
    if (material.defines) evergreenMaterial.defines = { ...material.defines };
    evergreenMaterial.color.multiply(EVERGREEN_TINT);
    const crowns = new THREE.Mesh(subset(geometry, move.vertices, move.triangles), evergreenMaterial);
    crowns.name = `${mesh.name} evergreen`;
    crowns.position.copy(mesh.position);
    crowns.quaternion.copy(mesh.quaternion);
    crowns.scale.copy(mesh.scale);
    mesh.parent!.add(crowns);
    mesh.geometry = subset(geometry, keep.vertices, keep.triangles);
    geometry.dispose();
  }
  root.updateMatrixWorld(true);
  return chosen.filter(Boolean).length;
}
