import * as THREE from 'three';

export type SurfaceDetail = 'deck' | 'stone' | 'ground' | 'plaster' | 'linen' | 'bark' | 'gravel';

// Keep indoor timber, pool tiles, glass and the submerged stone/light materials out.
export function surfaceDetailOf(name: string): SurfaceDetail | null {
  if (/^V2 \| outdoor ash \/ grain & wear$|^V7 \| locally damp ash(?:\.\d+)?$/.test(name)) return 'deck';
  if (['V2 | mineral charcoal stone', 'V2 | pale mineral paving', 'Garden mineral charcoal stone'].includes(name))
    return 'stone';
  // The rolling moss terrain and the forest floor around it; the moss garden by the opening keeps its flat color.
  if (['V9 | layered living moss', 'V3 | moss and woodland earth'].includes(name)) return 'ground';
  // Materials whose source FBM noise ramps were flattened to their mean color at export (`procedural_flat_color`).
  if (name === 'Warm limestone plaster') return 'plaster';
  if (name === 'Unbleached linen') return 'linen';
  if (name === 'Tree bark') return 'bark';
  if (name === 'Fine garden gravel') return 'gravel';
  return null;
}

const COMMON = '#include <common>';
const PROJECT = '#include <project_vertex>';
const ROUGHNESS = '#include <roughnessmap_fragment>';
const NORMAL = '#include <normal_fragment_maps>';
const PARS = /* glsl */ `
varying vec3 vSuiSurfacePosition;
varying float vSuiSurfaceUp;
float suiSurfaceHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float suiSurfaceNoise(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(suiSurfaceHash(cell), suiSurfaceHash(cell + vec3(1,0,0)), f.x),
        mix(suiSurfaceHash(cell + vec3(0,1,0)), suiSurfaceHash(cell + vec3(1,1,0)), f.x), f.y),
    mix(mix(suiSurfaceHash(cell + vec3(0,0,1)), suiSurfaceHash(cell + vec3(1,0,1)), f.x),
        mix(suiSurfaceHash(cell + vec3(0,1,1)), suiSurfaceHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
// Average subpixel texture towards its mean, including in low-resolution reflections.
float suiSurfaceFilteredNoise(vec3 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(suiSurfaceNoise(p), 0.5, smoothstep(0.35, 1.2, footprint));
}
`;
const DECK = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiBoardSeed = 0.5;
  #ifdef USE_COLOR
    suiBoardSeed = vColor.r;
  #endif
  // Deck planks run along world Z. Limit to their top near ground level;
  // the same exported ash material also appears on posts and overhead timber.
  float suiDeckTop = 1.0 - smoothstep(0.25, 0.45, abs(suiSurfaceP.y));
  float suiBend = suiSurfaceNoise(vec3(suiSurfaceP.x * 3.0, suiSurfaceP.z * 0.7, suiBoardSeed * 11.0));
  float suiGrain = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 145.0 + suiBend * 3.0, suiSurfaceP.z * 1.8, suiBoardSeed * 17.0));
  float suiFiber = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 390.0 + suiBend * 5.0, suiSurfaceP.z * 4.5, suiBoardSeed * 23.0));
  float suiDetail = (suiGrain - 0.5) * 0.30 + (suiFiber - 0.5) * 0.10;
  diffuseColor.rgb *= 1.0 + suiDeckTop * (suiDetail + (suiBoardSeed - 0.5) * 0.14);
  float suiSurfaceRoughness = suiDeckTop * ((0.5 - suiGrain) * 0.12);
  float suiSurfaceHeight = suiDeckTop * (suiGrain * 0.00022 + suiFiber * 0.00006);
