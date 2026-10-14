import * as THREE from 'three';

/** Five cupped petals and a warm centre, small enough to remain a garden accent. */
export function gardenBloomGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const petal = new THREE.Color(0xffffff);
  const heart = new THREE.Color(0xe4b85a);
  const triangle = (a: number[], b: number[], c: number[], tint: THREE.Color) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(tint.r, tint.g, tint.b);
  };
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const point = (r: number, w: number, y: number) => [
      Math.cos(angle) * r - Math.sin(angle) * w,
      y,
      Math.sin(angle) * r + Math.cos(angle) * w,
    ];
    const base = point(0.1, 0, 0);
    const left = point(0.55, -0.32, 0.08);
    const tip = point(1, 0, 0.28);
    const right = point(0.55, 0.32, 0.08);
    const middle = point(0.53, 0, 0.03);
    for (const [a, b] of [
      [base, left],
      [left, tip],
      [tip, right],
      [right, base],
    ])
      triangle(middle, a, b, petal);
    const next = angle + (Math.PI * 2) / 5;
    triangle([0, 0.16, 0], point(0.22, 0, 0.11), [Math.cos(next) * 0.22, 0.11, Math.sin(next) * 0.22], heart);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}
