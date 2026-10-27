import * as THREE from 'three';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';

export type SurfaceDetail = 'deck' | 'stone' | 'ground' | 'plaster' | 'linen' | 'towel' | 'heater' | 'bark' | 'gravel';

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
  // The loungers' towels and pillows (image ramps, not flattened noise).
  if (name === 'V7 | oatmeal woven towel' || name === 'V6 | fine soft linen') return 'towel';
  if (name === 'Loyly | split olivine') return 'heater';
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
// Spots where the noise passes a threshold, fading to their mean coverage once subpixel.
float suiSurfaceMask(vec3 p, float from, float to, float coverage) {
  float footprint = max(length(dFdx(p)), length(dFdy(p)));
  return mix(smoothstep(from, to, suiSurfaceNoise(p)), coverage, smoothstep(0.35, 1.2, footprint));
}
`;
// The sauna room's floor (SUI_ROOM_FLOOR, roomIrradiance.ts) is one exported slab with constant
// texture coordinates, so neither boards nor seams showed. Lay boards along world Z like the deck
// outside, with staggered end joints and dark box-filtered seams that fade to their mean coverage
// once narrower than a pixel. Contact shadows darken the floor at the stove's and the pail's feet
// (refine_loyly_props.py keeps their centers): no baked occlusion reaches there, as the room's fine
// irradiance covers only the floor under the benches, and they stood on the floor without one.
export const ROOM_FLOOR = {
  minX: -6.17,
  board: 0.145,
  length: 2.4,
  seam: 0.005,
  stove: { center: [-1.25, -1.28], radius: 0.39, reach: 0.42, depth: 0.7 },
  pail: { center: [-2.1, -1.74], radius: 0.2, reach: 0.15, depth: 0.55 },
} as const;
const g = (value: number) => value.toFixed(4);
const vec3 = (v: THREE.Vector3) => `vec3(${g(v.x)}, ${g(v.y)}, ${g(v.z)})`;
/**
 * Where the charcoal stone grows no moss: the sauna room, the deck (its stone side table), the
 * plunge and its rim, and up high.
 */
export const MOSS_FREE = {
  indoor: INTERIOR_BOX.clone().expandByScalar(0.05),
  deck: new THREE.Box3(new THREE.Vector3(-7, -1, -6), new THREE.Vector3(8, 1.5, 2.5)),
  plunge: WATER_BOX.clone().expandByVector(new THREE.Vector3(0.6, 0.5, 0.6)),
  above: 1.2,
} as const;
interface Contact {
  center: readonly [number, number];
  radius: number;
  reach: number;
  depth: number;
}
const contact = ({ center, radius, reach, depth }: Contact) =>
  `${g(depth)} * pow2(1.0 - smoothstep(-0.04, ${g(reach)}, length(suiSurfaceP.xz - vec2(${g(center[0])}, ${g(center[1])})) - ${g(radius)}))`;
const ROOM_BOARDS = /* glsl */ `
  float suiSeam = 0.0;
  float suiContact = 0.0;
  #ifdef SUI_ROOM_FLOOR
  if (abs(suiSurfaceP.y - 0.1) < 0.004 && vSuiSurfaceUp > 0.9) {
    float suiAcross = (suiSurfaceP.x - ${g(ROOM_FLOOR.minX)}) / ${g(ROOM_FLOOR.board)};
    float suiBoard = floor(suiAcross);
    float suiAlong = suiSurfaceP.z / ${g(ROOM_FLOOR.length)} + suiSurfaceHash(vec3(suiBoard, 3.1, 7.7));
    suiBoardSeed = suiSurfaceHash(vec3(suiBoard, floor(suiAlong), 1.3));
    vec2 suiSeamDistance = (0.5 - abs(fract(vec2(suiAcross, suiAlong)) - 0.5)) * vec2(${g(ROOM_FLOOR.board)}, ${g(ROOM_FLOOR.length)});
    vec2 suiPixel = max(fwidth(suiSurfaceP.xz), vec2(1e-5));
    vec2 suiSeams = clamp((${g(ROOM_FLOOR.seam / 2)} + suiPixel * 0.5 - suiSeamDistance) / suiPixel, 0.0, 1.0)
      * min(vec2(1.0), ${g(ROOM_FLOOR.seam)} / suiPixel);
    suiSeam = max(suiSeams.x, suiSeams.y);
    suiContact = max(${contact(ROOM_FLOOR.stove)}, ${contact(ROOM_FLOOR.pail)});
  }
  #endif