`;
const STONE = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiMineral = suiSurfaceFilteredNoise(suiSurfaceP * 9.0);
  float suiPores = suiSurfaceFilteredNoise(suiSurfaceP * 110.0);
  float suiDetail = (suiMineral - 0.5) * 0.12 + (suiPores - 0.5) * 0.18;
  diffuseColor.rgb *= 1.0 + suiDetail;
  float suiSurfaceRoughness = (suiPores - 0.5) * 0.14;
  float suiSurfaceHeight = suiMineral * 0.0007 + suiPores * 0.00045;
`;
// The source moss noise repeats every meter or so and averages to one flat green beyond a few
// meters. Broad patches keep the meadow readable at mid distance: drier yellow-green and lusher
// dark green (balanced around the source color), drier crests, earthier steep slopes, and tufts
// and blades near the camera that fade to their mean.
const GROUND = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiBroad = suiSurfaceNoise(vec3(suiSurfaceP.xz * 0.07, 0.0)) * 0.65
    + suiSurfaceNoise(vec3(suiSurfaceP.xz * 0.19 + 3.1, 1.7)) * 0.35;
  float suiCrest = smoothstep(0.2, 2.2, suiSurfaceP.y);
  float suiDry = smoothstep(0.45, 0.72, suiBroad + suiCrest * 0.12);
  float suiLush = 1.0 - smoothstep(0.24, 0.5, suiBroad + suiCrest * 0.12);
  float suiSlope = 1.0 - smoothstep(0.82, 0.96, abs(vSuiSurfaceUp));
  float suiTuft = suiSurfaceFilteredNoise(suiSurfaceP * 1.7);
  float suiBlade = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 42.0, suiSurfaceP.y * 9.0, suiSurfaceP.z * 42.0));
  vec3 suiGroundTint = mix(vec3(1.0), vec3(1.7, 1.42, 0.72), suiDry * 0.85);
  suiGroundTint = mix(suiGroundTint, vec3(0.6, 0.76, 0.72), suiLush * 0.85);
  suiGroundTint = mix(suiGroundTint, vec3(1.15, 0.85, 0.62), suiSlope * 0.7);
  diffuseColor.rgb *= suiGroundTint * (1.0 + (suiTuft - 0.5) * 0.45 + (suiBlade - 0.5) * 0.3);
  float suiSurfaceRoughness = (suiDry - suiLush) * 0.05;
  float suiSurfaceHeight = suiTuft * 0.004 + suiBlade * 0.0006;
`;
// Warm limestone plaster (courtyard walls and tea cups): broad trowel clouds + fine mineral grain
// matching the source 2-layer FBM (scale 8 color/bump and scale 75 fine bump), balanced around the mean.
const PLASTER = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiTrowel = suiSurfaceFilteredNoise(suiSurfaceP * 1.6) * 0.65
    + suiSurfaceFilteredNoise(suiSurfaceP * 4.8 + 2.3) * 0.35;
  float suiLimeGrain = suiSurfaceFilteredNoise(suiSurfaceP * 58.0);
  float suiPlasterVar = (suiTrowel - 0.5) * 0.36 + (suiLimeGrain - 0.5) * 0.14;
  diffuseColor.rgb *= 1.0 + vec3(suiPlasterVar * 1.02, suiPlasterVar * 1.0, suiPlasterVar * 0.96);
  float suiSurfaceRoughness = (0.5 - suiTrowel) * 0.08 + (suiLimeGrain - 0.5) * 0.06;
  float suiSurfaceHeight = suiTrowel * 0.0022 + suiLimeGrain * 0.00045;
`;
// Unbleached linen (sauna plaque and thermometer numerals): fine woven cross-threads and slub
// variation around the exported ramp midpoint.
const LINEN = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiWeft = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 160.0, suiSurfaceP.y * 42.0, suiSurfaceP.z * 160.0));
  float suiWarp = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 42.0, suiSurfaceP.y * 160.0, suiSurfaceP.z * 42.0 + 5.7));
  float suiSlub = suiSurfaceFilteredNoise(suiSurfaceP * 28.0);
  float suiLinenVar = (suiWeft + suiWarp - 1.0) * 0.18 + (suiSlub - 0.5) * 0.22;
  diffuseColor.rgb *= 1.0 + suiLinenVar;
  float suiSurfaceRoughness = (0.5 - suiSlub) * 0.05;
  float suiSurfaceHeight = (suiWeft + suiWarp) * 0.00028 + suiSlub * 0.00035;
