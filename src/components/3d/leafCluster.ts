import * as THREE from 'three';

// Distant woodland crowns are exported as cards, each standing in for a fixed number
// of source leaves (scripts/export_web_glb.py records it in the material extras). The
// card keeps their total leaf area: leaves cover half of the card, as each source
// diamond covers half of its bounding rectangle.
export interface LeafCluster {
  leaves: number;
}

export const LEAF_CLUSTER_SIZE = 64;
const SUPERSAMPLE = 4;
const CUTOFF = 0.5;

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

// Half widths (relative to the widest) along the leaf from the stalk to the tip: the
// ovate outline of the near canopy leaves (canopyLeafShape.ts), area 1.27 × length × widest.
const OUTLINE = [
  [0, 0],
  [0.16, 0.62],
  [0.38, 1],
  [0.62, 0.86],
  [0.84, 0.48],
  [1, 0],
] as const;
const OUTLINE_AREA = OUTLINE.slice(1).reduce((sum, [t, w], i) => sum + (t - OUTLINE[i][0]) * (w + OUTLINE[i][1]), 0);
// Length over full width, and the leaf area per card share: overlaps take a little, so
// the leaves cover about the same share above the cutoff as the earlier diamonds (0.44).
const LEAF_ASPECT = 2.2;
const LEAF_AREA = 0.9;

const halfWidth = (t: number) => {
  if (t <= 0 || t >= 1) return 0;
  let i = 1;
  while (OUTLINE[i][0] < t) i++;
  const [t0, w0] = OUTLINE[i - 1];
  const [t1, w1] = OUTLINE[i];
  return w0 + ((w1 - w0) * (t - t0)) / (t1 - t0);
};

// Coverage in [0, 1] per texel: ovate leaves of varied size and any direction on a jittered
// grid, antialiased by supersampling. Deterministic, so every load draws the same crowns.
export function leafClusterCoverage(leaves: number, size = LEAF_CLUSTER_SIZE): Float32Array {
  const next = random(leaves);
  const columns = Math.ceil(Math.sqrt(leaves));
  const rows = Math.ceil(leaves / columns);
  const shapes = Array.from({ length: leaves }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    // Each leaf takes 1 / (2 * leaves) of the card on average, its area scaled 0.5–1.5.
    const area = (LEAF_AREA * (0.5 + next())) / (2 * leaves);
    const widest = Math.sqrt(area / (2 * LEAF_ASPECT * OUTLINE_AREA));
    const length = 2 * LEAF_ASPECT * widest;
    const angle = next() * 2 * Math.PI;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    // Keep whole leaves inside the card: clamp the jittered grid position by the rotated
    // outline's extent.
    const extent = (x: number, y: number) =>
      Math.max(
        ...OUTLINE.flatMap(([t, w]) => [1, -1].map((sign) => Math.abs((t - 0.5) * length * x + sign * w * widest * y))),
      );
    // One texel clear of the border, as the diamonds were.
    const [rx, ry] = [extent(cos, -sin) + 1 / size, extent(sin, cos) + 1 / size];
    const x = THREE.MathUtils.clamp((column + next()) / columns, rx, 1 - rx);
    const y = THREE.MathUtils.clamp((row + next()) / rows, ry, 1 - ry);
    return { x, y, cos, sin, length, widest };
  });
  const coverage = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const u = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const v = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (
            shapes.some(({ x, y, cos, sin, length, widest }) => {
              const du = u - x,
                dv = v - y;
              const along = (du * cos + dv * sin) / length + 0.5;
              return Math.abs(dv * cos - du * sin) <= widest * halfWidth(along);
            })
          )
            hits++;
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
    let low = 0,
      high = 1 / CUTOFF / Math.max(Math.min(...level.filter((value) => value > 0)), 1e-6);
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (covered(level, middle) < target) low = middle;
      else high = middle;
    }
    // Choose the scale whose coverage is nearest to the base coverage.
    const scale = Math.abs(covered(level, low) - target) < Math.abs(covered(level, high) - target) ? low : high;
    levels.push(level.map((value) => Math.min(1, value * scale)));
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

/** The half width of the cutoff's ramp once a pixel spans two texels (`suiLeafCoverage`). */
export const LEAF_FAR_RAMP = 0.2;
/**
 * How far the cutoff drops once a pixel spans three texels (`suiLeafCoverage`, from one): a distant
 * card covers more of its samples, so a crown reads as a leafy mass instead of a lace of separate
 * dark leaves, and fewer leaf edges against the sky pop while looking around. 0.14 from 1.5 to 4
 * texels left the 20–40 m crowns lacy; a larger leaf area instead merged the near leaves into blobs
 * (docs/3d-qa/crown-fill-far/).
 */
export const LEAF_FAR_FILL = 0.32;
const FILL_FROM = 1;
const FILL_TO = 3;

// The share of the MSAA samples a card covers, from the alpha map's (rescaled) coverage. Up close,
// the cutoff softened over a pixel, as three's alphatest_fragment does for alpha to coverage. Once
// a pixel spans more than a texel, the leaves are under a pixel and that ramp turned whole pixels
// on and off as the view moved (docs/3d-qa/leaf-shimmer); a wider ramp, centred on the cutoff,
// fades them over part of the samples instead. The mean coverage itself would thin the crowns:
// overlapping cards with the same alpha cover the same samples. Further still, the cutoff drops so
// the distant crowns fill in (the leaves seen against the sky were separate dark specks).
export const LEAF_COVERAGE_GLSL = /* glsl */ `
float suiLeafCoverage( float alpha, vec2 uv ) {
	vec2 texels = uv * ${LEAF_CLUSTER_SIZE.toFixed(1)};
	float footprint = max( length( dFdx( texels ) ), length( dFdy( texels ) ) );
	float ramp = max( fwidth( alpha ), ${LEAF_FAR_RAMP.toFixed(2)} * smoothstep( 1.0, 2.0, footprint ) );
	float cutoff = ${CUTOFF.toFixed(1)} - ${LEAF_FAR_FILL.toFixed(2)} * smoothstep( ${FILL_FROM.toFixed(1)}, ${FILL_TO.toFixed(1)}, footprint );
	// Below zero far off (a wide ramp under a low cutoff), the clear parts of a card keep a little
	// coverage: it joins the leaves into a mass, as measured (docs/3d-qa/crown-fill-far/).
	return smoothstep( cutoff - ramp, cutoff + ramp, alpha );
}
`;

export const ALPHA_TEST = '#include <alphatest_fragment>';

// alphaMap reads the green channel with the card UVs; the shadow maps cut it at a fixed 0.5.
// Composes with an earlier onBeforeCompile.
export function applyLeafCluster(material: THREE.MeshStandardMaterial, texture: THREE.Texture) {
  material.alphaMap = texture;
  material.alphaTest = CUTOFF;
  material.alphaToCoverage = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (!shader.fragmentShader.includes(ALPHA_TEST))
      throw new Error('three shader chunks changed; update leafCluster.ts');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${LEAF_COVERAGE_GLSL}\nvoid main() {`)
      .replace(
        ALPHA_TEST,
        'diffuseColor.a = suiLeafCoverage( diffuseColor.a, vAlphaMapUv );\n\tif ( diffuseColor.a == 0.0 ) discard;',
      );
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|leaf-cluster`;
  material.needsUpdate = true;
}
