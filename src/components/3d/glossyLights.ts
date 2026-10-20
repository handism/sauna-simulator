import * as THREE from 'three';
import { MIRROR_LAYER } from './planarReflection';

// Cycles area lights that glossy rays see (camera rays do not). Their shapes show in the plunge's
// sharp reflection: 'V7 water reflection soft strip' exists only for that, and V9 and the lounge
// dusk fill leave large bright disks on the water. The water's mirror (planarReflection.ts)
// renders geometry only, and the water surface takes no browser light, so they were missing; the
// L2 reflection probes (reflection.ts) hold some of them only as a soft sheen.
//
// Every one is a 180° spread light: a Lambertian emitter of radiance P·color / (π·A) on its front
// (the side it shines to), in the same watt units as the other browser lights. They are drawn as
// one mesh on MIRROR_LAYER, which only the mirror's camera renders, and blend between the powers
// of the Daylight and Blue hour scenes (the same positions in both; the Night scene keeps the Blue
// hour powers, scripts/build_night_scene.py).

// Blender name, shape and size in meters ([width, height] for rectangles, [diameter] for disks),
// linear color, W in the Daylight and Blue hour scenes, location, local X and the direction it
// shines (Blender's local −Z), in glTF axes.
type Source = [string, number[], [number, number, number], number, number, number[], number[], number[]];
const DUSK: [number, number, number] = [1, 0.7, 0.39];
export const GLOSSY_SOURCES: Source[] = [
  [
    'V7 water reflection soft strip',
    [2.2, 1.6],
    [0.78, 0.88, 1],
    65,
    65,
    [0.3, 5, -2.2],
    [0.3227, 0, 0.9465],
    [0.2032, -0.9767, -0.0693],
  ],
  [
    'V7 concealed backrest wash',
    [4.35, 0.16],
    [1, 0.57, 0.26],
    16,
    16,
    [-3.6, 1.5, -4.44],
    [1, 0, 0],
    [0, 0.9685, -0.249],
  ],
  [
    'V8 maple garden grazing light',
    [0.65],
    [1, 0.77, 0.48],
    28,
    55,
    [3.5, 0.48, -5.3],
    [0.7226, 0, 0.6912],
    [0.5736, 0.558, -0.5997],
  ],
  [
    'V9 lounge patch of sunlight',
    [1.25],
    [1, 0.84, 0.62],
    950,
    0,
    [3.8, 6.8, 1.5],
    [0.945, 0, 0.3271],
    [0.13, -0.9176, -0.3757],
  ],
  ['V10 lounge dusk fill', [2], DUSK, 3.36, 42, [5.9, 2.8, 1.4], [0.9091, 0, -0.4167], [-0.3142, -0.6569, -0.6854]],
  [
    'V10 path grazing light 1',
    [0.28],
    DUSK,
    0.64,
    8,
    [-0.9754, -0.1338, 8.89],
    [0.2276, 0, 0.9737],
    [0.9661, -0.1255, -0.2258],
  ],
  [
    'V10 path grazing light 4',
    [0.28],
    DUSK,
    0.64,
    8,
    [-0.7056, -0.0702, 7.06],
    [0.2276, 0, 0.9737],
    [0.9661, -0.1255, -0.2258],
  ],
  [
    'V10 path grazing light 7',
    [0.28],
    DUSK,
    0.64,
    8,
    [-1.2998, -0.0486, 5.23],
    [0.2276, 0, 0.9737],
    [0.9661, -0.1255, -0.2258],
  ],
  ['V10 specimen uplight', [0.6], DUSK, 2.8, 35, [0.5, 0.04, 5.7], [-0.4472, 0, 0.8944], [0.3186, 0.9344, 0.1593]],
  ['V10 concealed deck edge -3.7', [0.65], DUSK, 0.96, 12, [-3.7, -0.04, 3.86], [-1, 0, 0], [0, -0.2487, 0.9686]],
  ['V10 concealed deck edge 0', [0.65], DUSK, 0.96, 12, [0, -0.04, 3.86], [-1, 0, 0], [0, -0.2487, 0.9686]],
  ['V10 concealed deck edge 4.4', [0.65], DUSK, 0.96, 12, [4.4, -0.04, 3.86], [-1, 0, 0], [0, -0.2487, 0.9686]],
];

/** Area of the source shape: a rectangle, or a disk of the given diameter. */
export const sourceArea = (size: number[]) => (size.length === 2 ? size[0] * size[1] : (Math.PI * size[0] ** 2) / 4);

/** Radiance of a Lambertian area light of `watts` and linear `color` over `area`. */
export const areaRadiance = (watts: number, color: readonly number[], area: number) =>
  color.map((c) => (watts * c) / (Math.PI * area));

const DISK_SEGMENTS = 32;

/**
 * Not in the source: disks whose mirrored image is blurred. The lounge dusk fill (a 2 m disk) lay on
 * the dusk and night water as a sharp cream shape, which read as a cutout. Its radiance is full
 * inside `core` (relative to the radius), falls by e every `falloff` beyond it and is drawn out to
 * `reach` (under 1% there), scaled so the disk emits the source's power.
 */
