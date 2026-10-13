import * as THREE from 'three';

/** Extra cards added beside each woodland card: the crowns read as bare branches with tufts. */
export const CROWN_FILL_COPIES = 1;

/** Broaden disconnected woodland cards around their branch positions and add spun, tilted copies
 * beside them (same UVs and normals, so each copy is lit like its card), without new draws.
 * Only four-vertex islands are eligible; shared/continuous meshes are left untouched.
 */
export function broadenWoodlandCards(geometry: THREE.BufferGeometry) {
  if (geometry.userData.suiBroadenedCrowns) return;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!position || !index) return;
  const parents = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = (vertex: number): number => {
    while (parents[vertex] !== vertex) {
      parents[vertex] = parents[parents[vertex]];
      vertex = parents[vertex];
    }
    return vertex;
  };
  for (let i = 0; i < index.count; i += 3) {
    const a = find(index.getX(i));
    parents[find(index.getX(i + 1))] = a;
    parents[find(index.getX(i + 2))] = a;
  }
  const islands = new Map<number, number[]>();
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    const vertices = islands.get(root) ?? [];
    vertices.push(i);
    islands.set(root, vertices);
  }
  const triangles = new Map<number, number[]>();
  for (let i = 0; i < index.count; i += 3) {
    const root = find(index.getX(i));
    const list = triangles.get(root) ?? [];
    list.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    triangles.set(root, list);
  }
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const normal = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const shortAxis = new THREE.Vector3();
  const longAxis = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const filled: { root: number; vertices: number[] }[] = [];
  const copies: number[] = [];
  for (const [root, vertices] of islands) {
    if (vertices.length !== 4) continue;
    center.set(0, 0, 0);
    for (const i of vertices) center.add(point.fromBufferAttribute(position, i));
    center.multiplyScalar(0.25);
    // Position-derived variation survives material batching and index reordering.
    const random = (salt: number) => {
      const noise = Math.sin(center.x * 12.9898 + center.y * 78.233 + center.z * 37.719 + salt * 4.1414) * 43758.5453;
      return noise - Math.floor(noise);
    };
    // Exported cards inherit a single leaf's narrow rectangle. Round that footprint into
    // a branch-tip tuft while keeping its area and anchor, instead of adding more cards.
    a.fromBufferAttribute(position, vertices[0]);
    let shortest = Infinity;
    for (const i of vertices.slice(1)) {
      point.fromBufferAttribute(position, i).sub(a);
      if (point.lengthSq() < shortest) {
        shortest = point.lengthSq();
        shortAxis.copy(point);
      }
    }
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    normal.crossVectors(axis.subVectors(b, a), point.subVectors(c, a));
    if (normal.lengthSq() < 1e-12 || shortest < 1e-12) continue;
    normal.normalize();
    shortAxis.normalize();
    longAxis.crossVectors(normal, shortAxis).normalize();
    let longExtent = 0;
    for (const i of vertices) {
      point.fromBufferAttribute(position, i).sub(center);
      longExtent = Math.max(longExtent, Math.abs(point.dot(longAxis)));
    }
    const aspect = (2 * longExtent) / Math.sqrt(shortest);
    const round = Math.min(1.45, Math.max(1, Math.sqrt(aspect / 1.35)));
    const scale = 1.15 + random(0) * 0.2;
    for (const i of vertices) {
      point.fromBufferAttribute(position, i).sub(center);
      const across = point.dot(shortAxis);
      const along = point.dot(longAxis);
      point.addScaledVector(shortAxis, across * (round - 1));
      point.addScaledVector(longAxis, along * (1 / round - 1));
      point.multiplyScalar(scale).add(center);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    a.fromBufferAttribute(position, vertices[0]);
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    normal.crossVectors(axis.subVectors(b, a), point.subVectors(c, a));
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();
    const size = Math.max(a.distanceTo(b), b.distanceTo(c), a.distanceTo(c));
    filled.push({ root, vertices });
    for (let copy = 0; copy < CROWN_FILL_COPIES; copy++) {
      const salt = 1 + copy * 7;
      // Near-parallel copies overlap the same thin branch tufts. Lean the existing copy
      // out of that plane and spread it farther, filling gaps without more cards or leaf area.
      // Keep the crown shading normals: rotating those would make a copy a separate dark patch.
      spin.setFromAxisAngle(normal, ((50 + random(salt) * 80) * Math.PI) / 180);
      axis.subVectors(b, a).applyQuaternion(spin).normalize();
      const lean = random(salt + 1);
      tilt.setFromAxisAngle(axis, ((lean < 0.5 ? -1 : 1) * (35 + Math.abs(lean - 0.5) * 50) * Math.PI) / 180);
      spin.premultiply(tilt);
      offset
        .copy(axis)
        .applyAxisAngle(normal, random(salt + 2) * Math.PI * 2)
        .multiplyScalar(size * (0.55 + random(salt + 3) * 0.2));
      const shrink = 0.85 + random(salt + 4) * 0.25;
      for (const i of vertices) {
        point.fromBufferAttribute(position, i).sub(center).applyQuaternion(spin).multiplyScalar(shrink);
        point.add(center).add(offset);
        copies.push(point.x, point.y, point.z);
      }
    }
  }
  if (copies.length) {
    const count = position.count;
    const added = copies.length / 3;
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
      const source = attribute as THREE.BufferAttribute;
      const Typed = source.array.constructor as new (length: number) => THREE.TypedArray;
      const array = new Typed((count + added) * source.itemSize);
      array.set(source.array.subarray(0, count * source.itemSize));
      let at = count * source.itemSize;
      if (name === 'position') array.set(copies, at);
      else
        for (const { vertices } of filled)
          for (let copy = 0; copy < CROWN_FILL_COPIES; copy++)
            for (const i of vertices)
              for (let k = 0; k < source.itemSize; k++) array[at++] = source.array[i * source.itemSize + k];
      geometry.setAttribute(name, new THREE.BufferAttribute(array, source.itemSize, source.normalized));
    }
    const indices = Array.from(index.array);
    let next = count;
    for (const { root, vertices } of filled)
      for (let copy = 0; copy < CROWN_FILL_COPIES; copy++) {
        for (const i of triangles.get(root)!) indices.push(next + vertices.indexOf(i));
        next += 4;
      }
    geometry.setIndex(indices);
  } else position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.suiBroadenedCrowns = true;
}
