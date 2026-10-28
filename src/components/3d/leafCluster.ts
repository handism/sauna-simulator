import * as THREE from 'three';

// Distant woodland crowns are exported as cards, each standing in for a fixed number
// of source leaves (scripts/export_web_glb.py records it in the material extras). The
// card keeps their total leaf area: leaves cover half of the card, as each source
// diamond covers half of its bounding rectangle.
export interface LeafCluster {
  leaves: number;
}

export const LEAF_CLUSTER_SIZE = 128;
/**
 * Mask leaves per source leaf (not in the source): each drawn leaf has 1/LEAF_SPLIT of the source
 * leaf's area, the card's leaf area the same. At 20 leaves the near crowns (10–20 m) read as a few
 * large paper cut-outs, each leaf as long as a hand; the mask is twice as fine to keep their outline.
 * Split three ways the outer leaves still stood against the dusk sky as single large cut-outs
 * (2026-10-28): five.
 */
export const LEAF_SPLIT = 5;
/**
 * The texels across a card that the far fill, ramp and bias count a pixel's footprint in: the
 * earlier mask's 64, where they were measured (docs/3d-qa/leaf-alpha-bias/ and before). Counted in
 * the finer mask's texels they set in at half the distance and closed the mid-ground crowns up.
 */
const LEAF_FOOTPRINT_TEXELS = 64;
/**
 * Each mask leaf's own shade (not in the source), in the mask's red channel over 0–LEAF_SHADE_MAX:
 * `spread` either way of the mean per leaf, darker by `stalk` toward its stalk inside the sprig.
 * Each card was lit as one flat plane, so a crown in the mid-ground read as flat paper cut-outs;
 * the leaves' own shades give the cut-outs a leafy texture. The mips average the shade over the
 * leaves only (not the gaps), so it fades to 1 without darkening far crowns.
 */
export const LEAF_SHADE = { spread: 0.24, stalk: 0.22 };
const LEAF_SHADE_MAX = 1.5;
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
// Length over full width, and the leaf area per card share: the leaves of a sprig overlap at
// their stalks, so they cover a little less above the cutoff (0.41) than the earlier evenly
// spread leaves (0.44) did with 0.9. Split three ways (LEAF_SPLIT) they overlap more: 1.55 kept 0.41;
// split five ways, six to a sprig, 1.7 keeps 0.42.
const LEAF_ASPECT = 2.2;
const LEAF_AREA = 1.7;
// Leaves per sprig; the sprigs lie on a sunflower spiral out to LEAF_SPRIG_REACH of the card,
// each moved up to LEAF_SPRIG_JITTER of their spacing. A centre and one ring (five sprigs of four
// leaves) drew rosettes too regular once the leaves were smaller.
const LEAVES_PER_SPRIG = 6;
const LEAF_SPRIG_REACH = 0.3;
const LEAF_SPRIG_JITTER = 0.35;

/** How a card's leaves are drawn: split per source leaf, length over width, area share, per sprig. */
export type LeafForm = { split: number; aspect: number; area: number; perSprig: number };
const BROADLEAF: LeafForm = { split: LEAF_SPLIT, aspect: LEAF_ASPECT, area: LEAF_AREA, perSprig: LEAVES_PER_SPRIG };
/**
 * Not in the source: the evergreen share of the woodland (evergreenWoodland.ts) drawn as sprays of
 * narrow needle-like leaves. With the broadleaf mask, in winter they stood among the bare trees as
 * summer broadleaf crowns in the snow. Twice as many leaves per source leaf, each about three times
 * as slender, fanned eight to a spray; the area keeps the coverage above the cutoff near the
 * broadleaf mask's.
 */
export const NEEDLE_LEAF: LeafForm = { split: 6, aspect: 6.5, area: 1.45, perSprig: 8 };

const halfWidth = (t: number) => {
  if (t <= 0 || t >= 1) return 0;
  let i = 1;
  while (OUTLINE[i][0] < t) i++;
  const [t0, w0] = OUTLINE[i - 1];
  const [t1, w1] = OUTLINE[i];
  return w0 + ((w1 - w0) * (t - t0)) / (t1 - t0);
};

// Coverage in [0, 1] per texel: ovate leaves of varied size in sprigs, antialiased by
// supersampling. Deterministic, so every load draws the same crowns.
export function leafClusterCoverage(leaves: number, size = LEAF_CLUSTER_SIZE): Float32Array {
  return leafCluster(leaves, size).coverage;
}

/**
 * The mask's coverage and each texel's mean leaf shade (LEAF_SHADE) over the leaves in it, 1 where
 * none is. Deterministic.
 */
