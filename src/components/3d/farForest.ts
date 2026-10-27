import * as THREE from 'three';
import type { Season } from './season';
import { AIR_GLSL } from './aerialPerspective';

// A band of distant forest behind the woodland (radius 10–44m), in front of the ridges (72m and
// beyond): the sky showed between the woodland's thin trunks and tufts down to the horizon, so it
// read as a few trees on bare hills rather than a wood. A backing ring of crown silhouettes, like
// the ridges (gardenDetails.ts): rounded broadleaf crowns and pointed evergreens (about a third),
// tops 5–9m above y=0, below the ridges' crest as seen from the deck (taller, the band made the
// skyline and its smooth domes and cones read as hills and rocky peaks), with ragged leafy outlines,
// darker toward the foot, hazed with the same air color. Each crown has its own shade; the season changes the
// colors (autumn reds and ochres, grey-brown crowns in winter among the evergreens, fresh green
// in spring) and the time of day and the overcast darken them as they do the ridges.
// Crown impostors in front of the ring supply depth, sharing the unlit material: dense leafy crowns
// baked in Blender (scripts/bake_forest_impostors.py) as their normal, the light of an open sky on
// their leaves and their coverage, lit here by the scene's fixed sun; not seasonally rebaked.

export const FAR_FOREST_RADIUS = 54;
const SEGMENTS = 1440;
/** Ground under the band (the terrain lies about 2m up out there) and the understory's top. */
const BASE = -4;
const UNDERSTORY = 4.5;
/** How deep (m) the ragged foliage cuts into the outline. */
const FRAY = 1.2;
/** How far (m) a front crown's impostor stays under its crown's top. */
const FRONT_DROP = 0.2;
/**
 * The impostor atlas (scripts/bake_forest_impostors.py): tiles of 6.4 × 12.8 m, the tree standing on
 * the tile's bottom edge with its top 0.25m under the tile's; the first five broadleaf, the rest
 * evergreen. An impostor spans the crown's height from the foot of the band (BASE).
 */
export const IMPOSTOR_FILE = 'forest-impostors.webp';
const IMPOSTOR_COLUMNS = 4;
const IMPOSTOR_ROWS = 2;
const IMPOSTOR_BROADLEAF = 5;
const IMPOSTOR_TILES = 8;
const IMPOSTOR_TOP = 12.55 / 12.8;
const IMPOSTOR_BROADEN = 1.3;
/**
 * The impostors' light over the square root of the zenith sky's light on their leaves (about 0.14,
 * 0.33 and 0.57 at the 10th, 50th and 90th percentiles): lobes lit on top, dark beneath and between.
 */
const IMPOSTOR_SHADE_FLOOR = 0.2;
const IMPOSTOR_SHADE_SKY = 1.9;
/**
 * Bare broadleaf crowns in winter: how much deeper the outline frays, the share of the leaf-mass
 * contrast taken away, and how much of the air behind shows through the twigs.
 */
const BARE_FRAY = 0.8;
const BARE_LEAF_KEPT = 0.75;
const BARE_SEE_THROUGH = 0.45;
/** A bare impostor keeps only its densest leaves' share of coverage: the twigs thin out the crown. */
const BARE_COVERAGE = 0.72;