`;
/** The open deck's weathering: the silvered share at most, the extra board contrast and darkening. */
export const DECK_WEATHER = { silver: 0.45, boards: 0.14, darker: 0.1 };
const DECK = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiBoardSeed = 0.5;
  #ifdef USE_COLOR
    suiBoardSeed = vColor.r;
  #endif
  ${ROOM_BOARDS}
  // Deck planks run along world Z. Limit to their top near ground level;
  // the same exported ash material also appears on posts and overhead timber.
  float suiDeckTop = 1.0 - smoothstep(0.25, 0.45, abs(suiSurfaceP.y));
  float suiBend = suiSurfaceNoise(vec3(suiSurfaceP.x * 3.0, suiSurfaceP.z * 0.7, suiBoardSeed * 11.0));
  float suiGrain = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 145.0 + suiBend * 3.0, suiSurfaceP.z * 1.8, suiBoardSeed * 17.0));
  float suiFiber = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 390.0 + suiBend * 5.0, suiSurfaceP.z * 4.5, suiBoardSeed * 23.0));
  float suiDetail = (suiGrain - 0.5) * 0.30 + (suiFiber - 0.5) * 0.10;
  diffuseColor.rgb *= 1.0 + suiDeckTop * (suiDetail + (suiBoardSeed - 0.5) * 0.14);
  #ifndef SUI_ROOM_FLOOR
  // Not in the source: the open deck read as one pale, freshly sanded floor in the sun. Weathered
  // ash greys toward silver in patches of some decimeters and board by board, the boards differ
  // more, and the whole is a little darker.
  float suiWeather = suiSurfaceFilteredNoise(suiSurfaceP * vec3(0.9, 1.0, 0.35) + suiBoardSeed * 5.0);
  float suiSilver = suiDeckTop * clamp((suiWeather - 0.35) * 1.6 + (suiBoardSeed - 0.5) * 0.8, 0.0, 1.0) * ${DECK_WEATHER.silver.toFixed(2)};
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.95, 0.96, 0.98), suiSilver);
  diffuseColor.rgb *= 1.0 + suiDeckTop * ((suiBoardSeed - 0.5) * ${DECK_WEATHER.boards.toFixed(2)} - ${DECK_WEATHER.darker.toFixed(2)});
  #endif
  diffuseColor.rgb *= (1.0 - 0.65 * suiSeam) * (1.0 - suiContact);
  float suiSurfaceRoughness = suiDeckTop * ((0.5 - suiGrain) * 0.12) + suiSeam * 0.15;
  float suiSurfaceHeight = suiDeckTop * (suiGrain * 0.00022 + suiFiber * 0.00006) - suiSeam * 0.002;
`;
// Every stone read as the same flat light gray: smooth, CG-clean boulders and pavers. Each stone
// takes its own warmer or cooler tone (a field broader than most stones), mottling at a few
// centimeters to decimeters, dark mineral grains that fade to their mean coverage once subpixel,
// and a darker underside (the smooth irradiance probes light it as if the ground were not there).
// The outdoor charcoal stones (SUI_STONE_MOSS: boulders, stepping stones, the stream's rocks) grow
// moss on their shoulders, less on walked flat tops and none indoors or in the plunge, and pale
// lichen spots.
const STONE = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiTone = suiSurfaceNoise(suiSurfaceP * 0.9 + 4.7);
  float suiMottle = suiSurfaceFilteredNoise(suiSurfaceP * 3.5 + 1.3) * 0.6 + suiSurfaceFilteredNoise(suiSurfaceP * 9.0) * 0.4;
  float suiPores = suiSurfaceFilteredNoise(suiSurfaceP * 110.0);
  float suiSpeck = suiSurfaceMask(suiSurfaceP * 38.0, 0.7, 0.8, 0.1);
  vec3 suiStoneTint = mix(vec3(1.07, 1.0, 0.9), vec3(0.92, 0.98, 1.07), suiTone);
  float suiDetail = (suiMottle - 0.5) * 0.4 + (suiPores - 0.5) * 0.18;
  float suiUnder = 1.0 - smoothstep(-0.6, 0.15, vSuiSurfaceUp);
  diffuseColor.rgb *= suiStoneTint * (1.0 + suiDetail) * (1.0 - 0.4 * suiSpeck) * (1.0 - 0.35 * suiUnder);
  float suiSurfaceRoughness = (suiPores - 0.5) * 0.14;
  float suiSurfaceHeight = suiMottle * 0.0012 + suiPores * 0.00045 - suiSpeck * 0.0002;
  #ifdef SUI_STONE_MOSS
  bool suiIndoor = all(greaterThan(suiSurfaceP, ${vec3(MOSS_FREE.indoor.min)}))
    && all(lessThan(suiSurfaceP, ${vec3(MOSS_FREE.indoor.max)}));
  bool suiPlunge = all(greaterThan(suiSurfaceP, ${vec3(MOSS_FREE.plunge.min)}))
    && all(lessThan(suiSurfaceP, ${vec3(MOSS_FREE.plunge.max)}));
  bool suiOnDeck = all(greaterThan(suiSurfaceP, ${vec3(MOSS_FREE.deck.min)}))
    && all(lessThan(suiSurfaceP, ${vec3(MOSS_FREE.deck.max)}));
  if (!suiIndoor && !suiPlunge && !suiOnDeck && suiSurfaceP.y < ${g(MOSS_FREE.above)}) {
    // Shoulders and sides more than crowns, walked flat tops least.
    float suiShoulder = smoothstep(0.05, 0.45, vSuiSurfaceUp) * (1.0 - 0.85 * smoothstep(0.88, 0.99, vSuiSurfaceUp));
    float suiMossField = suiSurfaceNoise(suiSurfaceP * 1.7 + 7.1) * 0.6 + suiSurfaceFilteredNoise(suiSurfaceP * 6.0) * 0.25
      + suiSurfaceFilteredNoise(suiSurfaceP * 19.0 + 3.3) * 0.15;
    float suiMoss = smoothstep(0.56, 0.72, suiMossField * 0.85 + suiShoulder * 0.2) * suiShoulder;
    float suiMossFine = suiSurfaceFilteredNoise(suiSurfaceP * 70.0);
    vec3 suiMossColor = vec3(0.048, 0.075, 0.028) * (0.75 + 0.5 * suiMossFine) * (0.85 + 0.3 * suiTone);
    float suiLichen = suiSurfaceMask(suiSurfaceP * 26.0 + 2.9, 0.74, 0.8, 0.06) * smoothstep(-0.3, 0.2, vSuiSurfaceUp);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.42, 0.33), suiLichen * 0.4 * (1.0 - suiMoss));
    diffuseColor.rgb = mix(diffuseColor.rgb, suiMossColor, suiMoss);
    suiSurfaceRoughness += suiMoss * 0.25;
    suiSurfaceHeight += suiMoss * suiMossFine * 0.001;
  }
  #endif
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
  // Past the blades the meadow was a smooth lawn: clumps of grass with darker gaps between them
  // (decimeters to a meter, so they survive at mid distance), and, seen at a grazing angle, the
  // lighter sides and tips of the blades instead of the shaded ground between them.
  float suiClump = suiSurfaceFilteredNoise(vec3(suiSurfaceP.xz * 2.6, 5.3)) * 0.55
    + suiSurfaceFilteredNoise(vec3(suiSurfaceP.xz * 0.95, 8.9)) * 0.45;
  float suiGrazing = 1.0 - smoothstep(0.05, 0.4, normalize(cameraPosition - suiSurfaceP).y);
  suiGroundTint *= mix(vec3(1.0), vec3(1.2, 1.18, 0.86), suiGrazing * (0.3 + 0.25 * suiDry));
  diffuseColor.rgb *= suiGroundTint * (1.0 + (suiTuft - 0.5) * 0.45 + (suiBlade - 0.5) * 0.3 + (suiClump - 0.5) * 0.55);
  float suiSurfaceRoughness = (suiDry - suiLush) * 0.05;
  float suiSurfaceHeight = suiTuft * 0.004 + suiBlade * 0.0006;
