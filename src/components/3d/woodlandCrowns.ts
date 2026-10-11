import * as THREE from 'three';

/** Broaden disconnected woodland cards around their branch positions, without new draws.
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
  const center = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (const vertices of islands.values()) {
    if (vertices.length !== 4) continue;
    center.set(0, 0, 0);
    for (const i of vertices) center.add(point.fromBufferAttribute(position, i));
    center.multiplyScalar(0.25);
    // Position-derived variation survives material batching and index reordering.
    const noise = Math.sin(center.x * 12.9898 + center.y * 78.233 + center.z * 37.719) * 43758.5453;
    const scale = 1.35 + (noise - Math.floor(noise)) * 0.3;
    for (const i of vertices) {
      point.fromBufferAttribute(position, i).sub(center).multiplyScalar(scale).add(center);
      position.setXYZ(i, point.x, point.y, point.z);
    }
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.suiBroadenedCrowns = true;
}
