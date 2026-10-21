import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Garden butterflies: a swallowtail (ナミアゲハ) and two cabbage whites (モンシロチョウ), with
 * painted wings (an atlas of the four wings' upper and under sides, cut out by alpha to coverage),
 * a body and antennae. Each visit is a deterministic plan per cycle: it comes in high over the
 * garden, flits erratically between the near flowers, lands on two blooms (whites rest with their
 * wings closed and now and then open them, the swallowtail flutters while it feeds), turns close
 * in front of a stage view and leaves. Before, two flat pentagons spun in place around a patch.
 */

type Point = [number, number];

interface WingShape {
  /** Closed outline in mm: x outward from the hinge, y toward the head. */
  outline: Point[];
  /** The outline's outer margin, as a range of its points. */
  margin: [number, number];
  /** Veins as straight segments [x0, y0, x1, y1] in mm. */
  veins: [number, number, number, number][];
}

export interface Species {
  fore: WingShape;
  hind: WingShape;
  paint(wing: 'fore' | 'hind', under: boolean, at: Sample): THREE.Color;
  /** Wingbeats per second. */
  beat: number;
  /** Cruising speed (m/s) and the erratic wander around the path (m). */
  speed: number;
  wander: number;
  /** Share of the time spent gliding on raised wings. */
  glide: number;
  body: { thorax: number; length: number; abdomen: number; head: number; antenna: number; color: number; band: number };
  /** Seconds on a flower and the seconds between visits. */
  perch: [number, number];
  period: number;
  /** True: feeds with its wings fluttering half open; false: rests with them closed. */
  flutters: boolean;
}

interface Sample {
  x: number;
  y: number;
  /** Distance (mm) to the outer margin. */
  margin: number;
  /** Distance (mm) to the nearest vein. */
  vein: number;
}

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const fract = (x: number) => x - Math.floor(x);

// Scallops along a margin: a dip between each pair of points, pulled toward `center`.
function scalloped(points: Point[], center: Point, depth: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    out.push(points[i]);
    if (i + 1 === points.length) break;
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const mx = (ax + bx) / 2,
      my = (ay + by) / 2;
    const dx = center[0] - mx,
      dy = center[1] - my;
    const length = Math.hypot(dx, dy);
    out.push([mx + (dx / length) * depth, my + (dy / length) * depth]);
  }
  return out;
}

function shape(parts: Point[][], marginPart: number, veins: WingShape['veins']): WingShape {
  const outline: Point[] = [];
  let margin: [number, number] = [0, 0];
  parts.forEach((part, i) => {
    if (i === marginPart) margin = [outline.length, outline.length + part.length - 1];
    outline.push(...part);
  });
  return { outline, margin, veins };
}

const radial = (from: Point, ends: Point[]): WingShape['veins'] => ends.map(([x, y]) => [from[0], from[1], x, y]);

