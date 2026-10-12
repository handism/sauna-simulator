import * as THREE from 'three';
import type { Season } from './season';

// A band of distant forest behind the woodland (radius 10–44m), in front of the ridges (72m and
// beyond): the sky showed between the woodland's thin trunks and tufts down to the horizon, so it
// read as a few trees on bare hills rather than a wood. One unlit ring of crown silhouettes, like
// the ridges (gardenDetails.ts): rounded broadleaf crowns and pointed evergreens (about a third),
// tops 6–13m above y=0 so the ridges still rise above the lower stands, darker toward the
// foot, hazed with the same air color. Each crown has its own shade; the season changes the
// colors (autumn reds and ochres, bare grey-brown twigs in winter among the evergreens, fresh green
// in spring) and the time of day and the overcast darken them as they do the ridges.

export const FAR_FOREST_RADIUS = 54;
const SEGMENTS = 1440;
/** Ground under the band (the terrain lies about 2m up out there) and the understory's top. */
const BASE = -4;
const UNDERSTORY = 4.5;

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
    const stand = 9.5 + 2.2 * Math.sin(angle * 5 + 1.3) + 1.4 * Math.sin(angle * 13 + 0.4);
    crowns.push({
      angle,
      radius: evergreen ? 1.3 + random() * 0.8 : 1.6 + random() * 1.4,
      top: stand + (random() - 0.5) * 2.6,
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
  // Evergreens taper to a point; broadleaves are rounded domes over a short skirt.
  if (crown.evergreen) return crown.top - Math.pow(t, 0.85) * crown.radius * 2;
  return crown.top - crown.radius * 1.15 * (1 - Math.sqrt(1 - t * t));
}

// Display-referred tints (sRGB) at full daylight, before the time of day and the haze.
const BROADLEAF: Record<Season, number[]> = {
  spring: [0x6f8a4a, 0x7f9a52, 0x627c43],
  summer: [0x4d6339, 0x56703f, 0x435933],
  autumn: [0x8a5a32, 0x8e4a2e, 0x957540, 0x6e5634],
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
  // 0 at the foot, 1 at the understory's top and above: darker under the canopy.
  const lift: number[] = [];
  // The top of the crown each quad belongs to, so every crown is lit at its top and darker below.
  const tops: number[] = [];
  const at = (j: number, y: number, top: number) => {
    const a = j * step;
    positions.push(Math.cos(a) * FAR_FOREST_RADIUS, y, Math.sin(a) * FAR_FOREST_RADIUS);
    lift.push(Math.max(0, Math.min(1, (y - BASE) / (UNDERSTORY - BASE))));
    tops.push(top);
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
      at(j, lo, top);
      at(j, hiA, top);
      at(j + 1, hiB, top);
      at(j, lo, top);
      at(j + 1, hiB, top);
      at(j + 1, lo, top);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const colors = new Float32Array(positions.length);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('gardenLift', new THREE.Float32BufferAttribute(lift, 1));
  geometry.setAttribute('gardenCrownTop', new THREE.Float32BufferAttribute(tops, 1));
  // The segment of each vertex, for the seasonal recoloring.
  const segmentOf: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    const count = (heights[j] > UNDERSTORY || heights[j + 1] > UNDERSTORY ? 2 : 1) * 6;
    for (let k = 0; k < count; k++) segmentOf.push(j);
  }
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.name = 'Garden far forest';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gardenHazeColor = hazeColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float gardenLift;\nattribute float gardenCrownTop;\nvarying float vGardenLift;\nvarying float vGardenTop;\nvarying vec3 vGardenPosition;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGardenLift = gardenLift;\nvGardenTop = gardenCrownTop;\nvGardenPosition = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vGardenLift;
        varying float vGardenTop;
        varying vec3 vGardenPosition;
        uniform vec3 gardenHazeColor;
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
        '#include <color_fragment>',
        `#include <color_fragment>
        // Clumps of foliage (about 0.7m and 2m), each crown lit at its top and shaded below where
        // the next crown overlaps, darker under the canopy; then the air between, more toward the
        // foot (valley mist).
        vec2 gardenArc = vec2(atan(vGardenPosition.z, vGardenPosition.x) * ${FAR_FOREST_RADIUS.toFixed(1)}, vGardenPosition.y);
        float gardenClump = gardenForestNoise(gardenArc * 1.4) * 0.6 + gardenForestNoise(gardenArc * 0.5 + 3.1) * 0.4;
        diffuseColor.rgb *= 0.7 + 0.5 * gardenClump;
        diffuseColor.rgb *= mix(0.68, 1.05, smoothstep(vGardenTop - 4.5, vGardenTop - 0.3, vGardenPosition.y));
        diffuseColor.rgb *= mix(0.55, 1.0, vGardenLift);
        float haze = 0.08 + 0.14 * (1.0 - smoothstep(0.0, 9.0, vGardenPosition.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, gardenHazeColor, haze);`,
      );
  };
  material.customProgramCacheKey = () => 'garden-far-forest-v3';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = material.name;
  const tint = new THREE.Color();
  let painted: Season | null = null;
  const paint = (season: Season) => {
    painted = season;
    for (let v = 0; v < segmentOf.length; v++) {
      const crown = crowns[owner[segmentOf[v]]];
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
    /** The light on the band, as the ridges' (the color of the material multiplies the tints). */
    update(season: Season, light: THREE.Color) {
      if (painted !== season) paint(season);
      material.color.copy(light);
    },
  };
}
