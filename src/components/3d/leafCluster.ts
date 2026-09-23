import * as THREE from 'three';

// Distant woodland crowns are exported as cards, each standing in for a fixed number
// of source leaves (scripts/export_web_glb.py records it in the material extras). The
// card keeps their total leaf area: leaves cover half of the card, as each source
// diamond covers half of its bounding rectangle.
export interface LeafCluster { leaves: number }

export const LEAF_CLUSTER_SIZE = 64;
const SUPERSAMPLE = 4;
const CUTOFF = .5;

export function leafClusterOf(material: THREE.Material): LeafCluster | null {
  const value = material.userData?.suiLeafCluster;
  return value && Number.isInteger(value.leaves) && value.leaves > 0 ? value : null;
}

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Coverage in [0, 1] per texel: rotated diamond leaves on a jittered grid, antialiased
// by supersampling. Deterministic, so every load draws the same crowns.
export function leafClusterCoverage(leaves: number, size = LEAF_CLUSTER_SIZE): Float32Array {
  const next = random(leaves);
  // Each diamond (half-diagonal r) covers 2r^2 = 1 / (2 * leaves) of the card.
  const r = Math.sqrt(1 / (4 * leaves));
  const columns = Math.ceil(Math.sqrt(leaves));
  const rows = Math.ceil(leaves / columns);
  const shapes = Array.from({ length: leaves }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    // Keep whole leaves inside the card; a rotated diamond never extends past r.
    const x = r + (column + next()) / columns * (1 - 2 * r);
    const y = r + (row + next()) / rows * (1 - 2 * r);
    const angle = next() * Math.PI / 2;
    return { x, y, cos: Math.cos(angle), sin: Math.sin(angle) };
  });
  const coverage = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const u = (px + (sx + .5) / SUPERSAMPLE) / size;
          const v = (py + (sy + .5) / SUPERSAMPLE) / size;
          if (shapes.some(({ x, y, cos, sin }) => {
            const du = u - x, dv = v - y;
            return Math.abs(du * cos + dv * sin) + Math.abs(dv * cos - du * sin) <= r;
          })) hits++;
        }
      }
      coverage[py * size + px] = hits / SUPERSAMPLE ** 2;
    }
  }
  return coverage;
}

const covered = (alpha: Float32Array, scale = 1) => {
  let count = 0;
  for (const value of alpha) if (value * scale >= CUTOFF) count++;
  return count / alpha.length;
};

// Box-filtered mips lose alpha-tested coverage, so distant crowns would thin out and
// vanish. Rescale each level to keep the level-0 share of texels above the cutoff.
export function leafClusterMips(base: Float32Array, size: number): Float32Array[] {
  const target = covered(base);
  const levels = [base];
  for (let width = size / 2; width >= 1; width /= 2) {
    const previous = levels[levels.length - 1];
    const level = new Float32Array(width * width);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        const at = (dx: number, dy: number) => previous[(2 * y + dy) * width * 2 + 2 * x + dx];
        level[y * width + x] = (at(0, 0) + at(1, 0) + at(0, 1) + at(1, 1)) / 4;
      }
    }
    let low = 0, high = 1 / CUTOFF / Math.max(Math.min(...level.filter(value => value > 0)), 1e-6);
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (covered(level, middle) < target) low = middle; else high = middle;
    }
    // Choose the scale whose coverage is nearest to the base coverage.
    const scale = Math.abs(covered(level, low) - target) < Math.abs(covered(level, high) - target) ? low : high;
    levels.push(level.map(value => Math.min(1, value * scale)));
  }
  return levels;
}

export function createLeafClusterTexture(cluster: LeafCluster): THREE.DataTexture {
  const levels = leafClusterMips(leafClusterCoverage(cluster.leaves), LEAF_CLUSTER_SIZE).map((alpha, index) => {
    const width = LEAF_CLUSTER_SIZE >> index;
    const data = new Uint8Array(width * width * 4);
    alpha.forEach((value, texel) => data.fill(Math.round(value * 255), texel * 4, texel * 4 + 4));
    return { data, width, height: width };
  });
  const texture = new THREE.DataTexture(levels[0].data, LEAF_CLUSTER_SIZE, LEAF_CLUSTER_SIZE);
  texture.mipmaps = levels;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

// alphaMap reads the green channel with the card UVs. Alpha to coverage softens the
// cutout edges under MSAA; shadow depth falls back to a fixed 0.5 cutoff.
export function applyLeafCluster(material: THREE.MeshStandardMaterial, texture: THREE.Texture) {
  material.alphaMap = texture;
  material.alphaTest = CUTOFF;
  material.alphaToCoverage = true;
  material.needsUpdate = true;
}
