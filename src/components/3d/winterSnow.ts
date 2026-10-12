import * as THREE from 'three';

// Restrict the treatment to existing outdoor surfaces, timber, the garden accents' shrubs and the
// ferns and evergreen crowns (which stood bright green on the white ground otherwise). The timber
// shader excludes the sheltered room/terrace by position; water, glass, towels,
// lamps and pool tiles never receive the extension.
export function receivesWinterSnow(name: string) {
  return /moss|woodland earth|garden gravel|tree bark|mineral charcoal stone|pale mineral paving|quiet honed stone|outdoor ash|warm open-grain timber|garden evergreen foliage|fern \d|card evergreen$/i.test(
    name,
  );
}

const PARS = /* glsl */ `
uniform float suiWinterSnow;
varying vec3 vSuiSnowPosition;
varying vec3 vSuiSnowNormal;
float suiSnowHash(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float suiSnowNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(suiSnowHash(cell), suiSnowHash(cell + vec2(1, 0)), f.x),
    mix(suiSnowHash(cell + vec2(0, 1)), suiSnowHash(cell + vec2(1, 1)), f.x), f.y);
}
// Fades to the mean where a cell spans about a pixel or less.
float suiSnowFiltered(vec2 p) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(suiSnowNoise(p), 0.5, smoothstep(0.35, 1.2, footprint));
}
`;

// Thin settled snow on upward surfaces, with a soft irregular boundary. A uniform white read as a
// blank sheet: the snow lies in drifts a few meters across with finer swells and wind ripples (in
// its color and as a bump that shades with the light), thins on steeper ground so the relief
// shows, and is a little darker and bluer in the hollows between drifts.
const SNOW = /* glsl */ `
  vec3 suiSnowP = vSuiSnowPosition;
  float suiSnowUp = normalize(vSuiSnowNormal).y;
  #ifdef DOUBLE_SIDED
  suiSnowUp *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  float suiSnowGrain = sin(suiSnowP.x * 3.1 + sin(suiSnowP.z * 2.7)) * sin(suiSnowP.z * 4.3);
  float suiSnowDrift = suiSnowNoise(suiSnowP.xz * 0.28) * 0.6 + suiSnowNoise(suiSnowP.xz * 0.9 + 7.3) * 0.4;
  float suiSnowSwell = suiSnowFiltered(suiSnowP.xz * 3.2 + 1.9);
  // Ripples about 13cm apart across the wind, bent by the drifts; gone once finer than a pixel.
  float suiSnowRippleFootprint = max(length(dFdx(suiSnowP.xz)), length(dFdy(suiSnowP.xz))) * 48.0 / 6.2832;
  float suiSnowRipple = sin(dot(suiSnowP.xz, vec2(38.4, 28.8)) + suiSnowDrift * 9.0)
    * (1.0 - smoothstep(0.15, 0.5, suiSnowRippleFootprint));
  float suiSnowCover = smoothstep(0.42, 0.88, suiSnowUp + suiSnowGrain * 0.07 + (suiSnowDrift - 0.5) * 0.2);
  // Preserve the sauna, pool and sheltered deck; their roof tops remain eligible.
  bool suiSheltered = suiSnowP.x > -7.1 && suiSnowP.x < 7.1 && suiSnowP.z > -5.3 && suiSnowP.z < 2.9 && suiSnowP.y < 3.35;
  suiSnowCover *= suiSheltered ? 0.0 : suiWinterSnow;
  #ifdef SUI_SNOW_DUSTING
  // Fronds hold only a dusting in clumps; fully covered they read as white cut-outs.
  suiSnowCover *= 0.1 + 0.35 * smoothstep(0.35, 0.75, suiSnowFiltered(suiSnowP.xz * 7.0));
  #endif
  vec3 suiSnowColor = mix(vec3(0.64, 0.71, 0.82), vec3(0.82, 0.85, 0.88), smoothstep(0.2, 0.7, suiSnowDrift));
  suiSnowColor *= 0.97 + (suiSnowSwell - 0.5) * 0.08;
  diffuseColor.rgb = mix(diffuseColor.rgb, suiSnowColor, suiSnowCover);
  roughnessFactor = mix(roughnessFactor, 0.92, suiSnowCover);
  float suiSnowHeight = suiSnowDrift * 0.16 + suiSnowSwell * 0.012 + suiSnowRipple * 0.0018;
`;

// Surface-gradient bump in view space, blended in by the cover so bare surfaces keep their normal.
const SNOW_BUMP = /* glsl */ `
  vec3 suiSnowDx = dFdx(-vViewPosition), suiSnowDy = dFdy(-vViewPosition);
  vec3 suiSnowRx = cross(suiSnowDy, normal), suiSnowRy = cross(normal, suiSnowDx);
  float suiSnowDet = dot(suiSnowDx, suiSnowRx) * faceDirection;
  vec3 suiSnowGradient = sign(suiSnowDet) * (dFdx(suiSnowHeight) * suiSnowRx + dFdy(suiSnowHeight) * suiSnowRy);
  normal = normalize(mix(normal, normalize(max(abs(suiSnowDet), 1e-10) * normal - suiSnowGradient), suiSnowCover));
`;

export function patchWinterSnowShader(shader: { vertexShader: string; fragmentShader: string }) {
  const common = '#include <common>';
  const project = '#include <project_vertex>';
  const roughness = '#include <roughnessmap_fragment>';
  const normal = '#include <normal_fragment_maps>';
  if (
    !shader.vertexShader.includes(project) ||
    !shader.vertexShader.includes(common) ||
    !shader.fragmentShader.includes(roughness) ||
    !shader.fragmentShader.includes(normal) ||
    !shader.fragmentShader.includes(common)
  )
    throw Error('Unsupported three.js shader chunks for winter snow');
  shader.vertexShader = shader.vertexShader
    .replace(common, `${common}\nvarying vec3 vSuiSnowPosition;\nvarying vec3 vSuiSnowNormal;`)
    .replace(
      project,
      `${project}\nvSuiSnowPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSuiSnowNormal = inverseTransformDirection(transformedNormal, viewMatrix);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(common, `${common}\n${PARS}`)
    .replace(roughness, `${roughness}\n${SNOW}`)
    .replace(normal, `${normal}\n${SNOW_BUMP}`);
}

/** Thin, broken-up cover for fine fronds and the evergreen crowns' leaf cards. */
export function dustedByWinterSnow(name: string) {
  return /fern \d|card evergreen$/i.test(name);
}

export function applyWinterSnow(material: THREE.MeshStandardMaterial, amount: { value: number }) {
  const dusting = dustedByWinterSnow(material.name);
  if (dusting) material.defines = { ...material.defines, SUI_SNOW_DUSTING: '' };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.suiWinterSnow = amount;
    patchWinterSnowShader(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|winter-snow-v2${dusting ? '-dust' : ''}`;
  material.needsUpdate = true;
}
