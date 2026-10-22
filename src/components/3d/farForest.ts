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
// Low-poly lobed volumes in front of the ring supply depth, sharing the unlit material;
// their fixed vertex shading is a shape cue, not seasonally rebaked or dynamic lighting.

export const FAR_FOREST_RADIUS = 54;
const SEGMENTS = 1440;
/** Ground under the band (the terrain lies about 2m up out there) and the understory's top. */
const BASE = -4;
const UNDERSTORY = 4.5;
/** How deep (m) the ragged foliage cuts into the outline. */
const FRAY = 1.2;
/** Darker cores under the foliage clumps, which take the light. */
const CORE_SHADE = 0.74;
/** Foliage clumps per crown of each rank, and their facets (36 triangles each). */
const CLUMPS = { front: 10, backing: 6, far: 4 };
const CLUMP_RINGS = 5;
const CLUMP_SECTORS = 8;
/** How far (m) a front crown's volume stays under its crown's top. */
const FRONT_DROP = 0.2;
/**
 * The volumes' leafy outline: along a volume's silhouette (where its surface turns from the view),
 * leaf masses of about 0.4m and 0.17m cut in up to this share of the turn, so the clumps read as
 * foliage instead of smooth balls; gone where the masses would be finer than a pixel.
 */
const VOLUME_FRAY = 0.8;
/**
 * Bare broadleaf crowns in winter: how much deeper the outline frays, the share of the leaf-mass
 * contrast taken away, and how much of the air behind shows through the twigs.
 */