`;
/**
 * The plaster wall behind the plunge (glTF axes): beyond z, between x, with a damp band above the
 * coping (1.035 m) up to about dampTop and the spillway's streaks around x = spout below streakTop.
 */
export const PLUNGE_WALL = {
  z: -4.1,
  x: [-0.25, 2.6],
  dampTop: 1.32,
  spout: 1.18,
  streakHalfWidth: 0.34,
  streakTop: 1.65,
};
const f = (v: number) => v.toFixed(3);
// Warm limestone plaster (courtyard walls and tea cups): broad trowel clouds + fine mineral grain
// matching the source 2-layer FBM (scale 8 color/bump and scale 75 fine bump), balanced around the mean.
const PLASTER = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiTrowel = suiSurfaceFilteredNoise(suiSurfaceP * 1.6) * 0.65
    + suiSurfaceFilteredNoise(suiSurfaceP * 4.8 + 2.3) * 0.35;
  float suiLimeGrain = suiSurfaceFilteredNoise(suiSurfaceP * 58.0);
  float suiPlasterVar = (suiTrowel - 0.5) * 0.36 + (suiLimeGrain - 0.5) * 0.14;
  diffuseColor.rgb *= 1.0 + vec3(suiPlasterVar * 1.02, suiPlasterVar * 1.0, suiPlasterVar * 0.96);
  // Not in the source: the wall behind the plunge, evenly lit, read as a blank sheet. Above the
  // coping it is damp in a ragged band, and under the spillway the overflow left grey streaks.
  float suiDamp = 0.0;
  if (suiSurfaceP.z < ${f(PLUNGE_WALL.z)} && suiSurfaceP.x > ${f(PLUNGE_WALL.x[0])} && suiSurfaceP.x < ${f(PLUNGE_WALL.x[1])}) {
    float suiDampEdge = ${f(PLUNGE_WALL.dampTop)} + (suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 2.4, 0.0, suiSurfaceP.x * 0.7)) - 0.5) * 0.22
      + (suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 9.0, 3.1, 0.0)) - 0.5) * 0.06;
    suiDamp = 1.0 - smoothstep(suiDampEdge - 0.14, suiDampEdge, suiSurfaceP.y);
    float suiStreak = (1.0 - smoothstep(0.08, ${f(PLUNGE_WALL.streakHalfWidth)}, abs(suiSurfaceP.x - ${f(PLUNGE_WALL.spout)})))
      * smoothstep(0.35, 0.65, suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 34.0, suiSurfaceP.y * 1.5, 0.0)))
      * (1.0 - smoothstep(${f(PLUNGE_WALL.streakTop - 0.25)}, ${f(PLUNGE_WALL.streakTop)}, suiSurfaceP.y));
    diffuseColor.rgb *= (1.0 - 0.32 * suiDamp) * mix(vec3(1.0), vec3(0.8, 0.83, 0.86), suiStreak);
  }
  float suiSurfaceRoughness = (0.5 - suiTrowel) * 0.08 + (suiLimeGrain - 0.5) * 0.06 - 0.12 * suiDamp;
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
// The loungers' oatmeal towels and linen pillows read as flat white sheets in the sun: their ramp
// tops out near 0.8 and the fold normals are faint. Pull the color down to an oatmeal beige, add a
// terry pile (a few millimeters, fading to its mean once subpixel) and a coarser weave of rows, and
// shade the draped sides and the undersides of the folds.
export const TOWEL_TINT = [0.8, 0.76, 0.67] as const;
const TOWEL = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiPile = suiSurfaceFilteredNoise(suiSurfaceP * 260.0);
  float suiRows = suiSurfaceFilteredNoise(vec3(suiSurfaceP.x * 70.0, suiSurfaceP.y * 70.0, suiSurfaceP.z * 9.0));
  float suiTowelPatch = suiSurfaceFilteredNoise(suiSurfaceP * 6.0);
  float suiTowelVar = (suiPile - 0.5) * 0.22 + (suiRows - 0.5) * 0.12 + (suiTowelPatch - 0.5) * 0.08;
  float suiDrape = mix(0.72, 1.0, smoothstep(-0.1, 0.75, vSuiSurfaceUp));
  diffuseColor.rgb *= vec3(${TOWEL_TINT.map((v) => v.toFixed(2)).join(', ')}) * (1.0 + suiTowelVar) * suiDrape;
  float suiSurfaceRoughness = 0.04;
  float suiSurfaceHeight = suiPile * 0.0007 + suiRows * 0.0004;
`;
// The heater's split olivine stones were a uniform charcoal pile. Ladled water leaves pale mineral
// scale on the upper faces of the top layer (the Cycles reference's stones read light grey from the
// sauna's bench) and each stone keeps its own tone. Under the 2700K room lights a neutral grey
// already reads warm: a warmer scale turned the pile tan. The pile tops out at 1.08m (refine_loyly_props.py).
export const HEATER_SCALE = { from: 0.88, to: 1.0, color: [0.26, 0.27, 0.29], most: 0.55 } as const;
/** The pile's ember glow: linear radiance at most, fading above `deep` and outside the `core` radius (m). */
export const HEATER_EMBER = { color: [0.16, 0.035, 0.007], deep: [0.5, 0.9], core: [0.12, 0.34] } as const;
const HEATER = /* glsl */ `
  vec3 suiSurfaceP = vSuiSurfacePosition;
  float suiScalePatch = suiSurfaceFilteredNoise(suiSurfaceP * 26.0) * 0.65 + suiSurfaceFilteredNoise(suiSurfaceP * 71.0 + 2.3) * 0.35;
  float suiScale = smoothstep(${HEATER_SCALE.from.toFixed(2)}, ${HEATER_SCALE.to.toFixed(2)}, suiSurfaceP.y)
    * smoothstep(0.15, 0.75, vSuiSurfaceUp) * smoothstep(0.42, 0.62, suiScalePatch);
  float suiStoneTone = suiSurfaceFilteredNoise(suiSurfaceP * 9.0);
  diffuseColor.rgb *= mix(vec3(0.9, 0.93, 0.97), vec3(1.12, 1.1, 1.06), suiStoneTone);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${HEATER_SCALE.color.map((v) => v.toFixed(2)).join(', ')}) * (0.85 + 0.3 * suiScalePatch),
    suiScale * ${HEATER_SCALE.most.toFixed(2)});
  float suiSurfaceRoughness = suiScale * 0.12;
  float suiSurfaceHeight = suiScalePatch * 0.0012 * suiScale;
  // Not in the source: heat. The pile read as cold stones in a basket. The stones below the top
  // layer and toward the core glow a faint ember red in uneven hot patches, most on the faces turned
  // down to the elements, seen between the top stones and through the cage.
  float suiCore = 1.0 - smoothstep(${g(HEATER_EMBER.core[0])}, ${g(HEATER_EMBER.core[1])},
    length(suiSurfaceP.xz - vec2(${g(ROOM_FLOOR.stove.center[0])}, ${g(ROOM_FLOOR.stove.center[1])})));
  float suiDeep = 1.0 - smoothstep(${g(HEATER_EMBER.deep[0])}, ${g(HEATER_EMBER.deep[1])}, suiSurfaceP.y);
  float suiHot = smoothstep(0.45, 0.8, suiSurfaceFilteredNoise(suiSurfaceP * 13.0 + 5.1));
  totalEmissiveRadiance += vec3(${HEATER_EMBER.color.map(g).join(', ')}) * suiDeep * mix(0.3, 1.0, suiCore)
    * mix(0.3, 1.0, clamp(0.5 - 0.5 * vSuiSurfaceUp, 0.0, 1.0)) * mix(0.1, 1.0, suiHot);
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
  towel: TOWEL,
  heater: HEATER,
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

/** The stone materials that grow moss outdoors (not the pale pavers or the plunge's rim). */
export const MOSSY_STONE = /charcoal stone$/;

export function applySurfaceDetails(material: THREE.MeshStandardMaterial, kind: SurfaceDetail) {
  if (kind === 'stone' && MOSSY_STONE.test(material.name))
    material.defines = { ...material.defines, SUI_STONE_MOSS: '' };
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    patchSurfaceDetailShader(shader, kind);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|surface-details-${kind}-v1`;
  material.needsUpdate = true;
}