`;
// Tree bark (overhead boughs and woodland trunks): elongated vertical ridges and coarse fissures
// that fade cleanly to the mean on distant branches so crown shimmer does not increase.
const BARK = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiBarkWarp = suiSurfaceFilteredNoise(suiSurfaceP * 2.4);
  vec3 suiBarkCoord = vec3(
    suiSurfaceP.x * 14.0 + (suiBarkWarp - 0.5) * 1.8,
    suiSurfaceP.y * 3.8,
    suiSurfaceP.z * 14.0 - (suiBarkWarp - 0.5) * 1.8
  );
  float suiFurrow = suiSurfaceFilteredNoise(suiBarkCoord);
  float suiFlake = suiSurfaceFilteredNoise(suiBarkCoord * 3.2 + 4.1);
  float suiBarkVar = (suiFurrow - 0.5) * 0.52 + (suiFlake - 0.5) * 0.22;
  diffuseColor.rgb *= 1.0 + vec3(suiBarkVar * 1.06, suiBarkVar * 0.98, suiBarkVar * 0.88);
  float suiSurfaceRoughness = (0.5 - suiFurrow) * 0.08;
  float suiSurfaceHeight = suiFurrow * 0.0032 + suiFlake * 0.0009;
`;
// Fine garden gravel: multi-scale mineral pebbles and fine grit around the ramp mean.
const GRAVEL = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiPatch = suiSurfaceFilteredNoise(suiSurfaceP * 2.8);
  float suiPebble = suiSurfaceFilteredNoise(suiSurfaceP * 32.0) * 0.65
    + suiSurfaceFilteredNoise(suiSurfaceP * 78.0 + 3.7) * 0.35;
  float suiGravelVar = (suiPatch - 0.5) * 0.24 + (suiPebble - 0.5) * 0.46;
  diffuseColor.rgb *= 1.0 + vec3(suiGravelVar * 1.04, suiGravelVar * 1.0, suiGravelVar * 0.94);
  float suiSurfaceRoughness = (suiPebble - 0.5) * 0.12;
  float suiSurfaceHeight = suiPebble * 0.0018 + suiPatch * 0.0008;
`;
const BUMP = /* glsl */ `
  // Surface-gradient bump in view space, layered over the existing normal map.
  vec3 suiDx = dFdx(-vViewPosition), suiDy = dFdy(-vViewPosition);
  vec3 suiRx = cross(suiDy, normal), suiRy = cross(normal, suiDx);
  float suiDet = dot(suiDx, suiRx) * faceDirection;
  vec3 suiGradient = sign(suiDet) * (dFdx(suiSurfaceHeight) * suiRx + dFdy(suiSurfaceHeight) * suiRy);
  normal = normalize(max(abs(suiDet), 1e-10) * normal - suiGradient);
`;

const DETAILS: Record<SurfaceDetail, string> = {
  deck: DECK,
  stone: STONE,
  ground: GROUND,
  plaster: PLASTER,
  linen: LINEN,
  bark: BARK,
  gravel: GRAVEL,
};

export function patchSurfaceDetailShader(
  shader: { vertexShader: string; fragmentShader: string },
  kind: SurfaceDetail,
) {
  if (
    !shader.vertexShader.includes(COMMON) ||
    !shader.vertexShader.includes(PROJECT) ||
    !shader.fragmentShader.includes(COMMON) ||
    !shader.fragmentShader.includes(ROUGHNESS) ||
    !shader.fragmentShader.includes(NORMAL)
  )
    throw Error('Unsupported three.js shader chunks for surface details');
  shader.vertexShader = shader.vertexShader
    .replace(COMMON, `${COMMON}\nvarying vec3 vSuiSurfacePosition;\nvarying float vSuiSurfaceUp;`)
    .replace(
      PROJECT,
      `${PROJECT}\nvSuiSurfacePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSuiSurfaceUp = normalize(mat3(modelMatrix) * objectNormal).y;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(COMMON, `${COMMON}\n${PARS}`)
    // Runs after the image ramp, before winter snow overwrites color/roughness.
    .replace(
      ROUGHNESS,
      `${DETAILS[kind]}\n${ROUGHNESS}\nroughnessFactor = clamp(roughnessFactor + suiSurfaceRoughness, 0.32, 1.0);`,
    )
    .replace(NORMAL, `${NORMAL}\n${BUMP}`);
}

export function applySurfaceDetails(material: THREE.MeshStandardMaterial, kind: SurfaceDetail) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patchSurfaceDetailShader(shader, kind);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|surface-details-${kind}-v1`;
  material.needsUpdate = true;
}