export function leafCluster(leaves: number, size = LEAF_CLUSTER_SIZE, form: LeafForm = BROADLEAF) {
  const next = random(leaves);
  // Their own stream, so the shades leave the outline as it was.
  const shadeOf = random(leaves + 101);
  const { split, aspect, area: leafArea, perSprig } = form;
  const count = leaves * split;
  // Each leaf's stalk at its sprig's centre, the leaves spread round it like a rosette, so the card
  // fills a scalloped disc. Leaves on a jittered grid out to the corners showed the card's rectangle
  // in the mid-ground crowns once the far fill and bias closed them up; leaves evenly over a disc,
  // one smooth oval like a single huge leaf on the long cards (docs/3d-qa/leaf-card-sprigs/).
  const sprigCount = Math.max(1, Math.round(count / perSprig));
  const spacing = LEAF_SPRIG_REACH / Math.sqrt(sprigCount);
  const sprigs = Array.from({ length: sprigCount }, (_, index) => {
    const turn = next() * 2 * Math.PI;
    const radius = LEAF_SPRIG_REACH * Math.sqrt((index + 0.5) / sprigCount);
    const around = index * Math.PI * (3 - Math.sqrt(5));
    return {
      x: 0.5 + radius * Math.cos(around) + LEAF_SPRIG_JITTER * spacing * (next() - 0.5),
      y: 0.5 + radius * Math.sin(around) + LEAF_SPRIG_JITTER * spacing * (next() - 0.5),
      turn,
    };
  });
  const shapes = Array.from({ length: count }, (_, index) => {
    const sprig = sprigs[index % sprigCount];
    const place = Math.floor(index / sprigCount);
    const around = Math.ceil((count - (index % sprigCount)) / sprigCount);
    // Each leaf takes 1 / (2 * count) of the card on average, its area scaled 0.5–1.5.
    const area = (leafArea * (0.5 + next())) / (2 * count);
    const widest = Math.sqrt(area / (2 * aspect * OUTLINE_AREA));
    const length = 2 * aspect * widest;
    // Evenly round the sprig, each turned up to a sixth of a step either way.
    const angle = sprig.turn + ((place + 0.35 * (next() - 0.5)) / around) * 2 * Math.PI;
    const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
    // The leaf's farthest point from its centre, one texel clear of the border as the diamonds were.
    const reach = Math.max(...OUTLINE.map(([t, w]) => Math.hypot((t - 0.5) * length, w * widest))) + 1 / size;
    const out = 0.5 * length;
    const x = THREE.MathUtils.clamp(sprig.x + out * cos, reach, 1 - reach);
    const y = THREE.MathUtils.clamp(sprig.y + out * sin, reach, 1 - reach);
    const shade = 1 + LEAF_SHADE.spread * (2 * shadeOf() - 1);
    return { x, y, cos, sin, length, widest, reach, shade };
  });
  // Each sample's leaf shade (0 for none; the last leaf drawn over it), each leaf over the texels
  // of its bounding square only.
  const hit = new Float32Array(size * size * SUPERSAMPLE ** 2);
  const samples = size * SUPERSAMPLE;
  for (const { x, y, cos, sin, length, widest, reach, shade } of shapes) {
    const [from, to] = [
      (c: number) => Math.max(0, Math.floor((c - reach) * samples)),
      (c: number) => Math.min(samples - 1, Math.ceil((c + reach) * samples)),
    ];
    for (let sy = from(y); sy <= to(y); sy++) {
      for (let sx = from(x); sx <= to(x); sx++) {
        const du = (sx + 0.5) / samples - x,
          dv = (sy + 0.5) / samples - y;
        const along = (du * cos + dv * sin) / length + 0.5;
        if (Math.abs(dv * cos - du * sin) <= widest * halfWidth(along))
          // Darker toward the stalk, in the sprig's shade.
          hit[sy * samples + sx] = shade * (1 - LEAF_SHADE.stalk * (1 - THREE.MathUtils.clamp(along, 0, 1)));
      }
    }
  }
  const coverage = new Float32Array(size * size);
  const shade = new Float32Array(size * size);
  for (let sy = 0; sy < samples; sy++)
    for (let sx = 0; sx < samples; sx++) {
      const value = hit[sy * samples + sx];
      if (!value) continue;
      const texel = Math.floor(sy / SUPERSAMPLE) * size + Math.floor(sx / SUPERSAMPLE);
      coverage[texel] += 1 / SUPERSAMPLE ** 2;
      shade[texel] += value / SUPERSAMPLE ** 2;
    }
  // The mean over the leaves is 1, so the crowns keep their brightness.
  const total = coverage.reduce((sum, value) => sum + value, 0);
  const mean = shade.reduce((sum, value) => sum + value, 0) / Math.max(total, 1e-6);
  return {
    coverage,
    shade: shadeMean(
      coverage,
      shade.map((value) => value / mean),
    ),
  };
}

