import * as THREE from 'three';

/** Fold the two sides of each exported fern leaflet around its existing diagonal vein.
 * The source is disconnected pairs of triangles. Keep the vein's endpoints, topology and
 * material batches; unsupported/shared topology is left alone. Run once before shadow setup.
 */
export function shapeFernLeaflets(geometry: THREE.BufferGeometry) {
  if (geometry.userData.suiFernShaped) return;
  const source = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!source || !index || index.count % 6 !== 0) return;
  const uses = new Uint8Array(source.count);
  const leaves: { vein: number[]; sides: number[] }[] = [];
  for (let i = 0; i < index.count; i += 6) {
    const first = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const second = [index.getX(i + 3), index.getX(i + 4), index.getX(i + 5)];
    const vertices = [...new Set([...first, ...second])];
    const vein = first.filter((v) => second.includes(v));
    if (vertices.length !== 4 || vein.length !== 2 || vertices.some((v) => uses[v])) return;
    vertices.forEach((v) => (uses[v] = 1));
    leaves.push({ vein, sides: vertices.filter((v) => !vein.includes(v)) });
  }
  const position = new THREE.Float32BufferAttribute(
    Float32Array.from({ length: source.count * 3 }, (_, i) => source.getComponent(Math.floor(i / 3), i % 3)),
    3,
  );
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    axis = new THREE.Vector3();
  const point = new THREE.Vector3(),
    across = new THREE.Vector3(),
    up = new THREE.Vector3();
  for (const { vein, sides } of leaves) {
    a.fromBufferAttribute(source, vein[0]);
    b.fromBufferAttribute(source, vein[1]);
    axis.subVectors(b, a).normalize();
    // Up projected perpendicular to the vein; the attachment and tip never move.
    up.set(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    across.crossVectors(axis, up).normalize();
    const seed = Math.sin(a.x * 12.9898 + a.y * 78.233 + a.z * 37.719) * 43758.5453;
    const fold = 0.45 + (seed - Math.floor(seed)) * 0.3;
    for (const v of sides) {
      point.fromBufferAttribute(source, v).sub(a);
      const length = point.dot(axis);
      const width = point.dot(across) * 0.95;
      point
        .copy(a)
        .addScaledVector(axis, length)
        .addScaledVector(across, width)
        .addScaledVector(up, -Math.abs(width) * fold);
      position.setXYZ(v, point.x, point.y, point.z);
    }
  }
  geometry.setAttribute('position', position);
  // Fresh float normals avoid quantizing the shallow fold back into a single plane.
  geometry.deleteAttribute('normal');
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.suiFernShaped = true;
}
