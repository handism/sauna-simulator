import * as THREE from 'three';
import { TURNS_TO_VIEWER } from './crownNormals';

// Restrict the treatment to existing outdoor surfaces, timber, the garden accents' shrubs and the
// ferns and evergreen crowns (which stood bright green on the white ground otherwise). The timber
// shader excludes the sheltered room/terrace by position; water, glass, towels,
// lamps and pool tiles never receive the extension.
export function receivesWinterSnow(name: string) {
  return /moss|woodland earth|garden gravel|tree bark|mineral charcoal stone|pale mineral paving|quiet honed stone|outdoor ash|locally damp ash|warm open-grain timber|garden evergreen foliage|^evergreen foliage$|fern \d|card evergreen$/i.test(
    name,
  );
}

/** The open deck's boards: along world Z, `pitch` apart from `x0`, out to `end` (the exported deck). */
export const DECK_BOARDS = { x0: -0.145, pitch: 0.2, end: 2.844 };
/**
 * The deck's snow, from its outer end: each board's reach (m) — a field `across` boards per board
 * mixed with each board's `own` share — how far the drifts move it, the ragged edge's depth (a
 * wave of about a meter across the boards and finer tatters), the thin margin over which the cover
 * builds up, the layer's depth for the bump, and how far in front of the edge loose clumps lie.
 */
export const DECK_SNOW = {
  reach: [0.5, 1.0],
  across: 0.3,
  own: 0.15,
  drift: 0.35,
  fray: 0.26,
  thin: 0.05,
  depth: 0.02,
  clumps: 0.45,
};

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

/**
 * The snowfield's broad tone (not in the source): the noise frequencies (per meter) of the scoured
 * and banked stretches, their colors, and the color of the snow on slopes (full by a slope of
 * about 40°).
 */
export const SNOW_FIELD = {
  frequency: [0.045, 0.13],
  scoured: [0.84, 0.88, 0.95],
  banked: 1.03,
  slope: [0.8, 0.86, 0.95],
};

// Thin settled snow on upward surfaces, with a soft irregular boundary. A uniform white read as a
// blank sheet: the snow lies in drifts a few meters across with finer swells and wind ripples (in
// its color and as a bump that shades with the light), thins on steeper ground so the relief
// shows, and is a little darker and bluer in the hollows between drifts.
/**
 * Not in the source: the evergreen crowns' facing toward the sky taken as `scale` × up + `lift`,
 * so snow lies on their sides down to a little below level, still in clumps.
 */