// ナミアゲハ (Papilio xuthus): forewing about 47mm, a tailed hindwing with a scalloped margin.
const SWALLOWTAIL_HIND_MARGIN = scalloped(
  [
    [35, -12],
    [36, -17],
    [35, -22],
    [33, -26],
    [31, -29],
  ],
  [14, -14],
  0.9,
);
const SWALLOWTAIL: Species = {
  fore: shape(
    [
      [
        [1, 1.5],
        [6, 4.5],
        [14, 7.5],
        [24, 9.5],
        [34, 10.5],
        [42, 10],
      ],
      [
        [47, 8],
        [48, 5],
        [46.5, 0],
        [43.5, -6],
        [40, -12],
        [37, -16],
      ],
      [
        [30, -16.5],
        [22, -14],
        [14, -10],
        [7, -5.5],
        [2.5, -2],
        [1, -0.5],
      ],
    ],
    1,
    [
      ...radial(
        [9, 1],
        [
          [30, 10.4],
          [38, 10.5],
          [44, 9.4],
        ],
      ),
      ...radial(
        [12, -1],
        [
          [47.6, 6],
          [47.3, 2],
          [45.5, -2.5],
          [42.5, -7.8],
          [39, -13.5],
        ],
      ),
      [4, -2, 35, -16.2],
      [2, -1, 26, -15.4],
    ],
  ),
  hind: shape(
    [
      [
        [0.8, -1],
        [8, -0.5],
        [16, -1.5],
        [24, -4],
        [31, -8],
      ],
      [
        ...SWALLOWTAIL_HIND_MARGIN,
        [31.5, -33],
        [32, -38],
        [31, -41.5],
        [29.5, -40.5],
        [28.5, -34],
        ...scalloped(
          [
            [27.5, -30.5],
            [23.5, -32.5],
            [19.5, -34.8],
            [15.5, -36],
          ],
          [14, -14],
          0.8,
        ),
        [12, -36.3],
        [9, -34.5],
      ],
      [
        [6, -29],
        [4, -22],
        [2.5, -14],
        [1.5, -7],
        [0.8, -2.5],
      ],
    ],
    1,
    [
      ...radial(
        [5, -6],
        [
          [28, -5.8],
          [35.3, -13],
          [35.6, -20],
          [32.5, -27],
          [30, -31],
          [24, -32.3],
          [19, -35],
          [14, -36.2],
        ],
      ),
      [3, -6, 8, -34.8],
    ],
  ),
  beat: 6,
  speed: 1.5,
  wander: 0.07,
  glide: 0.45,
  body: { thorax: 0.0024, length: 0.006, abdomen: 0.02, head: 0.0021, antenna: 0.019, color: 0x1d1b18, band: 0xd8c57c },
  perch: [2.5, 4.5],
  period: 80,
  flutters: true,
  paint(wing, under, { x, y, margin, vein }) {
    const yellow = srgb(under ? 0xefd98c : 0xf3e5a4);
    const black = srgb(0x1c1a17);
    const color = yellow.clone();
    const veinWidth = 0.16 + 0.007 * x;
    const between = smooth(veinWidth + 0.2, veinWidth + 1.1, vein);
    const band = under ? 0.72 : 1;
    if (wing === 'fore') {
      // Black base streaked with yellow lines running out along the wing.
      const streak = fract((y - 0.18 * x) / 2.4) < (under ? 0.62 : 0.5) && x > 3.5;
      const base = 1 - smooth(13, 15.5, x + 0.3 * y);
      if (!streak) color.lerp(black, base);
      // Costal bars and the two bars closing the cell.
      const costa = 10.5 - 0.0026 * (x - 34) ** 2;
      if (x > 14 && x < 41 && y > costa - 3.2 && fract((x - 14) / 5.6) < 0.42) color.copy(black);
      if (Math.abs(x - 22.5) < 0.9 && y > -4.5 && y < 6) color.copy(black);
      if (Math.abs(x - 28.5) < 0.8 && y > -3.5 && y < 7) color.copy(black);
      // The outer band, with a row of yellow lunules between the veins.
      const outer = 1 - smooth(8 * band - 0.6, 8 * band + 0.6, margin);
      const lunule = smooth(2.4, 3, margin) * (1 - smooth(4.6, 5.3, margin)) * between;
      color.lerp(black, outer * (1 - lunule));
    } else {
      // Dark hair along the body, then the outer band with blue and yellow lunules.
      color.lerp(srgb(0x2b2823), 1 - smooth(4, 7, x));
      const outer = 1 - smooth(10 * band - 0.7, 10 * band + 0.7, margin);
      color.lerp(black, outer);
      const blue = smooth(4.2, 4.9, margin) * (1 - smooth(7.4, 8.2, margin)) * between;
      color.lerp(srgb(under ? 0x8f9cb4 : 0x4e6ca6), blue * outer * (under ? 0.7 : 0.85));
      const lunule = smooth(0.7, 1.1, margin) * (1 - smooth(2.6, 3.2, margin)) * between;
      color.lerp(srgb(under ? 0xe8a25a : 0xf0dc96), lunule * outer);
      if (y < -34 && x > 27) color.copy(black);
      // The orange eye spot at the anal angle.
      const eye = Math.hypot(x - 11.8, y + 32.8);
      color.lerp(srgb(0xe2853a), 1 - smooth(2.2, 2.8, eye));
      color.lerp(black, 1 - smooth(0.8, 1.2, eye));
    }
    color.lerp(black, (1 - smooth(veinWidth, veinWidth + 0.25, vein)) * (under ? 0.7 : 1));
    return color;
  },
};