const BARE_FRAY = 0.8;
const BARE_LEAF_KEPT = 0.75;
const BARE_SEE_THROUGH = 0.45;
/** The scene's fixed sun (lighting.ts), as the band's shading uses. */
const sun = new THREE.Vector3(-0.556, 0.6178, 0.556).normalize();
/** The mean sun term over a crown's visible side, which stands for it without the sun. */
const SUN_MEAN = 0.3;

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
  // The outline over each vertex (Infinity under a crown): the shader frays the foliage below it.
  const edges: number[] = [];
  const crownOf: number[] = [];
  const depths: number[] = [];
  const sides: number[] = [];
  const band: number[] = [];
  const volumeLight: number[] = [];
  // The volumes' light without the sun's lobe over their light with it (1 where no sun lobe).
  const sunRatio: number[] = [];
  // The volumes' outward normals (the band has none: its outline frays by height).
  const normals: number[] = [];
  const at = (
    j: number,
    y: number,
    top: number,
    edge: number,
    radius = FAR_FOREST_RADIUS,
    crown = owner[Math.min(j, SEGMENTS - 1)],
  ) => {
    const a = j * step;
    // Push the shoulder toward the clearing, tapering into the buried foot and
    // crown tip. Preserve the original heights, frayed edge and closed horizon.
    const rise = THREE.MathUtils.clamp((y - BASE) / (UNDERSTORY - BASE), 0, 1);
    const tip = THREE.MathUtils.clamp((y - UNDERSTORY) / Math.max(0.1, heights[j] - UNDERSTORY), 0, 1);
    radius -= relief[j] * rise * (1 - 0.55 * tip);
    positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    indices.push(vertices++);
    crownOf.push(crown);
    volumeLight.push(1);
    sunRatio.push(1);
    normals.push(0, 0, 0);
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
      // The understory's top is an outline only where no crown stands over it.
      const covered = lo === BASE && (a > UNDERSTORY || b > UNDERSTORY);
      // A crown's side may fall below the understory's top (the quad then narrows to a triangle).
      const [edgeA, edgeB] = covered ? [1e4, 1e4] : [Math.max(hiA, lo), Math.max(hiB, lo)];
      at(j, lo, top, edgeA, FAR_FOREST_RADIUS, owner[j]);
      at(j, hiA, top, edgeA, FAR_FOREST_RADIUS, owner[j]);
      at(j + 1, hiB, top, edgeB, FAR_FOREST_RADIUS, owner[j]);
      at(j, lo, top, edgeA, FAR_FOREST_RADIUS, owner[j]);
      at(j + 1, hiB, top, edgeB, FAR_FOREST_RADIUS, owner[j]);
      at(j + 1, lo, top, edgeB, FAR_FOREST_RADIUS, owner[j]);
    }
  }
  // Replace the exposed foreground cutouts with overlapping, low-poly crown volumes.
  // The backing band still closes the horizon. All lobes share its material and seasonal
  // palette, and stay outside the real woodland and below the existing crown tops.
  for (const [i, crown] of crowns.entries()) {
    // A sparse second rank fills selected gaps between the foreground volumes.
    // The remaining exposed cutouts get a smaller, farther crown: their lit shoulders
    // overlap the backing sheet instead of leaving a row of flat silhouettes.
    const backing = i % 6 === 0;
    const far = i % 6 === 3;
    const distance = far ? 51.9 + crown.shade * 0.2 : backing ? 51.2 + crown.shade * 0.5 : 48 + crown.shade * 3;
    // The front volumes once stopped 1.1m short of the band behind: its crown tips then stood over them
    // alone, cut by the fray into stalks and knobs like chimney pots (docs/3d-qa/forest-outline/).
    // Rising to the tips, the nearer volumes hide them.
    const top = crown.top - (far ? 0.1 : backing ? 0.25 : FRONT_DROP);
    // Extend below the terrain: exposing the ellipsoid bottoms made floating blobs.
    const bottom = BASE;
    const height = Math.max(1.6, top - bottom);
    const radial = new THREE.Vector3(Math.cos(crown.angle), 0, Math.sin(crown.angle));
    const tangent = new THREE.Vector3(-radial.z, 0, radial.x);
    // Broad, fixed inward/upward fill makes the curved shoulders readable from the clearing.
    const lightDirection = radial.clone().multiplyScalar(-0.55).addScaledVector(tangent, -0.3);
    lightDirection.y = 0.78;
    lightDirection.normalize();
    // The far rank meets the band, whose approximate shading uses this fixed world sun.
    if (far) lightDirection.set(-0.556, 0.6178, 0.556).normalize();
    const edge = far ? 2e4 : 1e4;
    const scale = far ? 0.76 : backing ? 0.88 : 1;
    // One closed, low-poly ellipsoid: `light` shades each vertex from its normal.
    const ellipsoid = (
      center: THREE.Vector3,
      width: number,
      halfHeight: number,
      depth: number,
      rings: number,
      sectors: number,
      light: (normal: THREE.Vector3) => number,
      taper: (ny: number) => number,
      // The same light with the sun's lobe at its mean (light itself when no sun lights it).
      sunless = light,
    ) => {
      const vertex = (ring: number, sector: number) => {
        const phi = (ring / rings) * Math.PI;
        const theta = (sector / sectors) * Math.PI * 2;
        const sin = Math.sin(phi);
        const nx = Math.cos(theta) * sin,
          ny = Math.cos(phi),
          nz = Math.sin(theta) * sin;
        const uneven = 1 + 0.1 * Math.sin(theta * 3 + crown.pick * 6 + phi * 2) * sin;
        const x = nx * width * uneven * taper(ny);
        const z = nz * depth * uneven * taper(ny);
        const position = center.clone().addScaledVector(tangent, x).addScaledVector(radial, z);
        position.y += ny * halfHeight;
        positions.push(position.x, position.y, position.z);
        crownOf.push(i);
        band.push(0);
        const normal = tangent
          .clone()
          .multiplyScalar(nx / width)
          .addScaledVector(radial, nz / depth)
          .add(new THREE.Vector3(0, ny / halfHeight, 0))
          .normalize();
        volumeLight.push(light(normal));
        sunRatio.push(sunless(normal) / light(normal));
        normals.push(Math.round(normal.x * 127), Math.round(normal.y * 127), Math.round(normal.z * 127));
        sides.push(0);
        depths.push(Math.max(0, Math.min(1, (Math.hypot(position.x, position.z) - 47) / 7)));
        lift.push(Math.max(0, Math.min(1, (position.y - BASE) / (UNDERSTORY - BASE))));
        tops.push(top);
        // Volumes have their own closed silhouette; the band's vertical edge discard
        // would punch view-dependent holes through their front and back surfaces.
        // The larger sentinel also lets QA omit just the far rank in a same-build control.
        edges.push(edge);
      };
      const first = vertices;
      for (let ring = 0; ring <= rings; ring++) for (let sector = 0; sector <= sectors; sector++) vertex(ring, sector);
      vertices += (rings + 1) * (sectors + 1);
      const at = (ring: number, sector: number) => first + ring * (sectors + 1) + sector;
      for (let ring = 0; ring < rings; ring++) {
        for (let sector = 0; sector < sectors; sector++) {
          // The poles' rings are points: one triangle there.
          if (ring > 0) indices.push(at(ring, sector), at(ring, sector + 1), at(ring + 1, sector));
          if (ring < rings - 1) indices.push(at(ring, sector + 1), at(ring + 1, sector + 1), at(ring + 1, sector));
        }
      }
    };
    const lobeLight = (normal: THREE.Vector3) =>
      CORE_SHADE *
      (far
        ? 0.78 + 0.66 * Math.max(0, normal.dot(lightDirection))
        : 0.55 + 0.75 * (0.5 + 0.5 * normal.dot(lightDirection)));
    // Only the far rank is lit by the sun; the others by a fixed fill from the sky over the clearing.
    const lobeSunless = far ? () => CORE_SHADE * (0.78 + 0.66 * SUN_MEAN) : lobeLight;
    // Narrow the evergreen leader toward the top. Its upper half closes as a cone, to the spire the band
    // behind once showed over it (a rounded tip read as a broadleaf's).
    const lobeTaper = (ny: number) =>
      crown.evergreen ? (0.78 - 0.22 * ny) * (ny > 0 ? Math.sqrt((1 - ny) / (1 + ny)) : 1) : 1;
    // A leader and two offset shoulders break up a single smooth balloon/cone.
    for (let lobe = 0; lobe < 3; lobe++) {
      const shoulder = lobe !== 0;
      const side = lobe === 1 ? -1 : 1;
      const width = crown.radius * (shoulder ? 0.62 : 0.78) * scale;
      // The broadleaf leader stops under the clumps, which make the top of the outline.
      const leader = shoulder || crown.evergreen ? height : height - crown.radius * scale * 0.5;
      const halfHeight = leader * (shoulder ? 0.22 : 0.5);
      const center = radial.clone().multiplyScalar(distance - (shoulder ? 0.35 : 0));
      center.addScaledVector(tangent, shoulder ? side * crown.radius * 0.57 : 0);
      center.y = shoulder
        ? bottom + height * (lobe === 1 ? 0.61 : 0.69) - (crown.evergreen ? 0 : crown.radius * scale * 0.4)
        : bottom + halfHeight;
      const depth = width * (0.72 + crown.pick * 0.18);
      // These farther shoulders need fewer facets; share the existing material.
      ellipsoid(
        center,
        width,
        halfHeight,
        depth,
        backing || far ? 4 : 6,
        backing || far ? 8 : 10,
        lobeLight,
        lobeTaper,
        lobeSunless,
      );
    }
    // Clumps of foliage over the side facing the clearing: each lit on top by the world's sun and
    // shaded beneath, so the crown reads as a cluster of leafy masses with a bumpy outline instead
    // of one smooth spire (docs/3d-qa/forest-clumps/).
    const random = seeded(0xc1a0 + i * 7919);
    const clumps = far ? CLUMPS.far : backing ? CLUMPS.backing : CLUMPS.front;
    const inward = radial.clone().negate();
    for (let k = 0; k < clumps; k++) {
      const u = (k + random()) / clumps;
      // Across the facing half, from one side to the other; the evergreens' tiers out at the
      // edges, left and right in turn, so they step the outline.
      const across = crown.evergreen ? (k % 2 ? 1 : -1) * (0.55 + 0.4 * random()) : (random() * 2 - 1) * 0.95;
      let center: THREE.Vector3;
      let size: number;
      if (crown.evergreen) {
        // Tiers narrowing toward the leader.
        const fall = u * crown.radius * 2.2;
        const reach = crown.radius * scale * (0.35 + 0.8 * (fall / (crown.radius * 2.2)));
        size = crown.radius * scale * (0.3 + 0.22 * (fall / (crown.radius * 2.2))) * (0.85 + 0.3 * random());
        center = radial
          .clone()
          .multiplyScalar(distance)
          .addScaledVector(tangent, across * reach)
          .addScaledVector(inward, Math.sqrt(1 - across * across) * reach * 0.7);
        center.y = top - 0.35 - fall;
      } else {
        // Over a dome: up to about 70 degrees above the crown's equator.
        const elevation = (u * 0.85 - 0.1) * (Math.PI / 2);
        const reach = crown.radius * scale * 0.95;
        size = crown.radius * scale * (0.28 + 0.12 * random());
        const around = tangent
          .clone()
          .multiplyScalar(across)
          .addScaledVector(inward, Math.sqrt(1 - across * across));
        center = radial
          .clone()
          .multiplyScalar(distance)
          .addScaledVector(around, Math.cos(elevation) * reach);
        center.y = top - crown.radius * scale * 0.95 + Math.sin(elevation) * reach * 0.9;
      }
      // Below the crown's top and over the understory.
      // Its half height (0.85) at the most uneven (1.1).
      center.y = Math.min(center.y, top - size * 0.94);
      const lower = THREE.MathUtils.clamp((top - center.y) / (crown.radius * 2.5), 0, 1);
      // Seen from below, mostly their sides: a little over the darker core, brighter up top and on
      // the sun's side, darker beneath, and each clump its own shade so neighbours part.
      const own = 0.88 + 0.24 * random();
      const clumpLight = (normal: THREE.Vector3, sunlit = Math.max(0, normal.dot(sun))) =>
        (0.86 + 0.45 * normal.y + 0.3 * sunlit) * (1 - 0.15 * lower) * own;
      ellipsoid(
        center,
        size,
        size * 0.85,
        size * 0.9,
        CLUMP_RINGS,
        CLUMP_SECTORS,
        clumpLight,
        () => 1,
        (normal) => clumpLight(normal, SUN_MEAN),
      );
    }
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
  geometry.setAttribute('gardenNormal', new THREE.BufferAttribute(new Int8Array(normals), 3, true));
  // Halved into [0, 1] (the ratios lie within about 0.7–1.3).
  geometry.setAttribute(
    'gardenSunRatio',
    new THREE.BufferAttribute(
      Uint8Array.from(sunRatio, (r) => Math.round(Math.min(1, r / 2) * 255)),
      1,
      true,
    ),
  );
  // The broadleaf crowns, bare in winter.
  const broadleaf = new Uint8Array(crownOf.length);
  for (let v = 0; v < crownOf.length; v++) broadleaf[v] = crowns[crownOf[v]] && !crowns[crownOf[v]].evergreen ? 255 : 0;
  geometry.setAttribute('gardenBroadleaf', new THREE.BufferAttribute(broadleaf, 1, true));
  const bare = { value: 0 };
  // The share of the shading that the sun gives: the clear day's (lighting.ts), none at dusk,
  // night or under overcast, when the crowns are lit by the sky alone.
  const sunlit = { value: 1 };
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.name = 'Garden far forest';
  // The shader frays the outline with discard; an alpha test (never failed: the alpha is 1) keeps the
  // band out of the depth prepass, whose depth would hide the sky behind the frayed edge.
  material.alphaTest = 0.01;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.gardenHazeColor = hazeColor;
    shader.uniforms.gardenBare = bare;
    shader.uniforms.gardenSun = sunlit;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float gardenBroadleaf;\nvarying float vGardenBroadleaf;\nattribute float gardenBand;\nvarying float vGardenBand;\nattribute float gardenCrownSide;\nvarying float vGardenSide;\nattribute float gardenDepth;\nvarying float vGardenDepth;\nattribute float gardenLift;\nattribute float gardenCrownTop;\nattribute float gardenEdge;\nattribute vec3 gardenNormal;\nvarying vec3 vGardenNormal;\nattribute float gardenSunRatio;\nvarying float vGardenSunRatio;\nvarying float vGardenLift;\nvarying float vGardenTop;\nvarying float vGardenEdge;\nvarying vec3 vGardenPosition;\nvarying float vGardenAir;',
      )
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGardenAir = length(mvPosition.xyz);')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGardenBroadleaf = gardenBroadleaf;\nvGardenBand = gardenBand;\nvGardenSide = gardenCrownSide;\nvGardenDepth = gardenDepth;\nvGardenLift = gardenLift;\nvGardenTop = gardenCrownTop;\nvGardenEdge = gardenEdge;\nvGardenNormal = gardenNormal;\nvGardenSunRatio = gardenSunRatio;\nvGardenPosition = position;',
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
        varying vec3 vGardenNormal;
        varying float vGardenSunRatio;
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
        // The volumes fray along their own silhouettes, revealing the clump or crown behind.
        if (dot(vGardenNormal, vGardenNormal) > 0.25) {
          float gardenTurn = 1.0 - abs(dot(normalize(vGardenNormal), normalize(cameraPosition - vGardenPosition)));
          float gardenLeafy = gardenForestNoise(gardenEdgeArc * 2.5 + 3.3) * 0.65
            + mix(0.5, gardenForestNoise(gardenEdgeArc * 6.0 + 1.7), gardenFine) * 0.35;
          float gardenVolumeFine = 1.0 - smoothstep(0.12, 0.35, max(length(dFdx(gardenEdgeArc)), length(dFdy(gardenEdgeArc))));
          if (gardenTurn > 1.0 - ${VOLUME_FRAY.toFixed(2)} * (1.0 + 0.4 * gardenBareCrown) * gardenLeafy * gardenVolumeFine) discard;
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Clumps of foliage (about 0.7m and 2m), each crown lit at its top and shaded below where
        // the next crown overlaps, darker under the canopy; then the air between, more toward the
        // foot (valley mist).
        vec2 gardenArc = vec2(atan(vGardenPosition.z, vGardenPosition.x) * ${FAR_FOREST_RADIUS.toFixed(1)}, vGardenPosition.y);
        float gardenFootprint = max(length(dFdx(gardenArc)), length(dFdy(gardenArc)));
        float gardenDetail = 1.0 - smoothstep(0.18, 0.65, gardenFootprint);
        float gardenClump = mix(0.5, gardenForestNoise(gardenArc * vec2(1.4, 2.1)), gardenDetail) * 0.6
          + gardenForestNoise(gardenArc * 0.5 + 3.1) * 0.4;
        // A rounded crown facing the clearing: broad light on one shoulder, shaded opposite
        // shoulder, and larger branch masses within it. No additional light or shadow pass.
        float gardenSide = clamp(vGardenSide, -1.0, 1.0);
        float gardenRound = sqrt(max(0.0, 1.0 - gardenSide * gardenSide));
        float gardenShoulder = clamp(0.6 * gardenRound - 0.35 * gardenSide, -0.35, 0.7);
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
        diffuseColor.rgb *= (0.64 + 0.64 * gardenClump)
          * mix(0.82 + 0.44 * gardenShoulder, gardenDirectional, vGardenBand);
        // The sun's lobe in the volumes' vertex light gives way to its mean without the sun.
        diffuseColor.rgb *= mix(2.0 * vGardenSunRatio, 1.0, gardenSun);
        diffuseColor.rgb *= mix(0.76, 1.12, smoothstep(vGardenTop - 4.5, vGardenTop - 0.3, vGardenPosition.y));
        diffuseColor.rgb *= mix(0.62, 1.0, vGardenLift);
        // Foreground remains darker and clearer; backing crowns recede into the air.
        diffuseColor.rgb *= mix(0.72, 1.0, vGardenDepth);
        // Leaf masses (about 0.9m) over every crown, each lighter on its upper side with dark gaps
        // between: smooth shading alone read as a painted backdrop beside the speckled woodland.
        // Gone where a mass would be under about four pixels.
        float gardenLeafDetail = 1.0 - smoothstep(0.12, 0.3, gardenFootprint);
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
  material.customProgramCacheKey = () => 'garden-far-forest-v14';
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
      tint.multiplyScalar(volumeLight[v]);
      tint.toArray(colors, v * 3);
    }
    geometry.attributes.color.needsUpdate = true;
  };
  return {
    mesh,
    crowns: crowns.length,
    /** The light on the band, as the ridges' (the color of the material multiplies the tints). */
    update(season: Season, light: THREE.Color, sun = 1) {
      if (painted !== season) paint(season);
      sunlit.value = sun;
      bare.value = season === 'winter' ? 1 : 0;
      material.color.copy(light);
    },
  };
}
