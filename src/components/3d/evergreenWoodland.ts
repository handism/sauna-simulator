import * as THREE from 'three';

/** Share of the woodland trees that keep their leaves through autumn and winter. */
export const EVERGREEN_SHARE = 0.35;
/** Evergreen crowns are a deeper, cooler green than the deciduous summer tones. */
const EVERGREEN_TINT = new THREE.Color(0.58, 0.7, 0.6);
const WOODLAND_CARD = /^V6 woodland leaf \d+ card$/;

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
function trunkBases(root: THREE.Object3D) {
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
  // Trunks in 5m cells: a card's nearest trunk within 5m is in its cell or the eight around it.
  const cells = new Map<string, number[]>();
  const cellOf = (x: number, z: number) => `${Math.floor(x / 5)},${Math.floor(z / 5)}`;
  trunks.forEach((base, i) => {
    const key = cellOf(base.x, base.y);
    cells.set(key, [...(cells.get(key) ?? []), i]);
  });
  const nearestTrunk = (x: number, z: number) => {
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
