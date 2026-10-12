import * as THREE from 'three';

export type SurfaceDetail = 'deck' | 'stone';

// Keep indoor timber, pool tiles, glass and the submerged stone/light materials out.
export function surfaceDetailOf(name: string): SurfaceDetail | null {
  if (/^V2 \| outdoor ash \/ grain & wear$|^V7 \| locally damp ash(?:\.\d+)?$/.test(name)) return 'deck';
  if (['V2 | mineral charcoal stone', 'V2 | pale mineral paving', 'Garden mineral charcoal stone'].includes(name))
    return 'stone';
  return null;
}

const COMMON = '#include <common>';
const PROJECT = '#include <project_vertex>';
const ROUGHNESS = '#include <roughnessmap_fragment>';
const NORMAL = '#include <normal_fragment_maps>';
const PARS = /* glsl */ `
varying vec3 vSuiSurfacePosition;
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
const BUMP = /* glsl */ `
  // Surface-gradient bump in view space, layered over the existing normal map.
  vec3 suiDx = dFdx(-vViewPosition), suiDy = dFdy(-vViewPosition);
  vec3 suiRx = cross(suiDy, normal), suiRy = cross(normal, suiDx);
  float suiDet = dot(suiDx, suiRx) * faceDirection;
  vec3 suiGradient = sign(suiDet) * (dFdx(suiSurfaceHeight) * suiRx + dFdy(suiSurfaceHeight) * suiRy);
  normal = normalize(max(abs(suiDet), 1e-10) * normal - suiGradient);
`;

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
    .replace(COMMON, `${COMMON}\nvarying vec3 vSuiSurfacePosition;`)
    .replace(PROJECT, `${PROJECT}\nvSuiSurfacePosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace(COMMON, `${COMMON}\n${PARS}`)
    // Runs after the image ramp, before winter snow overwrites color/roughness.
    .replace(
      ROUGHNESS,
      `${kind === 'deck' ? DECK : STONE}\n${ROUGHNESS}\nroughnessFactor = clamp(roughnessFactor + suiSurfaceRoughness, 0.32, 1.0);`,
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
