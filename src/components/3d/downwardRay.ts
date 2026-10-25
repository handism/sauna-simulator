import * as THREE from 'three';

/**
 * The first hit of a ray straight down from `top` at (x, z), the same as
 * `Raycaster.intersectObjects(meshes, false)[0]?.point.y` to the bit, without testing every
 * triangle of every mesh. The garden placed thousands of decorations by such rays over the whole
 * terrain, which held the page for seconds after entering. The triangles are binned once by their
 * world-space footprint on a horizontal grid; a query tests only its cell's triangles, with
 * Mesh.raycast's own steps (bounding sphere and box, the ray in local space, the material's side,
 * the nearest hit in mesh then triangle order). The meshes must not move after this is made.
 * Morphed, skinned or multi-material meshes take the plain raycaster.
 */
export function createDownwardRay(meshes: THREE.Mesh[], top: number, cellSize = 0.5) {
  if (
    meshes.some(
      (mesh) =>
        Array.isArray(mesh.material) ||
        (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
        Object.keys(mesh.geometry.morphAttributes).length > 0,
    )
  ) {
    const raycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    return (x: number, z: number) => {
      raycaster.ray.origin.set(x, top, z);
      return raycaster.intersectObjects(meshes, false)[0]?.point.y;
    };
  }
  const entries = meshes.map((mesh) => {
    const geometry = mesh.geometry;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const index = geometry.index;
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const range = geometry.drawRange;
    return {
      mesh,
      index,
      position,
      start: Math.max(0, range.start),
      end: Math.min(index ? index.count : position.count, range.start + range.count),
      inverse: mesh.matrixWorld.clone().invert(),
      sphere: geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld),
    };
  });
  const corner = (entry: (typeof entries)[number], i: number, target: THREE.Vector3) =>
    target.fromBufferAttribute(entry.position, entry.index ? entry.index.getX(i) : i);

  // Each triangle's footprint, a little wider than its world-space vertices (the hit itself is
  // found in local space).
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const footprints: number[] = [];
  const bounds = new THREE.Box2();
  entries.forEach((entry, e) => {
    for (let i = entry.start; i + 2 < entry.end; i += 3) {
      corner(entry, i, a).applyMatrix4(entry.mesh.matrixWorld);
      corner(entry, i + 1, b).applyMatrix4(entry.mesh.matrixWorld);
      corner(entry, i + 2, c).applyMatrix4(entry.mesh.matrixWorld);
      const margin = 1e-4;
      const box = [
        Math.min(a.x, b.x, c.x) - margin,
        Math.min(a.z, b.z, c.z) - margin,
        Math.max(a.x, b.x, c.x) + margin,
        Math.max(a.z, b.z, c.z) + margin,
      ];
      if (!box.every(Number.isFinite)) continue;
      footprints.push(e, i, ...box);
      bounds.expandByPoint(new THREE.Vector2(box[0], box[1])).expandByPoint(new THREE.Vector2(box[2], box[3]));
    }
  });
  if (bounds.isEmpty()) return () => undefined;
  const columns = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.max.y - bounds.min.y) / cellSize));
  const column = (x: number) => Math.min(columns - 1, Math.floor((x - bounds.min.x) / cellSize));
  const row = (z: number) => Math.min(rows - 1, Math.floor((z - bounds.min.y) / cellSize));
  // Pairs of (entry, first vertex), in mesh then triangle order like the raycaster's hits.
  const cells: number[][] = [];
  for (let f = 0; f < footprints.length; f += 6) {
    for (let r = row(footprints[f + 3]); r <= row(footprints[f + 5]); r++) {
      for (let q = column(footprints[f + 2]); q <= column(footprints[f + 4]); q++) {
        (cells[r * columns + q] ??= []).push(footprints[f], footprints[f + 1]);
      }
    }
  }

  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const local = new THREE.Ray();
  const hit = new THREE.Vector3();
  const world = new THREE.Vector3();
  return (x: number, z: number) => {
    if (!(x >= bounds.min.x && x <= bounds.max.x && z >= bounds.min.y && z <= bounds.max.y)) return undefined;
    const list = cells[row(z) * columns + column(x)];
    if (!list) return undefined;
    ray.origin.set(x, top, z);
    let nearest = Infinity;
    let height: number | undefined;
    let current = -1;
    let reached = false;
    for (let k = 0; k < list.length; k += 2) {
      const entry = entries[list[k]];
      if (list[k] !== current) {
        // Mesh.raycast's early outs, which a hit on a box's edge could otherwise pass.
        current = list[k];
        reached =
          (entry.sphere.containsPoint(ray.origin) || ray.intersectSphere(entry.sphere, hit) !== null) &&
          (local.copy(ray).applyMatrix4(entry.inverse), true) &&
          (entry.mesh.geometry.boundingBox === null || local.intersectsBox(entry.mesh.geometry.boundingBox));
      }
      if (!reached) continue;
      const i = list[k + 1];
      corner(entry, i, a);
      corner(entry, i + 1, b);
      corner(entry, i + 2, c);
      const side = (entry.mesh.material as THREE.Material).side;
      const found =
        side === THREE.BackSide
          ? local.intersectTriangle(c, b, a, true, hit)
          : local.intersectTriangle(a, b, c, side === THREE.FrontSide, hit);
      if (found === null) continue;
      world.copy(hit).applyMatrix4(entry.mesh.matrixWorld);
      const distance = ray.origin.distanceTo(world);
      if (distance < nearest) {
        nearest = distance;
        height = world.y;
      }
    }
    return height;
  };
}