// The shade per covered area (1 where nothing covers the texel).
const shadeMean = (coverage: Float32Array, shade: Float32Array) =>
  shade.map((value, texel) => (coverage[texel] > 0 ? value / coverage[texel] : 1));

/** The shade's mips: averaged over the leaves' coverage, so the gaps do not pull it toward 1. */
export function leafShadeMips(coverage: Float32Array, shade: Float32Array, size: number): Float32Array[] {
  const levels = [shade];
  let weights = coverage;
  let sums = shade.map((value, texel) => value * coverage[texel]);
  for (let width = size / 2; width >= 1; width /= 2) {
    const [nextWeights, nextSums] = [new Float32Array(width * width), new Float32Array(width * width)];
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++)
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const from = (2 * y + dy) * width * 2 + 2 * x + dx;
          nextWeights[y * width + x] += weights[from] / 4;
          nextSums[y * width + x] += sums[from] / 4;
        }
    [weights, sums] = [nextWeights, nextSums];
    levels.push(shadeMean(weights, sums));
  }
  return levels;
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

export function createLeafClusterTexture(cluster: LeafCluster, form: LeafForm = BROADLEAF): THREE.DataTexture {
  const { coverage, shade } = leafCluster(cluster.leaves, LEAF_CLUSTER_SIZE, form);
  const shades = leafShadeMips(coverage, shade, LEAF_CLUSTER_SIZE);
  // Red: the leaves' shade; green, blue and alpha: the coverage (alphaMap reads green).
  const levels = leafClusterMips(coverage, LEAF_CLUSTER_SIZE).map((alpha, index) => {
    const width = LEAF_CLUSTER_SIZE >> index;
    const data = new Uint8Array(width * width * 4);
    alpha.forEach((value, texel) => {
      data.fill(Math.round(value * 255), texel * 4, texel * 4 + 4);
      data[texel * 4] = Math.round((Math.min(shades[index][texel], LEAF_SHADE_MAX) / LEAF_SHADE_MAX) * 255);
    });
    return { data, width, height: width };
  });
  const texture = new THREE.DataTexture(levels[0].data, LEAF_CLUSTER_SIZE, LEAF_CLUSTER_SIZE);
  texture.mipmaps = levels;
  texture.generateMipmaps = false;
  // The UVs' integer part carries the card's shell level (LEAF_SHELL_LEVELS).
  texture.wrapS = THREE.RepeatWrapping;
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
/**
 * The mask's LOD bias once a pixel spans `BIAS_FROM`→`BIAS_TO` texels (`suiLeafBias`): a blurrier mip
 * turns a leaf's coverage over more of the view's turn, where the leaves under a pixel popped by a
 * quarter of the samples at a time inside the far crowns. 0.91–0.99 times the shimmer while looking
 * around; from one texel (0.81–0.96 times) the near leaves turned into large angular shards
 * (docs/3d-qa/leaf-alpha-bias/).
 */
export const LEAF_FAR_BIAS = 1;
const BIAS_FROM = 2;
const BIAS_TO = 4;
/**
 * Levels of a card's place in its crown's outer shell (crownNormals.ts), carried in the integer part
 * of its UVs (`2 × level` added to u; the mask repeats, so the leaves are the same). Not in the
 * source: by day, far off, the outermost cards' light goes up to `LEAF_RIM` of the way to the
 * brightness of 0.6 × the air, keeping their own hue. Whole dark leaves cut out against the sky read
 * as specks around the crowns, where a real crown's thin rim is lit through by the sky. Toward the
 * air's color they turned grey like fog; fading their coverage showed the alpha-to-coverage dither
 * as a screen; at dusk the lifted rim lost the silhouette (docs/3d-qa/crown-rim/).
 */
export const LEAF_SHELL_LEVELS = 7;
export const LEAF_RIM = 0.3;

// The share of the MSAA samples a card covers, from the alpha map's (rescaled) coverage. Up close,
// the cutoff softened over a pixel, as three's alphatest_fragment does for alpha to coverage. Once
// a pixel spans more than a texel, the leaves are under a pixel and that ramp turned whole pixels
// on and off as the view moved (docs/3d-qa/leaf-shimmer); a wider ramp, centred on the cutoff,
// fades them over part of the samples instead. The mean coverage itself would thin the crowns:
// overlapping cards with the same alpha cover the same samples. Further still, the cutoff drops so
// the distant crowns fill in (the leaves seen against the sky were separate dark specks).
// The texels a pixel spans across its footprint's minor axis: far off, many; for a near card seen
// edge-on, its major axis alone spanned many too, and the far fill and rim showed the card's clear
// parts as a pale camouflaged rectangle beside the terrace.
export const LEAF_COVERAGE_GLSL = /* glsl */ `
float suiLeafFootprint( vec2 uv ) {
	vec2 dx = dFdx( uv ) * ${LEAF_FOOTPRINT_TEXELS.toFixed(1)};
	vec2 dy = dFdy( uv ) * ${LEAF_FOOTPRINT_TEXELS.toFixed(1)};
	return abs( dx.x * dy.y - dx.y * dy.x ) / max( max( length( dx ), length( dy ) ), 1e-6 );
}
float suiLeafCoverage( float alpha, vec2 uv ) {
	float footprint = suiLeafFootprint( uv );
	float ramp = max( fwidth( alpha ), ${LEAF_FAR_RAMP.toFixed(2)} * smoothstep( 1.0, 2.0, footprint ) );
	float cutoff = ${CUTOFF.toFixed(1)} - ${LEAF_FAR_FILL.toFixed(2)} * smoothstep( ${FILL_FROM.toFixed(1)}, ${FILL_TO.toFixed(1)}, footprint );
	// Below zero far off (a wide ramp under a low cutoff), the clear parts of a card keep a little
	// coverage: it joins the leaves into a mass, as measured (docs/3d-qa/crown-fill-far/).
	return smoothstep( cutoff - ramp, cutoff + ramp, alpha );
}
float suiLeafBias( vec2 uv ) {
	return ${LEAF_FAR_BIAS.toFixed(1)} * smoothstep( ${BIAS_FROM.toFixed(1)}, ${BIAS_TO.toFixed(1)}, suiLeafFootprint( uv ) );
}
// How far a card in its crown's outer shell is lifted, once its leaves are under a pixel.
float suiLeafRim( vec2 uv ) {
	float footprint = suiLeafFootprint( uv );
	float shell = min( floor( uv.x * 0.5 ), ${LEAF_SHELL_LEVELS.toFixed(1)} ) / ${LEAF_SHELL_LEVELS.toFixed(1)};
	return ${LEAF_RIM.toFixed(2)} * shell * smoothstep( 1.0, 2.0, footprint );
}
`;
export const TONE_MAPPING = '#include <tonemapping_fragment>';
const RIM_GLSL = /* glsl */ `#ifdef SUI_IRRADIANCE
	{
		vec3 suiLuma = vec3( 0.2126, 0.7152, 0.0722 );
		vec3 suiRim = gl_FragColor.rgb * ( 0.6 * dot( suiAirColor, suiLuma ) / max( dot( gl_FragColor.rgb, suiLuma ), 1e-4 ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, suiRim, suiLeafRim( vAlphaMapUv ) * ( 1.0 - suiIrradianceEvening ) );
	}
#endif
`;

export const ALPHA_TEST = '#include <alphatest_fragment>';
export const ALPHA_MAP = '#include <alphamap_fragment>';
/** three's alphamap_fragment with the far bias (`suiLeafBias`). */
export const LEAF_ALPHA_MAP = 'diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv, suiLeafBias( vAlphaMapUv ) ).g;';
/** The same in the lit pass, with the leaves' own shade (LEAF_SHADE) from the red channel. */
export const LEAF_SHADED_ALPHA_MAP = /* glsl */ `{
	vec4 suiLeafTexel = texture2D( alphaMap, vAlphaMapUv, suiLeafBias( vAlphaMapUv ) );
	diffuseColor.a *= suiLeafTexel.g;
	diffuseColor.rgb *= suiLeafTexel.r * ${LEAF_SHADE_MAX.toFixed(2)};
}`;

// alphaMap reads the green channel with the card UVs; the shadow maps cut it at a fixed 0.5, unbiased.
// Composes with an earlier onBeforeCompile.
export function applyLeafCluster(material: THREE.MeshStandardMaterial, texture: THREE.Texture) {
  material.alphaMap = texture;
  material.alphaTest = CUTOFF;
  material.alphaToCoverage = true;
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    if (
      !shader.fragmentShader.includes(ALPHA_MAP) ||
      !shader.fragmentShader.includes(ALPHA_TEST) ||
      !shader.fragmentShader.includes(TONE_MAPPING)
    )
      throw new Error('three shader chunks changed; update leafCluster.ts');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${LEAF_COVERAGE_GLSL}\nvoid main() {`)
      .replace(ALPHA_MAP, LEAF_SHADED_ALPHA_MAP)
      .replace(
        ALPHA_TEST,
        'diffuseColor.a = suiLeafCoverage( diffuseColor.a, vAlphaMapUv );\n\tif ( diffuseColor.a == 0.0 ) discard;',
      )
      // Before the distance's air (aerialPerspective.ts); by day only (the evening weight).
      .replace(TONE_MAPPING, `${RIM_GLSL}${TONE_MAPPING}`);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|leaf-cluster-shaded`;
  material.needsUpdate = true;
}