export const SOFT_GLOSSY: Record<string, { core: number; falloff: number; reach: number }> = {
  'V10 lounge dusk fill': { core: 0.6, falloff: 0.25, reach: 1.8 },
};
/** The blurred profile at `r` (relative to the radius), before the scale that keeps the power. */
export const softProfile = ({ core, falloff, reach }: { core: number; falloff: number; reach: number }, r: number) =>
  r < reach ? Math.exp(-Math.max(0, r - core) / falloff) : 0;
/** The scale that keeps a blurred disk's power: its profile integrated over the plane, per unit disk. */
export function softScale(soft: { core: number; falloff: number; reach: number }) {
  const steps = 2000;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const r = ((i + 0.5) / steps) * soft.reach;
    sum += 2 * r * softProfile(soft, r) * (soft.reach / steps);
  }
  return 1 / sum;
}

export function createGlossyLights() {
  const positions: number[] = [];
  const day: number[] = [];
  const evening: number[] = [];
  const sunlit: number[] = [];
  // The point in the light's plane relative to its radius, and core, falloff and scale (0, 0, 1 when sharp).
  const local: number[] = [];
  const softness: number[] = [];
  const basis = new THREE.Matrix4();
  const x = new THREE.Vector3(),
    y = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (const [name, size, color, dayWatts, eveningWatts, position, axis, direction] of GLOSSY_SOURCES) {
    const soft = SOFT_GLOSSY[name];
    const blur = soft ? [soft.core, soft.falloff, softScale(soft)] : [0, 0, 1];
    // The polygon keeps the disk's area, so it emits the same power.
    const shape =
      size.length === 2
        ? new THREE.PlaneGeometry(size[0], size[1])
        : new THREE.CircleGeometry(
            (size[0] / 2) *
              (soft?.reach ?? 1) *
              Math.sqrt((2 * Math.PI) / (DISK_SEGMENTS * Math.sin((2 * Math.PI) / DISK_SEGMENTS))),
            DISK_SEGMENTS,
          );
    // The geometry's front (+Z) faces where the light shines.
    n.fromArray(direction).normalize();
    x.fromArray(axis).normalize();
    y.crossVectors(n, x);
    basis.makeBasis(x, y, n).setPosition(position[0], position[1], position[2]);
    const flat = shape.toNonIndexed();
    const plane = flat.attributes.position;
    for (let i = 0; i < plane.count; i++) local.push(plane.getX(i) / (size[0] / 2), plane.getY(i) / (size[0] / 2));
    flat.applyMatrix4(basis);
    shape.dispose();
    const area = sourceArea(size);
    const radiance = [areaRadiance(dayWatts, color, area), areaRadiance(eveningWatts, color, area)];
    const count = flat.attributes.position.count;
    positions.push(...(flat.attributes.position.array as Float32Array));
    for (let i = 0; i < count; i++) {
      day.push(...radiance[0]);
      evening.push(...radiance[1]);
      sunlit.push(name === 'V9 lounge patch of sunlight' ? 1 : 0);
      softness.push(...blur);
    }
    flat.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('dayRadiance', new THREE.Float32BufferAttribute(day, 3));
  geometry.setAttribute('eveningRadiance', new THREE.Float32BufferAttribute(evening, 3));
  // The sunlight patch (V9), which the rain's overcast puts out.
  geometry.setAttribute('sunlit', new THREE.Float32BufferAttribute(sunlit, 1));
  geometry.setAttribute('local', new THREE.Float32BufferAttribute(local, 2));
  geometry.setAttribute('softness', new THREE.Float32BufferAttribute(softness, 3));
  const amount = { value: 0 };
  const sunlight = { value: 1 };
  const material = new THREE.ShaderMaterial({
    uniforms: { evening: amount, sunlight },
    vertexShader: `attribute vec3 dayRadiance; attribute vec3 eveningRadiance; attribute float sunlit;
      attribute vec2 local; attribute vec3 softness;
      uniform float evening; uniform float sunlight;
      varying vec3 vRadiance; varying vec2 vLocal; varying vec3 vSoftness;
      void main() {
        vRadiance = mix(dayRadiance * mix(1.0, sunlight, sunlit), eveningRadiance, evening);
        vLocal = local;
        vSoftness = softness;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `varying vec3 vRadiance; varying vec2 vLocal; varying vec3 vSoftness;
      void main() {
        float soft = vSoftness.y > 0.0 ? exp(-max(0.0, length(vLocal) - vSoftness.x) / vSoftness.y) : 1.0;
        gl_FragColor = vec4(vRadiance * soft * vSoftness.z, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'glossy lights';
  mesh.layers.set(MIRROR_LAYER);
  return {
    mesh,
    /** 0 for the Daylight powers, 1 for Blue hour and Night; the share of the sunlight the rain leaves. */
    update(eveningAmount: number, sunlightAmount = 1) {
      amount.value = eveningAmount;
      sunlight.value = sunlightAmount;
    },
  };
}
