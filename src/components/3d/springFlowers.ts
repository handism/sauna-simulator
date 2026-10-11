import * as THREE from 'three';

// Small groups beside the garden path, outside the sheltered deck and pool.
// Deterministic placement keeps re-entry and seasonal comparisons consistent.
const PATCHES = [
  [-2.6, 4.5],
  [-1.5, 6.2],
  [-0.5, 8.0],
  [0.8, 5.5],
  [1.8, 7.8],
  [3.4, 4.1],
  [4.4, 5.8],
  [5.6, 7.1],
  [-4.1, 7.3],
  [6.4, 4.3],
] as const;

/** Adds one merged, opaque mesh: no texture download, animation or instance buffers. */
export function addSpringFlowers(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const ground: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((material) => /moss|woodland earth|garden gravel/i.test(material.name))) ground.push(object);
  });
  if (!ground.length) return 0;
  const positions: number[] = [];
  const colors: number[] = [];
  const stem = new THREE.Color(0x638144);
  const center = new THREE.Color(0xe9bc57);
  const petals = [new THREE.Color(0xf0e7df), new THREE.Color(0xe9b8c6), new THREE.Color(0xe2cbd1)];
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const triangle = (a: number[], b: number[], c: number[], color: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  let count = 0;
  for (const [patch, [px, pz]] of PATCHES.entries()) {
    for (let flower = 0; flower < 7; flower++) {
      const angle = flower * 2.4 + patch * 0.7;
      const spread = 0.11 + flower * 0.035;
      const x = px + Math.cos(angle) * spread;
      const z = pz + Math.sin(angle) * spread;
      ray.ray.origin.set(x, 10, z);
      const hit = ray.intersectObjects(ground, false)[0];
      if (!hit) continue;
      const floor = hit.point.y + 0.008;
      const y = floor + 0.18 + ((patch + flower) % 4) * 0.025;
      // Two crossed strips for the stem, merged with the flower head.
      for (const [dx, dz] of [
        [0.004, 0],
        [0, 0.004],
      ]) {
        const a = [x - dx, floor, z - dz],
          b = [x + dx, floor, z + dz];
        const c = [x + dx, y, z + dz],
          d = [x - dx, y, z - dz];
        triangle(a, b, c, stem);
        triangle(a, c, d, stem);
      }
      const color = petals[(patch + flower) % petals.length];
      for (let petal = 0; petal < 5; petal++) {
        const direction = angle + (petal * Math.PI * 2) / 5;
        const point = (t: number) => {
          const radial = 0.034 + Math.cos(t) * 0.052;
          const across = Math.sin(t) * 0.031;
          return [
            x + Math.cos(direction) * radial - Math.sin(direction) * across,
            y + 0.013 * (1 + Math.cos(t)),
            z + Math.sin(direction) * radial + Math.cos(direction) * across,
          ];
        };
        const middle = [x + Math.cos(direction) * 0.034, y + 0.008, z + Math.sin(direction) * 0.034];
        for (let segment = 0; segment < 8; segment++)
          triangle(middle, point((segment * Math.PI) / 4), point(((segment + 1) * Math.PI) / 4), color);
      }
      for (let segment = 0; segment < 8; segment++) {
        const point = (t: number) => [x + Math.cos(t) * 0.021, y + 0.014, z + Math.sin(t) * 0.021];
        triangle([x, y + 0.02, z], point((segment * Math.PI) / 4), point(((segment + 1) * Math.PI) / 4), center);
      }
      count++;
    }
  }
  if (!count) return 0;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.applyMatrix4(root.matrixWorld.clone().invert());
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
  material.name = 'Spring wildflowers';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Spring wildflowers';
  mesh.userData.suiSpringFlowers = count;
  // The seasonal controller sets visibility before preparing/compiling the model.
  root.add(mesh);
  return count;
}
