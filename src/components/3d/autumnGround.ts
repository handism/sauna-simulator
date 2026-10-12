import * as THREE from 'three';

// Autumn on the rolling moss terrain and the forest floor (surfaceDetails.ts `ground`): the grass
// dries toward olive and straw, more on the dry patches and crests, and fallen leaves lie over it
// in drifts. In autumn the trees turned while the meadow stayed summer green (season.ts recolors
// only leaves). Each leaf is an ellipse in a 9cm cell with its own turn, size and color (red,
// orange, ochre or brown); where a cell is about a pixel or less the leaves fade to their mean
// cover and color, so the far meadow shows a warm tint instead of shimmering dots. Snow is drawn
// after it and covers it.

const ROUGHNESS = '#include <roughnessmap_fragment>';

const PARS = /* glsl */ `
uniform float suiAutumnGround;
float suiAutumnHash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float suiAutumnNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(suiAutumnHash(cell), suiAutumnHash(cell + vec2(1, 0)), f.x),
    mix(suiAutumnHash(cell + vec2(0, 1)), suiAutumnHash(cell + vec2(1, 1)), f.x), f.y);
}
`;

/** Leaf cell size (m), leaf half axes as a share of it and the leaf colors' mean (linear albedo). */
export const LEAF_CELL = 0.09;
export const LEAF_AXES = [0.42, 0.22] as const;
const LEAF_COLORS = [
  [0.33, 0.07, 0.025],
  [0.42, 0.15, 0.03],
  [0.4, 0.26, 0.06],
  [0.17, 0.09, 0.035],
] as const;
const glslColor = (c: readonly number[]) => `vec3(${c.map((v) => v.toFixed(3)).join(', ')})`;
const MEAN = LEAF_COLORS.reduce((sum, c) => sum.map((v, i) => v + c[i] / LEAF_COLORS.length), [0, 0, 0]);
/** Share of a full cell one leaf ellipse covers. */
const LEAF_AREA = (Math.PI * LEAF_AXES[0] * LEAF_AXES[1]).toFixed(4);

// Runs after the surface details' ground tint (it reads its position, dry patches and slope),
// before the roughness map and the snow.
const AUTUMN = /* glsl */ `
  if (suiAutumnGround > 0.0) {
    // Dry grass: olive and straw, most on the dry patches and crests, least on the lush ones.
    float suiAutumnDry = suiAutumnGround * clamp(0.45 + 0.45 * suiDry - 0.35 * suiLush, 0.0, 1.0);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(1.25, 1.0, 0.6), suiAutumnDry);
    // Fallen leaves gather in drifts a few meters across and slide off steep slopes.
    float suiAutumnDrift = smoothstep(0.3, 0.75, suiAutumnNoise(suiSurfaceP.xz * 0.35 + 5.1));
    float suiAutumnShare = suiAutumnGround * (0.06 + 0.3 * suiAutumnDrift) * (1.0 - suiSlope * 0.8);
    vec2 suiLeafP = suiSurfaceP.xz / ${LEAF_CELL.toFixed(3)};
    vec2 suiLeafCell = floor(suiLeafP);
    float suiLeafSeed = suiAutumnHash(suiLeafCell + 17.3);
    vec2 suiLeafCenter = suiLeafCell + 0.5 + (vec2(suiAutumnHash(suiLeafCell + 3.7), suiAutumnHash(suiLeafCell + 9.1)) - 0.5) * 0.3;
    float suiLeafTurn = suiLeafSeed * 6.2832;
    vec2 suiLeafD = mat2(cos(suiLeafTurn), -sin(suiLeafTurn), sin(suiLeafTurn), cos(suiLeafTurn)) * (suiLeafP - suiLeafCenter);
    float suiLeafSize = 0.75 + 0.5 * suiAutumnHash(suiLeafCell + 23.9);
    float suiLeafR = length(suiLeafD / (vec2(${LEAF_AXES[0]}, ${LEAF_AXES[1]}) * suiLeafSize));
    float suiLeafPixels = max(length(dFdx(suiLeafP)), length(dFdy(suiLeafP)));
    float suiLeaf = (1.0 - smoothstep(1.0 - suiLeafPixels * 3.0, 1.0, suiLeafR))
      * step(suiAutumnHash(suiLeafCell + 31.3), suiAutumnShare / ${LEAF_AREA});
    float suiLeafPick = suiAutumnHash(suiLeafCell + 41.7) * 4.0;
    vec3 suiLeafColor = suiLeafPick < 1.0 ? ${glslColor(LEAF_COLORS[0])}
      : suiLeafPick < 2.0 ? ${glslColor(LEAF_COLORS[1])}
      : suiLeafPick < 3.0 ? ${glslColor(LEAF_COLORS[2])} : ${glslColor(LEAF_COLORS[3])};
    suiLeafColor *= 0.8 + 0.4 * suiLeafSeed;
    // Beyond about a pixel per cell, the mean: the share of ground the leaves cover, in their mean color.
    float suiLeafFar = smoothstep(0.35, 1.0, suiLeafPixels);
    float suiLeafCover = mix(suiLeaf, min(suiAutumnShare, 1.0), suiLeafFar);
    diffuseColor.rgb = mix(diffuseColor.rgb, mix(suiLeafColor, ${glslColor(MEAN)}, suiLeafFar), suiLeafCover);
    suiSurfaceRoughness += suiLeafCover * 0.08;
  }
`;

export function patchAutumnGroundShader(shader: { fragmentShader: string }) {
  if (!shader.fragmentShader.includes(ROUGHNESS) || !shader.fragmentShader.includes('float suiDry'))
    throw Error('Autumn ground needs the surface details ground shader');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${PARS}`)
    .replace(ROUGHNESS, `${AUTUMN}\n${ROUGHNESS}`);
}

/** Adds the autumn ground to a material that already has the `ground` surface details. */
export function applyAutumnGround(material: THREE.MeshStandardMaterial, amount: { value: number }) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.suiAutumnGround = amount;
    patchAutumnGroundShader(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|autumn-ground-v1`;
  material.needsUpdate = true;
}