// モンシロチョウ (Pieris rapae): forewing about 26mm, white with a dark apex and spots.
const WHITE: Species = {
  fore: shape(
    [
      [
        [0.8, 1],
        [5, 3.5],
        [11, 5.5],
        [17, 6.8],
        [22, 7],
      ],
      [
        [25.5, 5.8],
        [27, 3.5],
        [26.5, 0],
        [25, -4],
        [22.5, -8],
        [19.5, -10.5],
      ],
      [
        [14, -10.5],
        [9, -8],
        [5, -5],
        [2, -2],
        [0.8, -0.3],
      ],
    ],
    1,
    radial(
      [6, -1],
      [
        [20, 6.9],
        [24.5, 6.2],
        [26.8, 2.5],
        [26, -2],
        [24, -6],
        [21, -9.5],
        [15, -10.6],
      ],
    ),
  ),
  hind: shape(
    [
      [
        [0.7, -0.8],
        [6, -0.5],
        [12, -1.5],
        [17, -4],
      ],
      [
        [20.5, -8],
        [21.5, -12],
        [20.5, -16],
        [18, -19.5],
        [14, -21.5],
        [10, -22],
        [6.5, -20.5],
      ],
      [
        [3.5, -16],
        [2, -10],
        [1, -4],
        [0.7, -2],
      ],
    ],
    1,
    radial(
      [4, -4],
      [
        [18, -4.6],
        [21.2, -11],
        [20, -17],
        [16.5, -20.5],
        [12, -22],
        [7.5, -21],
      ],
    ),
  ),
  beat: 9,
  speed: 1.05,
  wander: 0.13,
  glide: 0.12,
  body: {
    thorax: 0.0016,
    length: 0.004,
    abdomen: 0.012,
    head: 0.0015,
    antenna: 0.011,
    color: 0x34342f,
    band: 0x9a9a92,
  },
  perch: [3.5, 7],
  period: 72,
  flutters: false,
  paint(wing, under, { x, y, margin, vein }) {
    const white = srgb(0xf4f3ec);
    const dark = srgb(under ? 0x6f6f68 : 0x3f3f3b);
    const color = white.clone();
    const r = Math.hypot(x, y);
    if (wing === 'fore') {
      if (under) color.lerp(srgb(0xeae2ac), smooth(-1, 3, y) * (1 - smooth(4, 7, margin)));
      else color.lerp(dark, (1 - smooth(2.6, 3.6, margin)) * smooth(-3.5, -1.5, y));
      color.lerp(dark, 1 - smooth(1.4, 1.9, Math.hypot(x - 15.5, y + 3)));
    } else {
      if (under) color.lerp(srgb(0xefe9c4), 0.9);
      color.lerp(dark, (1 - smooth(1, 1.5, Math.hypot(x - 12, y + 1.8))) * (under ? 0 : 1));
      if (under) color.lerp(srgb(0xb5b39a), (1 - smooth(0.2, 0.6, vein)) * 0.3);
    }
    // Grey dusting at the base, faint veins toward the margin.
    color.lerp(srgb(0x8d8f88), (1 - smooth(1.5, 6, r)) * 0.75);
    color.lerp(dark, (1 - smooth(0.25, 0.55, vein)) * (1 - smooth(0.5, 2.5, margin)) * 0.6);
    return color;
  },
};