export const CROWN_SNOW = { scale: 0.6, lift: 0.48 };
const SNOW = /* glsl */ `
  vec3 suiSnowP = vSuiSnowPosition;
  float suiSnowUp = normalize(vSuiSnowNormal).y;
  #if ${TURNS_TO_VIEWER}
  suiSnowUp *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  float suiSnowGrain = sin(suiSnowP.x * 3.1 + sin(suiSnowP.z * 2.7)) * sin(suiSnowP.z * 4.3);
  float suiSnowDrift = suiSnowNoise(suiSnowP.xz * 0.28) * 0.6 + suiSnowNoise(suiSnowP.xz * 0.9 + 7.3) * 0.4;
  float suiSnowSwell = suiSnowFiltered(suiSnowP.xz * 3.2 + 1.9);
  // Ripples about 13cm apart across the wind, bent by the drifts; gone once finer than a pixel.
  float suiSnowRippleFootprint = max(length(dFdx(suiSnowP.xz)), length(dFdy(suiSnowP.xz))) * 48.0 / 6.2832;
  float suiSnowRipple = sin(dot(suiSnowP.xz, vec2(38.4, 28.8)) + suiSnowDrift * 9.0)
    * (1.0 - smoothstep(0.15, 0.5, suiSnowRippleFootprint));
  #ifdef SUI_SNOW_CROWN
  // CROWN_SNOW: a crown's cards face every way around its ellipsoid, and only the top few held
  // snow: the evergreens stood as dark summer broadleaf crowns among the bare trees.
  suiSnowUp = suiSnowUp * ${CROWN_SNOW.scale.toFixed(2)} + ${CROWN_SNOW.lift.toFixed(2)};
  #endif
  float suiSnowCover = smoothstep(0.42, 0.88, suiSnowUp + suiSnowGrain * 0.07 + (suiSnowDrift - 0.5) * 0.2);
  // Preserve the sauna, pool and sheltered deck; their roof tops remain eligible.
  bool suiSheltered = suiSnowP.x > -7.1 && suiSnowP.x < 7.1 && suiSnowP.z > -5.3 && suiSnowP.z < 2.9 && suiSnowP.y < 3.35;
  // The deck runs on past the roofs' edge (z 0.74) to 2.84 under the open sky. Bare to its edge, it
  // met the white garden in a hard line: there, snow lies along the outer meter (the walked middle
  // kept clear; a soft, partial cover read as stains on the boards). Its edge ends board by board,
  // ragged across each board and thin over its last centimeters: one smooth wave across all the
  // boards read as a white shape painted on the deck (docs/3d-qa/deck-snow-edge/).
  float suiOpenDeck = 0.0;
  if (suiSnowP.y < 0.5) {
    float suiBoard = floor((suiSnowP.x - ${DECK_BOARDS.x0.toFixed(3)}) / ${DECK_BOARDS.pitch.toFixed(2)});
    // Neighbouring boards differ by part of the range: independent reaches stepped like piano keys.
    float suiShare = mix(suiSnowNoise(vec2(suiBoard * ${DECK_SNOW.across.toFixed(2)}, 5.1)), suiSnowHash(vec2(suiBoard, 3.7)), ${DECK_SNOW.own.toFixed(2)});
    float suiReach = ${DECK_SNOW.reach[0].toFixed(2)} + ${(DECK_SNOW.reach[1] - DECK_SNOW.reach[0]).toFixed(2)} * suiShare
      + (suiSnowDrift - 0.5) * ${DECK_SNOW.drift.toFixed(2)};
    // A wave across the boards and finer tatters: with each board's own reach dominant, the edge
    // stepped like piano keys in one line across the deck.
    float suiFray = (suiSnowFiltered(suiSnowP.xz * vec2(2.3, 1.1) + 2.3) - 0.5) * ${DECK_SNOW.fray.toFixed(2)}
      + (suiSnowFiltered(suiSnowP.xz * vec2(9.0, 4.0) + 6.1) - 0.5) * ${(DECK_SNOW.fray * 0.45).toFixed(3)}
      + (suiSnowFiltered(suiSnowP.xz * 40.0) - 0.5) * ${(DECK_SNOW.fray * 0.25).toFixed(3)};
    float suiInside = suiSnowP.z - (${DECK_BOARDS.end.toFixed(3)} - suiReach) + suiFray;
    // Loose clumps on the boards just in front of the edge, fewer further in.
    float suiClump = smoothstep(0.66, 0.74, suiSnowFiltered(suiSnowP.xz * vec2(7.0, 4.0) + 9.4) + 0.12 * suiInside / ${DECK_SNOW.clumps.toFixed(2)})
      * (1.0 - smoothstep(0.0, ${DECK_SNOW.clumps.toFixed(2)}, -suiInside));
    suiOpenDeck = max(smoothstep(0.0, ${DECK_SNOW.thin.toFixed(2)}, suiInside), suiClump * step(suiInside, 0.0));
  }
  suiSnowCover *= (suiSheltered ? suiOpenDeck : 1.0) * suiWinterSnow;
  #ifdef SUI_SNOW_DUSTING
  // Fronds hold only a dusting in clumps; fully covered they read as white cut-outs.
  suiSnowCover *= 0.1 + 0.35 * smoothstep(0.35, 0.75, suiSnowFiltered(suiSnowP.xz * 7.0));
  #endif
  #ifdef SUI_SNOW_CROWN
  // Evergreen crowns hold snow in clumps on their upper side (the crown normal faces out of the
  // crown, crownNormals.ts); with a dusting alone they stood summer green among the bare trees.
  suiSnowCover *= 0.3 + 0.6 * smoothstep(0.3, 0.7, suiSnowFiltered(vec2(suiSnowP.x + suiSnowP.y * 0.7, suiSnowP.z - suiSnowP.y * 0.5) * 2.2));
  #endif
  vec3 suiSnowColor = mix(vec3(0.64, 0.71, 0.82), vec3(0.82, 0.85, 0.88), smoothstep(0.2, 0.7, suiSnowDrift));
  suiSnowColor *= 0.97 + (suiSnowSwell - 0.5) * 0.08;
  // Past twenty meters the drifts are finer than the eye resolves and the field read as one flat
  // white: wind-scoured and banked stretches tens of meters across, and the slopes, turned from
  // the open sky, a little bluer and darker (SNOW_FIELD).
  float suiSnowField = suiSnowNoise(suiSnowP.xz * ${SNOW_FIELD.frequency[0].toFixed(3)}) * 0.6 + suiSnowNoise(suiSnowP.xz * ${SNOW_FIELD.frequency[1].toFixed(3)} + 3.1) * 0.4;
  suiSnowColor *= mix(vec3(${SNOW_FIELD.scoured.map((v) => v.toFixed(3)).join(', ')}), vec3(${SNOW_FIELD.banked.toFixed(3)}), smoothstep(0.25, 0.75, suiSnowField));
  suiSnowColor *= mix(vec3(${SNOW_FIELD.slope.map((v) => v.toFixed(3)).join(', ')}), vec3(1.0), smoothstep(0.78, 0.99, suiSnowUp));
  diffuseColor.rgb = mix(diffuseColor.rgb, suiSnowColor, suiSnowCover);
  roughnessFactor = mix(roughnessFactor, 0.92, suiSnowCover);
  float suiSnowHeight = suiSnowDrift * 0.16 + suiSnowSwell * 0.012 + suiSnowRipple * 0.0018;
  // The deck's snow stands as a layer whose edge rises over its thin margin, catching the light.
  if (suiSheltered) suiSnowHeight += suiOpenDeck * ${DECK_SNOW.depth.toFixed(3)};
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

/** Thin, broken-up cover for fine fronds. */
export function dustedByWinterSnow(name: string) {
  return /fern \d/i.test(name);
}

/** Clumped cover on the upper side of the evergreen crowns (the woodland cards and the body's evergreen trees). */
export function crownedByWinterSnow(name: string) {
  return /card evergreen$|^evergreen foliage$/i.test(name);
}

export function applyWinterSnow(material: THREE.MeshStandardMaterial, amount: { value: number }) {
  const dusting = dustedByWinterSnow(material.name);
  const crown = crownedByWinterSnow(material.name);
  if (dusting) material.defines = { ...material.defines, SUI_SNOW_DUSTING: '' };
  if (crown) material.defines = { ...material.defines, SUI_SNOW_CROWN: '' };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.suiWinterSnow = amount;
    patchWinterSnowShader(shader);
  };
  material.customProgramCacheKey = () =>
    `${previousKey.call(material)}|winter-snow-v2${dusting ? '-dust' : ''}${crown ? '-crown' : ''}`;
  material.needsUpdate = true;
}