interface Crown {
  /** Angle (rad), half width (m), top (m above y=0) and per-crown shade and pick in [0, 1). */
  angle: number;
  radius: number;
  top: number;
  evergreen: boolean;
  shade: number;
  pick: number;
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The crowns around the ring, 2.2–4m apart, in a deterministic order. */
export function farForestCrowns(): Crown[] {
  const random = seeded(0xf0e5);
  const crowns: Crown[] = [];
  const circumference = Math.PI * 2 * FAR_FOREST_RADIUS;
  for (let along = 0; along < circumference - 2; along += 2.2 + random() * 1.8) {
    const angle = along / FAR_FOREST_RADIUS;
    const evergreen = random() < 0.35;
    // Taller stands and lower gaps over a few tens of meters, so the ridges show in places.
    const stand = 7 + 1.1 * Math.sin(angle * 5 + 1.3) + 0.7 * Math.sin(angle * 13 + 0.4);
    crowns.push({
      angle,
      radius: evergreen ? 1.1 + random() * 0.6 : 1.6 + random() * 1.4,
      top: stand + (random() - 0.5) * 1.6,
      evergreen,
      shade: random(),
      pick: random(),
    });
  }
  return crowns;
}

/** Height of a crown's outline at `d` meters from its axis, or -Infinity outside it. */
export function crownHeight(crown: Crown, d: number) {
  const t = Math.abs(d) / crown.radius;
  if (t >= 1) return -Infinity;
  // Rounded leaders and uneven branch shoulders instead of identical straight cones.
  // Fade the lobes at the axis and rim; keep every crown below its original top.
  const side = d / crown.radius;
  const lobes = Math.sin(side * 10 + crown.pick * 6) * Math.sin(t * Math.PI) * 0.16;
  if (crown.evergreen) return crown.top - crown.radius * Math.max(0, 2 * Math.pow(t, 1.35) + lobes);
  return crown.top - crown.radius * Math.max(0, 1.15 * (1 - Math.sqrt(1 - t * t)) + lobes * 0.65);
}

// Display-referred tints (sRGB) at full daylight, before the time of day and the haze.
const BROADLEAF: Record<Season, number[]> = {
  spring: [0x6f8a4a, 0x7f9a52, 0x627c43],
  summer: [0x4d6339, 0x56703f, 0x435933],
  autumn: [0x9a6532, 0x8e4a2e, 0xa8853e, 0x6f6c3a, 0x5d6b3e],
  winter: [0x6e6660, 0x77706a, 0x655e59],
};
const EVERGREEN: Record<Season, number[]> = {
  spring: [0x3e5640, 0x465f45],
  summer: [0x37503b, 0x3f5841],
  autumn: [0x37503b, 0x3f5841],
  winter: [0x4c5c52, 0x56655b],
};

export function createFarForest(hazeColor: { value: THREE.Color }) {
  const crowns = farForestCrowns();
  // The crown drawn at each segment: the highest one there, or none over the understory.
  const owner = new Int32Array(SEGMENTS).fill(-1);
  const heights = new Float32Array(SEGMENTS + 1);
  const step = (Math.PI * 2) / SEGMENTS;
  const span = (crown: Crown, a: number) => {
    let d = a - crown.angle;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    return d * FAR_FOREST_RADIUS;
  };
  const outline = (a: number) => {
    let best = UNDERSTORY;
    let who = -1;
    for (const [i, crown] of crowns.entries()) {
      const h = crownHeight(crown, span(crown, a));
      if (h > best) {
        best = h;
        who = i;
      }
    }
    // Lumpy leafy edges, about one bump per meter (sharper ones read as a saw blade); half on the evergreens.
    if (who >= 0) {
      const s = a * FAR_FOREST_RADIUS;
      const jag = 0.22 * Math.sin(s * 3.1) + 0.14 * Math.sin(s * 5.3 + 1) + 0.07 * Math.sin(s * 9.7 + 2);
      best += jag * (crowns[who].evergreen ? 0.5 : 1);
    }
    return [best, who] as const;
  };
  for (let j = 0; j <= SEGMENTS; j++) heights[j] = outline(j * step)[0];
  for (let j = 0; j < SEGMENTS; j++) owner[j] = outline((j + 0.5) * step)[1];
  const positions: number[] = [];
  // Indexed: the volumes' facets share their vertices (the band's quads do not).
  const indices: number[] = [];
  let vertices = 0;
  // A continuous radial relief shared by both owners of every segment boundary.
  // Using the quad's owner here would split the band at overlapping crowns.
  const relief = Array.from({ length: SEGMENTS + 1 }, (_, j) => {
    const a = j * step;
    let depth = 0;
    for (const crown of crowns) {
      const t = Math.abs(span(crown, a)) / crown.radius;
      if (t < 1) depth = Math.max(depth, (1.4 + crown.shade * 0.8) * (1 - t * t) ** 2);
    }
    return depth;
  });
  // 0 at the foot, 1 at the understory's top and above: darker under the canopy.
  const lift: number[] = [];
  // The top of the crown each quad belongs to, so every crown is lit at its top and darker below.
  const tops: number[] = [];
  // The outline over each vertex (the crown's or the understory's top): the shader frays the foliage below it.
  const edges: number[] = [];
  const crownOf: number[] = [];
  const depths: number[] = [];
  const sides: number[] = [];
  const band: number[] = [];
  // The impostors' place in the atlas and their mirroring (±1; 0 on the band).
  const uvs: number[] = [];
  const impostor: number[] = [];
  const at = (
    j: number,
    y: number,
    top: number,
    edge: number,
    radius = FAR_FOREST_RADIUS,
    crown = owner[Math.min(j, SEGMENTS - 1)],
    // The crown whose tint (and bareness) the vertex takes: none at the foot, where the understory
    // runs on under every crown (owned, a bare or a dark evergreen crown made a block of its own
    // down to the ground beside the next, once the volumes in front no longer hid the band).
    tinted = y === BASE ? -1 : crown,
  ) => {
    const a = j * step;
    // Push the shoulder toward the clearing, tapering into the buried foot and
    // crown tip. Preserve the original heights, frayed edge and closed horizon.
    const rise = THREE.MathUtils.clamp((y - BASE) / (UNDERSTORY - BASE), 0, 1);
    const tip = THREE.MathUtils.clamp((y - UNDERSTORY) / Math.max(0.1, heights[j] - UNDERSTORY), 0, 1);
    radius -= relief[j] * rise * (1 - 0.55 * tip);
    positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    indices.push(vertices++);
    crownOf.push(tinted);
    uvs.push(0, 0);
    impostor.push(0);
    band.push(1);
    sides.push(crown >= 0 ? (span(crowns[crown], a) * (radius / FAR_FOREST_RADIUS)) / crowns[crown].radius : 0);
    depths.push((radius - 47) / 7);
    lift.push(Math.max(0, Math.min(1, (y - BASE) / (UNDERSTORY - BASE))));
    tops.push(top);
    edges.push(edge);
  };
  for (let j = 0; j < SEGMENTS; j++) {
    const top = owner[j] >= 0 ? crowns[owner[j]].top : UNDERSTORY;
    const a = heights[j];
    const b = heights[j + 1];
    // The understory, then the crowns over it, so the foot shades smoothly into the canopy.
    for (const [lo, hiA, hiB] of [
      [BASE, UNDERSTORY, UNDERSTORY],
      [UNDERSTORY, a, b],
    ] as const) {
      if (hiA <= lo && hiB <= lo) continue;
      // Under a crown, the understory's outline is the crown's: at the crown's sides, where it meets
      // the understory's top, the fray goes on across both. With none there (once the volumes in front
      // hid it), the understory under a crown kept a flat top beside the frayed one, as a block with
      // straight sides where the crowns end. A crown's side may fall below the understory's top (the
      // quad then narrows to a triangle).
      const [edgeA, edgeB] = [Math.max(a, hiA, lo), Math.max(b, hiB, lo)];
      at(j, lo, top, edgeA, FAR_FOREST_RADIUS, owner[j]);
      at(j, hiA, top, edgeA, FAR_FOREST_RADIUS, owner[j]);
      at(j + 1, hiB, top, edgeB, FAR_FOREST_RADIUS, owner[j]);
      at(j, lo, top, edgeA, FAR_FOREST_RADIUS, owner[j]);
      at(j + 1, hiB, top, edgeB, FAR_FOREST_RADIUS, owner[j]);
      at(j + 1, lo, top, edgeB, FAR_FOREST_RADIUS, owner[j]);
    }
  }
  // In front of the band, an impostor for every crown in three ranks: the band still closes the
  // horizon, and the impostors stand outside the real woodland, their tops under the band's crowns.
  for (const [i, crown] of crowns.entries()) {
    // A sparse second rank fills selected gaps between the front crowns; the remaining exposed
    // cutouts get a farther crown, overlapping the band instead of leaving a row of flat silhouettes.
    const backing = i % 6 === 0;
    const far = i % 6 === 3;
    const distance = far ? 51.9 + crown.shade * 0.2 : backing ? 51.2 + crown.shade * 0.5 : 48 + crown.shade * 3;
    // The front crowns once stopped 1.1m short of the band behind: its crown tips then stood over them
    // alone, cut by the fray into stalks and knobs like chimney pots (docs/3d-qa/forest-outline/).
    // Rising to the tips, the nearer crowns hide them.
    const top = crown.top - (far ? 0.1 : backing ? 0.25 : FRONT_DROP);
    // Standing on the band's foot, below the terrain, its tree's top at the crown's.
    const height = (top - BASE) / IMPOSTOR_TOP;
    // The baked broadleaf crowns are about 4m across: widened toward the clumps' 3–6m.
    const width = (height / 2) * (crown.evergreen ? 1 : IMPOSTOR_BROADEN);
    const radial = new THREE.Vector3(Math.cos(crown.angle), 0, Math.sin(crown.angle));
    // The viewer's right, facing out from the clearing.
    const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
    const kind = crown.evergreen
      ? IMPOSTOR_BROADLEAF + Math.floor(crown.pick * (IMPOSTOR_TILES - IMPOSTOR_BROADLEAF))
      : Math.floor(crown.pick * IMPOSTOR_BROADLEAF);
    const mirror = crown.shade < 0.5 ? 1 : -1;
    const u0 = (kind % IMPOSTOR_COLUMNS) / IMPOSTOR_COLUMNS;
    const u1 = u0 + 1 / IMPOSTOR_COLUMNS;
    // The atlas' top row first (an ImageBitmap is not flipped).
    const v0 = Math.floor(kind / IMPOSTOR_COLUMNS) / IMPOSTOR_ROWS;
    const v1 = v0 + 1 / IMPOSTOR_ROWS;
    const first = vertices;
    for (const [side, up] of [
      [-1, 0],
      [1, 0],
      [1, 1],
      [-1, 1],
    ] as const) {
      const position = radial
        .clone()
        .multiplyScalar(distance)
        .addScaledVector(tangent, (side * width) / 2);
      position.y = BASE + up * height;
      positions.push(position.x, position.y, position.z);
      const left = mirror > 0 ? side < 0 : side > 0;
      uvs.push(left ? u0 : u1, up ? v0 : v1);
      impostor.push(mirror);
      crownOf.push(i);
      band.push(0);
      sides.push(0);
      depths.push(Math.max(0, Math.min(1, (distance - 47) / 7)));
      lift.push(Math.max(0, Math.min(1, (position.y - BASE) / (UNDERSTORY - BASE))));
      tops.push(top);
      // Impostors have their own outline: no band fray. The larger sentinel also lets QA omit
      // just the far rank in a same-build control.
      edges.push(far ? 2e4 : 1e4);
    }
    vertices += 4;
    // Facing the clearing (the material is double-sided either way).
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const colors = new Float32Array(positions.length);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('gardenLift', new THREE.Float32BufferAttribute(lift, 1));
  geometry.setAttribute('gardenCrownTop', new THREE.Float32BufferAttribute(tops, 1));
  geometry.setAttribute('gardenEdge', new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute('gardenCrownSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.setAttribute('gardenBand', new THREE.Float32BufferAttribute(band, 1));
  geometry.setAttribute('gardenDepth', new THREE.Float32BufferAttribute(depths, 1));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('gardenImpostor', new THREE.BufferAttribute(Int8Array.from(impostor), 1));
  // The broadleaf crowns, bare in winter.
  const broadleaf = new Uint8Array(crownOf.length);
  for (let v = 0; v < crownOf.length; v++) broadleaf[v] = crowns[crownOf[v]] && !crowns[crownOf[v]].evergreen ? 255 : 0;
  geometry.setAttribute('gardenBroadleaf', new THREE.BufferAttribute(broadleaf, 1, true));
  const bare = { value: 0 };
  // The share of the shading that the sun gives: the clear day's (lighting.ts), none at dusk,
  // night or under overcast, when the crowns are lit by the sky alone.
  const sunlit = { value: 1 };
  // Until the atlas arrives (setImpostors), a clear texel: the impostors draw nothing and the band
  // alone closes the horizon. The same map keeps the same program.
  const placeholder = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  placeholder.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, map: placeholder });
  material.name = 'Garden far forest';
  // The shader frays the outline and cuts the impostors out with discard; an alpha test (never failed:
  // the alpha is 1) keeps the forest out of the depth prepass, whose depth would hide the sky behind.
  material.alphaTest = 0.01;
  material.alphaToCoverage = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gardenHazeColor = hazeColor;
    shader.uniforms.gardenBare = bare;
    shader.uniforms.gardenSun = sunlit;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float gardenBroadleaf;\nvarying float vGardenBroadleaf;\nattribute float gardenBand;\nvarying float vGardenBand;\nattribute float gardenCrownSide;\nvarying float vGardenSide;\nattribute float gardenDepth;\nvarying float vGardenDepth;\nattribute float gardenLift;\nattribute float gardenCrownTop;\nattribute float gardenEdge;\nattribute float gardenImpostor;\nvarying float vGardenImpostor;\nvarying float vGardenLift;\nvarying float vGardenTop;\nvarying float vGardenEdge;\nvarying vec3 vGardenPosition;\nvarying float vGardenAir;',
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGardenAir = length(mvPosition.xyz);')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGardenBroadleaf = gardenBroadleaf;\nvGardenBand = gardenBand;\nvGardenSide = gardenCrownSide;\nvGardenDepth = gardenDepth;\nvGardenLift = gardenLift;\nvGardenTop = gardenCrownTop;\nvGardenEdge = gardenEdge;\nvGardenImpostor = gardenImpostor;\nvGardenPosition = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vGardenBroadleaf;
        uniform float gardenBare;
        uniform float gardenSun;
        varying float vGardenBand;
        varying float vGardenSide;
        varying float vGardenDepth;
        varying float vGardenLift;
        varying float vGardenTop;
        varying float vGardenEdge;
        varying float vGardenImpostor;
        varying vec3 vGardenPosition;
        varying float vGardenAir;
        uniform vec3 gardenHazeColor;
        ${AIR_GLSL}
        float gardenForestHash(vec2 p) {
          vec3 q = fract(p.xyx * 0.1031);
          q += dot(q, q.yzx + 33.33);
          return fract((q.x + q.y) * q.z);
        }
        float gardenForestNoise(vec2 p) {
          vec2 cell = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gardenForestHash(cell), gardenForestHash(cell + vec2(1, 0)), f.x),
            mix(gardenForestHash(cell + vec2(0, 1)), gardenForestHash(cell + vec2(1, 1)), f.x), f.y);
        }`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        // Bare broadleaf crowns in winter: twigs thin out toward the outline, so it frays deeper.
        float gardenBareCrown = vGardenBroadleaf * gardenBare;
        // SUI_FAR_CROWN_CONTROL
        // Ragged foliage along the outline: the smooth domes and cones read as hills and rocky
        // peaks. Leafy masses (about 0.45m and 0.2m) cut up to ${FRAY.toFixed(1)}m into the crowns, gone
        // where they would be finer than a pixel.
        vec2 gardenEdgeArc = vec2(atan(vGardenPosition.z, vGardenPosition.x) * ${FAR_FOREST_RADIUS.toFixed(1)}, vGardenPosition.y);
        float gardenFine = 1.0 - smoothstep(0.08, 0.2, max(length(dFdx(gardenEdgeArc)), length(dFdy(gardenEdgeArc))));
        float gardenRag = gardenForestNoise(gardenEdgeArc * 2.2) * 0.65 + mix(0.5, gardenForestNoise(gardenEdgeArc * 5.0 + 7.7), gardenFine) * 0.35;
        if (vGardenEdge - vGardenPosition.y < (gardenRag - 0.3) * ${FRAY.toFixed(1)} * (1.0 + ${BARE_FRAY.toFixed(1)} * gardenBareCrown)) discard;
        // An impostor's crown: its normal across and up, the light of an open sky on its leaves, and
        // its coverage. A bare crown in winter keeps only its densest leaves, with gaps between twigs.
        // Sampled outside the branch, where its derivatives are defined.
        vec4 gardenCrown = texture2D(map, vMapUv);
        if (vGardenImpostor != 0.0) {
          // Gaps of about 0.3m between the twigs.
          float gardenTwigGap = gardenForestNoise(vMapUv * vec2(${(IMPOSTOR_COLUMNS * 20).toFixed(1)}, ${(IMPOSTOR_ROWS * 40).toFixed(1)}));
          // Its outline over a pixel's samples (alpha to coverage) rather than a stepped cut.
          float gardenCut = mix(0.5, ${BARE_COVERAGE.toFixed(2)}, gardenBareCrown);
          gardenCrown.a = smoothstep(gardenCut - 0.5 * fwidth(gardenCrown.a), gardenCut + 0.5 * fwidth(gardenCrown.a), gardenCrown.a);
          if (gardenCrown.a == 0.0 || gardenTwigGap < 0.42 * gardenBareCrown) discard;
        }`,
      )
      .replace('#include <map_fragment>', '')
      // The impostors' coverage over the samples; the band and the fray are whole or discarded.
      .replace('#include <alphatest_fragment>', '')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 gardenArc = vec2(atan(vGardenPosition.z, vGardenPosition.x) * ${FAR_FOREST_RADIUS.toFixed(1)}, vGardenPosition.y);
        float gardenFootprint = max(length(dFdx(gardenArc)), length(dFdy(gardenArc)));
        if (vGardenImpostor != 0.0) {
          // The baked normal in the impostor's frame (mirrored with it), toward the clearing.
          vec2 gardenRadial = normalize(vGardenPosition.xz);
          vec2 gardenAcross = (gardenCrown.xy * 2.0 - 1.0) * vec2(vGardenImpostor, 1.0);
          vec3 gardenNormal = vec3(-gardenRadial.y, 0.0, gardenRadial.x) * gardenAcross.x + vec3(0.0, gardenAcross.y, 0.0)
            - vec3(gardenRadial.x, 0.0, gardenRadial.y) * sqrt(max(0.0, 1.0 - dot(gardenAcross, gardenAcross)));
          // The scene's fixed sun (lighting.ts) by day; without it, its mean over a crown.
          float gardenSunlit = mix(0.3, max(0.0, dot(gardenNormal, vec3(-0.556, 0.6178, 0.556))), gardenSun);
          // Brighter on top and on the sun's side, as the clumps were; darker within, by the sky's light.
          diffuseColor.rgb *= (0.72 + 0.45 * gardenNormal.y + 0.66 * gardenSunlit)
            * (${IMPOSTOR_SHADE_FLOOR.toFixed(2)} + ${IMPOSTOR_SHADE_SKY.toFixed(2)} * gardenCrown.b);
          diffuseColor.a = gardenCrown.a;
        } else {
        // Clumps of foliage (about 0.7m and 2m), each crown lit at its top and shaded below where
        // the next crown overlaps, darker under the canopy; then the air between, more toward the
        // foot (valley mist).
        float gardenDetail = 1.0 - smoothstep(0.18, 0.65, gardenFootprint);
        float gardenClump = mix(0.5, gardenForestNoise(gardenArc * vec2(1.4, 2.1)), gardenDetail) * 0.6
          + gardenForestNoise(gardenArc * 0.5 + 3.1) * 0.4;
        // A rounded crown facing the clearing: broad light on one shoulder, shaded opposite
        // shoulder, and larger branch masses within it. No additional light or shadow pass.
        float gardenSide = clamp(vGardenSide, -1.0, 1.0);
        float gardenRound = sqrt(max(0.0, 1.0 - gardenSide * gardenSide));
        // The backing crowns share the world's fixed sun direction (lighting.ts), rather
        // than every crown having its left shoulder lit. A broad upper dome and side
        // normals imply volume without adding silhouette detail or a shadow pass.
        vec2 gardenRadial = normalize(vGardenPosition.xz);
        vec3 gardenInward = vec3(-gardenRadial.x, 0.0, -gardenRadial.y);
        vec3 gardenTangent = vec3(-gardenRadial.y, 0.0, gardenRadial.x);
        float gardenUp = smoothstep(vGardenTop - 3.2, vGardenTop + 0.4, vGardenPosition.y) * 0.8;
        vec3 gardenNormal = normalize((gardenInward * gardenRound + gardenTangent * gardenSide)
          * sqrt(1.0 - gardenUp * gardenUp) + vec3(0.0, gardenUp, 0.0));
        // Without the sun (dusk, night, overcast) the lit shoulder gives way to its mean.
        float gardenSunlit = mix(0.3, max(0.0, dot(gardenNormal, vec3(-0.556, 0.6178, 0.556))), gardenSun);
        // Soft fill retains detail in the unlit crowns. Darker lateral recesses separate
        // adjacent masses; this is a shape cue, not traced inter-tree occlusion.
        float gardenRecess = mix(0.84, 1.0, smoothstep(0.0, 0.55, gardenRound));
        float gardenDirectional = (0.78 + 0.66 * gardenSunlit) * gardenRecess;
        diffuseColor.rgb *= (0.64 + 0.64 * gardenClump) * gardenDirectional;
        }
        diffuseColor.rgb *= mix(0.76, 1.12, smoothstep(vGardenTop - 4.5, vGardenTop - 0.3, vGardenPosition.y));
        diffuseColor.rgb *= mix(0.62, 1.0, vGardenLift);
        // Foreground remains darker and clearer; backing crowns recede into the air.
        diffuseColor.rgb *= mix(0.72, 1.0, vGardenDepth);
        // Leaf masses (about 0.9m) over the band, each lighter on its upper side with dark gaps
        // between: smooth shading alone read as a painted backdrop beside the speckled woodland.
        // Gone where a mass would be under about four pixels; the impostors have their own leaves.
        float gardenLeafDetail = (1.0 - smoothstep(0.12, 0.3, gardenFootprint)) * vGardenBand;
        vec2 gardenLeafP = gardenArc / 0.9;
        vec2 gardenLeafCell = floor(gardenLeafP);
        float gardenLeafNear = 8.0;
        vec2 gardenLeafOffset = vec2(0.0);
        for (int i = -1; i <= 1; i++) {
          for (int j = -1; j <= 1; j++) {
            vec2 c = gardenLeafCell + vec2(i, j);
            vec2 d = gardenLeafP - c - vec2(gardenForestHash(c), gardenForestHash(c + 17.0));
            float r = dot(d, d);
            if (r < gardenLeafNear) {
              gardenLeafNear = r;
              gardenLeafOffset = d;
            }
          }
        }
        float gardenLeaf = (1.0 - smoothstep(0.35, 0.8, sqrt(gardenLeafNear)))
          * (0.75 + 0.5 * clamp(gardenLeafOffset.y * 1.4 + 0.5, 0.0, 1.0));
        diffuseColor.rgb *= mix(1.0, 0.42 + 0.95 * gardenLeaf, gardenLeafDetail * (1.0 - ${BARE_LEAF_KEPT.toFixed(2)} * gardenBareCrown));
        // A bare crown is a lace of twigs: fine upright branches over the air seen through them,
        // not the leaf masses above (grey-brown masses read as boulders and smoke).
        if (gardenBareCrown > 0.0) {
          float gardenTwig = mix(0.5, gardenForestNoise(gardenArc * vec2(7.0, 1.6)), 1.0 - smoothstep(0.05, 0.16, gardenFootprint));
          diffuseColor.rgb *= mix(1.0, 0.82 + 0.36 * gardenTwig, gardenBareCrown);
          diffuseColor.rgb = mix(diffuseColor.rgb, gardenHazeColor, ${BARE_SEE_THROUGH.toFixed(2)} * gardenBareCrown);
        }
        // The same air as the lit woodland in front (aerialPerspective.ts), and mist at the foot.
        float haze = suiAirAmount(vGardenAir);
        // SUI_FAR_AIR_CONTROL
        haze += mix(0.04, 0.14, vGardenDepth) * (1.0 - smoothstep(0.0, 9.0, vGardenPosition.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, gardenHazeColor, haze);`,
      );
  };
  material.customProgramCacheKey = () => 'garden-far-forest-v15';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = material.name;
  const tint = new THREE.Color();
  let painted: Season | null = null;
  const paint = (season: Season) => {
    painted = season;
    for (let v = 0; v < crownOf.length; v++) {
      const crown = crowns[crownOf[v]];
      if (!crown) {
        // Between crowns, the understory and the trunks behind it: a mean of the season's tints.
        tint.setHex(BROADLEAF[season][0]).lerp(tint.clone().setHex(EVERGREEN[season][0]), 0.5);
      } else {
        const palette = crown.evergreen ? EVERGREEN[season] : BROADLEAF[season];
        tint.setHex(palette[Math.floor(crown.pick * palette.length)]);
        tint.multiplyScalar(0.86 + 0.28 * crown.shade);
      }
      tint.toArray(colors, v * 3);
    }
    geometry.attributes.color.needsUpdate = true;
  };
  return {
    mesh,
    crowns: crowns.length,
    /** The baked crowns (IMPOSTOR_FILE), not flipped, without color space; the mesh's disposal frees it. */
    setImpostors(texture: THREE.Texture) {
      if (material.map === texture) return;
      material.map?.dispose();
      material.map = texture;
    },
    /** The light on the band, as the ridges' (the color of the material multiplies the tints). */
    update(season: Season, light: THREE.Color, sun = 1) {
      if (painted !== season) paint(season);
      sunlit.value = sun;
      bare.value = season === 'winter' ? 1 : 0;
      material.color.copy(light);
    },
  };
}