const SPECIES = [SWALLOWTAIL, WHITE, WHITE];
// Drawn a little larger than life (whites about 7cm, the swallowtail 13cm across): at life size
// they were specks of a few pixels even 2m in front of the views.
const SCALE = 1.35;
// Scene-linear radiance per unit albedo of the light through the wings (before exposure).
const WING_GLOW = 0.45;

// Catmull-Rom closed outline, densified.
function densify(points: Point[], steps = 6) {
  const out: Point[] = [];
  const at = (i: number) => points[(i + points.length) % points.length];
  for (let i = 0; i < points.length; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps,
        t2 = t * t,
        t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

const segmentDistance = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax,
    dy = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
};

/** A wing's box in mm, with a margin for the cut-out's soft edge. */
function wingBox(wing: WingShape) {
  const xs = wing.outline.map(([x]) => x),
    ys = wing.outline.map(([, y]) => y);
  const pad = 0.6;
  return { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
}

export const WING_TEXELS = 128;

/** The wing atlas: columns species × (fore, hind), rows upper and under side. */
export function paintWingAtlas() {
  const columns = 4;
  const width = WING_TEXELS * columns,
    height = WING_TEXELS * 2;
  const data = new Uint8Array(width * height * 4);
  const species = [SWALLOWTAIL, WHITE];
  const color = new THREE.Color();
  species.forEach((kind, s) => {
    (['fore', 'hind'] as const).forEach((name, w) => {
      const wing = kind[name];
      const box = wingBox(wing);
      const outline = densify(wing.outline);
      const steps = outline.length / wing.outline.length;
      const marginFrom = wing.margin[0] * steps,
        marginTo = wing.margin[1] * steps;
      const sx = (box.x1 - box.x0) / WING_TEXELS,
        sy = (box.y1 - box.y0) / WING_TEXELS;
      const texel = Math.max(sx, sy);
      for (let j = 0; j < WING_TEXELS; j++)
        for (let i = 0; i < WING_TEXELS; i++) {
          const x = box.x0 + (i + 0.5) * sx,
            y = box.y0 + (j + 0.5) * sy;
          let edge = Infinity,
            margin = Infinity,
            inside = false;
          for (let k = 0; k < outline.length; k++) {
            const [ax, ay] = outline[k];
            const [bx, by] = outline[(k + 1) % outline.length];
            const d = segmentDistance(x, y, ax, ay, bx, by);
            edge = Math.min(edge, d);
            if (k >= marginFrom && k < marginTo) margin = Math.min(margin, d);
            if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
          }
          let vein = Infinity;
          for (const [ax, ay, bx, by] of wing.veins) vein = Math.min(vein, segmentDistance(x, y, ax, ay, bx, by));
          const alpha = Math.min(1, Math.max(0, 0.5 + (inside ? edge : -edge) / texel));
          for (const under of [false, true]) {
            color.copy(kind.paint(name, under, { x, y, margin: inside ? margin : 0, vein }));
            color.convertLinearToSRGB();
            const index = (((under ? 1 : 0) * WING_TEXELS + j) * width + (s * 2 + w) * WING_TEXELS + i) * 4;
            data[index] = Math.round(color.r * 255);
            data[index + 1] = Math.round(color.g * 255);
            data[index + 2] = Math.round(color.b * 255);
            data[index + 3] = Math.round(alpha * 255);
          }
        }
    });
  });
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

// One side's fore- and hindwing: a quad per wing and side of it, upper side up (+y) and the under
// side facing down with its own painting. `mirror` builds the other side (-x).
function wingGeometry(kind: Species, column: number, mirror: boolean) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  (['fore', 'hind'] as const).forEach((name, w) => {
    const box = wingBox(kind[name]);
    const u0 = (column * 2 + w) / 4,
      u1 = (column * 2 + w + 1) / 4;
    // The hindwing lies just under the forewing where they overlap.
    const level = w ? -0.0003 : 0;
    const corners = [
      [box.x0, box.y0, u0, 0],
      [box.x1, box.y0, u1, 0],
      [box.x1, box.y1, u1, 0.5],
      [box.x0, box.y1, u0, 0.5],
    ];
    for (const under of [false, true]) {
      // Counter-clockwise seen from the side it faces.
      const order = under !== mirror ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const c of order) {
        const [x, y, u, v] = corners[c];
        positions.push((mirror ? -x : x) / 1000, level, -y / 1000);
        normals.push(0, under ? -1 : 1, 0);
        uvs.push(u, v + (under ? 0.5 : 0));
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

// Head, thorax, a tapering abdomen and clubbed antennae, forward along -z (the wings' +y).
function bodyGeometry(kind: Species) {
  const { thorax, length, abdomen, head, antenna, color, band } = kind.body;
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, hex: number) => {
    geometry.deleteAttribute('uv');
    const tint = srgb(hex);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([tint.r, tint.g, tint.b], i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  };
  add(new THREE.SphereGeometry(1, 8, 6).scale(thorax, thorax, length / 2).translate(0, 0, -0.0005), color);
  add(new THREE.SphereGeometry(head, 8, 5).translate(0, 0.0002, -length / 2 - head * 0.7), color);
  // The abdomen droops a little behind the hindwings, with a pale side stripe on the swallowtail.
  const belly = new THREE.SphereGeometry(1, 8, 6).scale(thorax * 0.78, thorax * 0.78, abdomen / 2);
  belly.rotateX(0.12).translate(0, -thorax * 0.3, length / 2 + abdomen / 2 - 0.001);
  add(belly, color);
  const stripe = new THREE.SphereGeometry(1, 6, 4).scale(thorax * 0.8, thorax * 0.35, abdomen * 0.42);
  stripe.rotateX(0.12).translate(0, -thorax * 0.45, length / 2 + abdomen / 2 - 0.001);
  add(stripe, band);
  for (const side of [-1, 1]) {
    const rod = new THREE.CylinderGeometry(0.00022, 0.00028, antenna, 3, 1);
    rod.translate(0, antenna / 2, 0);
    rod.rotateX(-1.05);
    rod.rotateZ(side * -0.35);
    rod.translate(side * head * 0.4, head * 0.6, -length / 2 - head * 1.2);
    add(rod, color);
    const tip = new THREE.Vector3(0, antenna, 0)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), -1.05)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), side * -0.35);
    add(
      new THREE.SphereGeometry(0.0006, 5, 3)
        .scale(1, 1, 1.8)
        .translate(side * head * 0.4 + tip.x, head * 0.6 + tip.y, -length / 2 - head * 1.2 + tip.z),
      color,
    );
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return merged;
}

// A small deterministic generator, seeded per butterfly and cycle.
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Stop {
  at: THREE.Vector3;
  /** Seconds spent there (on a flower). */
  hold: number;
  arrive: number;
  leave: number;
}

export interface Plan {
  stops: Stop[];
  /** Seconds from the start of the cycle to leaving the garden. */
  duration: number;
}

/**
 * One visit: in high from the garden side, a wander, a flower, a pass by the deck (in front of the
 * plunge pool's or the lounge's view), another flower and out. Landings slow down on a short final
 * approach from above.
 */
export function planVisit(
  kind: Species,
  seed: number,
  blooms: readonly THREE.Vector3[],
  floor: (x: number, z: number) => number,
  limit = Infinity,
): Plan {
  const random = generator(seed);
  const range = (min: number, max: number) => min + (max - min) * random();
  const points: { at: THREE.Vector3; hold: number; speed: number }[] = [];
  const far = (angle: number) => new THREE.Vector3(2 + Math.cos(angle) * 22, range(5, 8), 6 + Math.sin(angle) * 22);
  const air = () => {
    const x = range(-4, 7),
      z = range(2.6, 9);
    return new THREE.Vector3(x, floor(x, z) + range(0.6, 1.7), z);
  };
  const flower = () => {
    const bloom = blooms[Math.floor(random() * blooms.length)];
    const last = points[points.length - 1].at;
    const toward = new THREE.Vector3(last.x - bloom.x, 0, last.z - bloom.z).setLength(0.22);
    points.push({
      at: bloom
        .clone()
        .add(toward)
        .setY(bloom.y + 0.14),
      hold: 0,
      speed: kind.speed,
    });
    points.push({ at: bloom.clone(), hold: range(...kind.perch), speed: 0.35 });
  };
  points.push({ at: far(range(0.2, 0.8) * Math.PI), hold: 0, speed: 0 });
  points.push({ at: air(), hold: 0, speed: 2.6 });
  if (blooms.length) flower();
  points.push({ at: air(), hold: 0, speed: kind.speed });
  // A few turns close in front of the lounge's or the plunge pool's view (about 1.2 to 2.2m from
  // the stage views in sauna.scene.json), under the roof's edge and above the pool's far half.
  const lounge = random() < 0.5;
  for (let n = 0; n < 2; n++) {
    const near = lounge
      ? new THREE.Vector3(range(4.2, 5.6), range(1.2, 1.8), range(-0.8, 0.4))
      : new THREE.Vector3(range(0.6, 1.8), range(1, 1.5), range(-1.6, -0.5));
    // Heights above the deck (0.075m, rainWetness.ts DECK_LEVEL: importing it here closes an import
    // cycle that leaves its shader text undefined), or the ground where it lies higher.
    near.y += Math.max(0.075, floor(near.x, near.z));
    points.push({ at: near, hold: 0, speed: kind.speed * 0.75 });
  }
  points.push({ at: air(), hold: 0, speed: kind.speed });
  if (blooms.length) flower();
  points.push({ at: air(), hold: 0, speed: kind.speed });
  points.push({ at: far(range(0.2, 0.8) * Math.PI), hold: 0, speed: 2.6 });
  // A long wander is flown faster, so the visit ends (far away) before the next one starts.
  const travel = points.map(({ at, speed }, i) => (i ? Math.max(0.5, at.distanceTo(points[i - 1].at) / speed) : 0));
  const holds = points.reduce((sum, { hold }) => sum + hold, 0);
  const moving = travel.reduce((sum, value) => sum + value, 0);
  const pace = Math.max(1, moving / Math.max(1, limit - holds));
  const stops: Stop[] = [];
  let clock = 0;
  for (const [i, { at, hold }] of points.entries()) {
    clock += travel[i] / pace;
    stops.push({ at, hold, arrive: clock, leave: clock + hold });
    clock += hold;
  }
  return { stops, duration: clock };
}

// Centripetal Catmull-Rom between b and c, without the loops uneven spacing gives the uniform form.
function centripetal(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  u: number,
  out: THREE.Vector3,
) {
  const knot = (p: THREE.Vector3, q: THREE.Vector3) => Math.max(1e-4, Math.sqrt(p.distanceTo(q)));
  const t1 = knot(a, b),
    t2 = t1 + knot(b, c),
    t3 = t2 + knot(c, d);
  const t = t1 + (t2 - t1) * u;
  const lerp = (p: THREE.Vector3, q: THREE.Vector3, ta: number, tb: number) =>
    p
      .clone()
      .multiplyScalar((tb - t) / (tb - ta))
      .addScaledVector(q, (t - ta) / (tb - ta));
  const a1 = lerp(a, b, 0, t1),
    a2 = lerp(b, c, t1, t2),
    a3 = lerp(c, d, t2, t3);
  const b1 = lerp(a1, a2, 0, t2),
    b2 = lerp(a2, a3, t1, t3);
  return out.copy(lerp(b1, b2, t1, t2));
}

/** The plan's path (without the wander) at `time` seconds into the cycle. */
export function pathAt(plan: Plan, time: number, out = new THREE.Vector3()) {
  const { stops } = plan;
  const t = Math.min(Math.max(time, 0), plan.duration);
  let i = 0;
  while (i + 1 < stops.length && stops[i + 1].arrive <= t) i++;
  if (i + 1 === stops.length || t <= stops[i].leave) return out.copy(stops[i].at);
  const from = stops[i],
    to = stops[i + 1];
  let u = (t - from.leave) / (to.arrive - from.leave);
  // Ease off a flower and into one.
  if (from.hold && to.hold) u = u * u * (3 - 2 * u);
  else if (from.hold) u = u * u;
  else if (to.hold) u = 1 - (1 - u) * (1 - u);
  const at = (k: number) => stops[Math.min(stops.length - 1, Math.max(0, k))].at;
  return centripetal(at(i - 1), from.at, to.at, at(i + 2), u, out);
}

/** The flower being visited around `time` (with a margin for the landing and take-off), if any. */
function perchNear(plan: Plan, time: number) {
  return plan.stops.find((stop) => stop.hold && time > stop.arrive - 1.5 && time < stop.leave + 1.5);
}

const angleLerp = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export function createButterflies(blooms: readonly THREE.Vector3[], floor: (x: number, z: number) => number) {
  const atlas = paintWingAtlas();
  const wingMaterial = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.5,
    alphaToCoverage: true,
    roughness: 0.78,
  });
  wingMaterial.name = 'Garden butterfly wings';
  // Thin wings let the daylight through: lit from behind, a white's shaded side still glows
  // instead of turning tan. A glow in the wing's own colors (black scales stay dark), by day only.
  wingMaterial.emissiveMap = atlas;
  const bodyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  bodyMaterial.name = 'Garden butterfly body';
  const geometries = new Map<Species, { body: THREE.BufferGeometry; wings: THREE.BufferGeometry[] }>();
  const butterflies = SPECIES.map((kind, n) => {
    if (!geometries.has(kind)) {
      const column = kind === SWALLOWTAIL ? 0 : 1;
      geometries.set(kind, {
        body: bodyGeometry(kind),
        wings: [wingGeometry(kind, column, false), wingGeometry(kind, column, true)],
      });
    }
    const shapes = geometries.get(kind)!;
    const group = new THREE.Group();
    group.name = `Garden butterfly ${n}`;
    group.rotation.order = 'YXZ';
    group.scale.setScalar(SCALE);
    const body = new THREE.Mesh(shapes.body, bodyMaterial);
    body.name = `${group.name} body`;
    group.add(body);
    // Hinged at the thorax's sides, the far side mirrored.
    const wings = shapes.wings.map((geometry, side) => {
      const wing = new THREE.Mesh(geometry, wingMaterial);
      wing.name = `${group.name} wing ${side ? 'left' : 'right'}`;
      wing.position.set((side ? -1 : 1) * kind.body.thorax * 0.7, kind.body.thorax * 0.45, -0.001);
      group.add(wing);
      return wing;
    });
    return { kind, group, wings, phase: n * 1.7, seed: 0x9e37 + n * 0x51, cycle: -1, plan: null as Plan | null };
  });
  const flowers = blooms.filter((bloom) => bloom.z < 9);
  const here = new THREE.Vector3(),
    before = new THREE.Vector3(),
    after = new THREE.Vector3();
  return {
    groups: butterflies.map(({ group }) => group),
    /**
     * Places and poses every butterfly; `shown` false hides them all (season, weather, motion).
     * `daylight` (1 by day, 0 at dusk) scales the light through the wings.
     */
    update(time: number, shown: boolean, daylight = 1) {
      wingMaterial.emissive.setScalar(WING_GLOW * daylight);
      for (const [n, butterfly] of butterflies.entries()) {
        const { kind, group, wings } = butterfly;
        // Staggered, so the three seldom arrive together.
        const local = time + n * 23;
        const cycle = Math.floor(local / kind.period);
        const t = local - cycle * kind.period;
        group.visible = shown;
        if (!shown) continue;
        if (cycle !== butterfly.cycle) {
          butterfly.cycle = cycle;
          butterfly.plan = planVisit(kind, butterfly.seed + cycle * 0x2c9, flowers, floor, kind.period - 2);
        }
        const plan = butterfly.plan!;
        group.visible = t < plan.duration;
        if (!group.visible) continue;
        pathAt(plan, t, here);
        pathAt(plan, t - 0.25, before);
        pathAt(plan, t + 0.25, after);
        const velocity = after.clone().sub(before).divideScalar(0.5);
        const speed = velocity.length();
        // 0 on a flower, 1 in flight.
        const flying = smooth(0.03, 0.4, speed);
        const flapping = smooth(0.02, 0.15, speed);
        const s = time + butterfly.phase * 10;
        const wobble = (a: number, b: number, c: number) =>
          Math.sin(s * a) * 0.55 + Math.sin(s * b + 1.3) * 0.3 + Math.sin(s * c + 2.1) * 0.15;
        // Gliding on raised wings now and then; the swallowtail more often.
        const glide = smooth(1 - kind.glide * 0.6, 1, 0.5 + 0.5 * Math.sin(s * 0.9) * Math.sin(s * 0.53 + 0.7));
        const beat = 2 * Math.PI * kind.beat * time + butterfly.phase;
        const stroke = Math.sin(beat + 0.3 * Math.sin(beat));
        const working = (1 - glide) * flying;
        // Erratic wander, a bob with each wingbeat (lowest with the wings up) and a nose-up body.
        group.position
          .copy(here)
          .add(
            new THREE.Vector3(wobble(5.3, 9.7, 17), wobble(6.1, 11.3, 19) * 0.7, wobble(4.7, 8.9, 15.1)).multiplyScalar(
              kind.wander * flying,
            ),
          );
        group.position.y -= stroke * kind.body.length * 2.2 * working;
        const perch = perchNear(plan, t);
        let heading = Math.atan2(-velocity.x, -velocity.z);
        if (perch) {
          const arrival = plan.stops[plan.stops.indexOf(perch) - 1].at;
          const settled = Math.atan2(arrival.x - perch.at.x, arrival.z - perch.at.z);
          heading = angleLerp(settled, heading, flying);
        }
        heading += wobble(3.1, 5.9, 9.3) * 0.35 * flying;
        // Banking into turns (positive to the left, lifting the right wing at +x).
        const incoming = here.clone().sub(before),
          outgoing = after.clone().sub(here);
        const turn = Math.atan2(incoming.clone().cross(outgoing).y, incoming.dot(outgoing) || 1e-6);
        group.rotation.set(
          (0.32 + 0.1 * stroke * (1 - glide) + Math.max(-0.3, Math.min(0.3, velocity.y * 0.25))) * flying,
          heading,
          Math.max(-0.45, Math.min(0.45, turn * 1.5)) * flying,
        );
        // Wings: beating from about 30° below level to 80° above, held in a shallow V when gliding.
        const flight = THREE.MathUtils.lerp(0.42 + 0.92 * stroke, kind === SWALLOWTAIL ? 0.12 : 0.28, glide);
        const resting = kind.flutters
          ? 0.85 + 0.32 * Math.sin(2 * Math.PI * 4 * time + butterfly.phase)
          : THREE.MathUtils.lerp(1.5, 0.45, smooth(0.8, 0.97, Math.sin(time * 0.7 + butterfly.phase * 3)));
        const angle = THREE.MathUtils.lerp(resting, flight, flapping);
        wings[0].rotation.z = angle;
        wings[1].rotation.z = -angle;
      }
    },
  };
}
