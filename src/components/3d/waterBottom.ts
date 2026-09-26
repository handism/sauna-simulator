import * as THREE from 'three';
import { GLOSSY_SOURCES, areaRadiance, sourceArea } from './glossyLights';
import {
  SIDE_WALL_LAYER,
  VIEW_TINT,
  WATER_ABSORPTION,
  WATER_IOR,
  WATER_TINT,
  WATER_VOLUME,
  waterAirReflectance,
} from './refraction';
// Patches lights_pars_begin first (suiReflection, suiIrradianceEvening).
import './reflection';

// The bottom of the source water. Its flat bottom face lies 1.3 cm above the tiles with air
// between, so in Cycles the view that reaches the pool floor crosses one more water–air boundary
// there: it passes (1 − R), tinted by the water's transmission color like any refraction, and the
// rest is reflected up. The refracted view goes down at least as steeply as the critical angle
// (|d.y| ≥ 0.66), so R runs from 2% looking straight down to 25–100% across the far tiles. The
// reflected view rises as steeply as it came down, may reflect off the sides as the view does
// (refraction.ts), and leaves through the surface along the camera ray mirrored upward: a second,
// fainter and displaced image of what the surface reflects. The large bright disks in the plunge
// at dusk are the lounge dusk fill seen this way (a render with the bottom face moved below the
// tiles loses them), and so is the day's faint V9 patch.
//
// The reflected view sees the reflection probes (reflection.ts, the source water's roughness
// 0.018, as on the surface without its mirror) and, exactly and sharp, the glossy-only area lights
// above the water that face it (glossyLights.ts): V9 and the lounge dusk fill. It leaves the water
// as a transmission ray, so the V7 strip over the pool, which only glossy rays see, is not among
// them, and its blurred share of the probes (baked for glossy rays) is taken out again by its L2
// coefficients seen from above the middle of the pool. Views leaving lower than the tub's rim at a
// side meet the tub and see no light. Light the surface reflects back down returns to the floor:
// the floor's own color stands in for it.

/** The bottom face of the source water, glTF y (the tiles are 1.3 cm below). */
export const WATER_BOTTOM = WATER_VOLUME.min.y;
/** Top of the coping around the water on all four sides, glTF y. */
export const RIM_HEIGHT = 1.035;
/** Side reflections followed on the way up. */
const MAX_SIDES = 3;
/** Half width of the soft edge of a light, relative to its size. */
export const LIGHT_EDGE = 0.03;

type Source = (typeof GLOSSY_SOURCES)[number];

/** Whether a light can be seen from the water surface at `level`: part of it above and facing it. */
function facesSurface([, size, , , , position, axis, direction]: Source, level: number) {
  const n = new THREE.Vector3().fromArray(direction).normalize();
  const x = new THREE.Vector3().fromArray(axis).normalize();
  const y = new THREE.Vector3().crossVectors(n, x);
  const [w, h] = size.length === 2 ? size : [size[0], size[0]];
  const center = new THREE.Vector3().fromArray(position);
  const top = center.y + (Math.abs(x.y) * w + Math.abs(y.y) * h) / 2;
  const { min, max } = WATER_VOLUME;
  const corners = [
    [min.x, min.z],
    [min.x, max.z],
    [max.x, min.z],
    [max.x, max.z],
  ];
  return top > level && corners.some(([cx, cz]) => new THREE.Vector3(cx, level, cz).sub(center).dot(n) > 0);
}

// Glossy-only lights that transmission rays do not see either.
const TRANSMISSION_INVISIBLE = ['V7 water reflection soft strip'];

/** The glossy-only lights the reflected view can reach from the surface at `level`. */
export const bottomLights = (level = WATER_VOLUME.max.y) =>
  GLOSSY_SOURCES.filter((source) => !TRANSMISSION_INVISIBLE.includes(source[0]) && facesSurface(source, level));

export interface Exit {
  /** Where the ray leaves the surface, and its direction in the air. */
  point: THREE.Vector3;
  direction: THREE.Vector3;
  /** The part that leaves: the sides' reflectances times the surface's transmittance. */
  transmittance: number;
  /** The part the surface reflects back down. */
  reflectance: number;
  /** Meters travelled in the water. */
  path: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const sideDistance = (p: number, d: number, low: number, high: number) =>
  Math.abs(d) < 1e-6 ? Infinity : Math.max(0, ((d > 0 ? high : low) - p) / d);

/**
 * A ray in the water rising from `start` along `direction`, reflected off the sides of
 * WATER_VOLUME (fully past the critical angle, otherwise by the Fresnel reflectance: the rest
 * leaves into the tub wall) until it meets the surface at `level`, where it leaves refracted about
 * `normal`. Null when it does not rise, is totally reflected at the surface or meets too many sides.
 */
export function upwardExit(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  level: number,
  normal: (x: number, z: number) => THREE.Vector3 = () => UP,
): Exit | null {
  const p = start.clone();
  const d = direction.clone().normalize();
  if (d.y <= 0) return null;
  const { min, max } = WATER_VOLUME;
  let weight = 1;
  let path = 0;
  for (let i = 0; i <= MAX_SIDES; i++) {
    const tx = sideDistance(p.x, d.x, min.x, max.x);
    const tz = sideDistance(p.z, d.z, min.z, max.z);
    const top = Math.max(0, (level - p.y) / d.y);
    if (top <= Math.min(tx, tz)) {
      p.addScaledVector(d, top);
      path += top;
      const n = normal(p.x, p.z);
      const cos = d.dot(n);
      const k = 1 - WATER_IOR ** 2 * (1 - cos * cos);
      if (cos <= 0 || k <= 0) return null;
      const reflectance = waterAirReflectance(cos);
      const out = d
        .multiplyScalar(WATER_IOR)
        .addScaledVector(n, Math.sqrt(k) - WATER_IOR * cos)
        .normalize();
      return {
        point: p,
        direction: out,
        transmittance: weight * (1 - reflectance),
        reflectance: weight * reflectance,
        path,
      };
    }
    if (i === MAX_SIDES) break;
    const alongX = tx < tz;
    p.addScaledVector(d, Math.min(tx, tz));
    path += Math.min(tx, tz);
    weight *= waterAirReflectance(Math.abs(alongX ? d.x : d.z));
    if (alongX) d.x = -d.x;
    else d.z = -d.z;
  }
  return null;
}

/** Whether a ray leaving the surface at `point` clears the tub's rim where it passes the sides. */
export function clearsRim(point: THREE.Vector3, direction: THREE.Vector3) {
  const { min, max } = WATER_VOLUME;
  const t = Math.min(
    sideDistance(point.x, direction.x, min.x, max.x),
    sideDistance(point.z, direction.z, min.z, max.z),
  );
  return !Number.isFinite(t) || point.y + direction.y * t >= RIM_HEIGHT;
}

/** How much of a ray from `origin` along `direction` meets the front of `source` (soft edged). */
export function lightCoverage(
  [, size, , , , position, axis, facing]: Source,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
) {
  const n = new THREE.Vector3().fromArray(facing).normalize();
  const along = direction.dot(n);
  if (along > -1e-4) return 0;
  const center = new THREE.Vector3().fromArray(position);
  const t = center.clone().sub(origin).dot(n) / along;
  if (t <= 0) return 0;
  const q = origin.clone().addScaledVector(direction, t).sub(center);
  const x = new THREE.Vector3().fromArray(axis).normalize();
  const y = new THREE.Vector3().crossVectors(n, x);
  const distance =
    size.length === 2
      ? Math.max(Math.abs(q.dot(x)) / (size[0] / 2), Math.abs(q.dot(y)) / (size[1] / 2))
      : Math.hypot(q.dot(x), q.dot(y)) / (size[0] / 2);
  return 1 - THREE.MathUtils.smoothstep(distance, 1 - LIGHT_EDGE, 1 + LIGHT_EDGE);
}

/** Radiance of the bottom lights along a ray leaving the surface, `evening` 0 (Daylight) to 1 (Blue hour). */
export function bottomLightRadiance(level: number, origin: THREE.Vector3, direction: THREE.Vector3, evening: number) {
  const sum = [0, 0, 0];
  if (!clearsRim(origin, direction)) return sum;
  for (const source of bottomLights(level)) {
    const coverage = lightCoverage(source, origin, direction);
    const [, size, color, dayWatts, eveningWatts] = source;
    const area = sourceArea(size);
    const day = areaRadiance(dayWatts, color, area);
    const dusk = areaRadiance(eveningWatts, color, area);
    for (let c = 0; c < 3; c++) sum[c] += coverage * (day[c] + (dusk[c] - day[c]) * evening);
  }
  return sum;
}

/** The view `view` (refracted, going down) meeting the water's bottom: its reflectance there. */
export const bottomReflectance = (view: THREE.Vector3) => waterAirReflectance(Math.abs(view.y) / view.length());

/** The view `view` reaching the floor at `floor`, reflected up at the bottom face. */
export function bottomExit(
  floor: THREE.Vector3,
  view: THREE.Vector3,
  level: number,
  normal?: (x: number, z: number) => THREE.Vector3,
) {
  const d = view.clone().normalize();
  const start = floor.clone().addScaledVector(d, (WATER_BOTTOM - floor.y) / d.y);
  return upwardExit(start, new THREE.Vector3(d.x, -d.y, d.z), level, normal);
}

/** three's L2 basis (lightprobes_pars_fragment, reflection probes' order) at unit direction `d`. */
export const shBasis = ({ x, y, z }: THREE.Vector3) => [
  0.282095,
  0.488603 * y,
  0.488603 * z,
  0.488603 * x,
  1.092548 * x * y,
  1.092548 * y * z,
  0.315392 * (3 * z * z - 1),
  1.092548 * x * z,
  0.546274 * (x * x - y * y),
];

/** Where the reflected view looks the probes up: just above the middle of the pool. */
export const PROBE_POINT = new THREE.Vector3(
  (WATER_VOLUME.min.x + WATER_VOLUME.max.x) / 2,
  WATER_VOLUME.max.y + 0.5,
  (WATER_VOLUME.min.z + WATER_VOLUME.max.z) / 2,
);

/**
 * L2 radiance coefficients (9 × rgb) of a Lambertian area light as the probes hold it, seen from
 * `point`: its front integrated over `steps`² cells. [Daylight, Blue hour].
 */
export function sourceSH(
  [, size, color, dayWatts, eveningWatts, position, axis, facing]: Source,
  point: THREE.Vector3,
  steps = 32,
) {
  const n = new THREE.Vector3().fromArray(facing).normalize();
  const x = new THREE.Vector3().fromArray(axis).normalize();
  const y = new THREE.Vector3().crossVectors(n, x);
  const [w, h] = size.length === 2 ? size : [size[0], size[0]];
  const area = sourceArea(size);
  const sums = [dayWatts, eveningWatts].map(() => Array.from({ length: 9 }, () => [0, 0, 0]));
  const radiance = [areaRadiance(dayWatts, color, area), areaRadiance(eveningWatts, color, area)];
  const cell = (w * h) / steps ** 2;
  const at = new THREE.Vector3();
  for (let i = 0; i < steps; i++)
    for (let j = 0; j < steps; j++) {
      const u = ((i + 0.5) / steps - 0.5) * w;
      const v = ((j + 0.5) / steps - 0.5) * h;
      if (size.length === 1 && Math.hypot(u, v) > w / 2) continue;
      at.fromArray(position).addScaledVector(x, u).addScaledVector(y, v).sub(point);
      const r2 = at.lengthSq();
      at.normalize();
      const cos = -at.dot(n);
      if (cos <= 0) continue;
      const solid = (cell * cos) / r2;
      const basis = shBasis(at);
      for (let s = 0; s < 2; s++)
        for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) sums[s][k][c] += radiance[s][c] * basis[k] * solid;
    }
  return sums;
}

const f = (v: number) => v.toFixed(6);
const vec3 = (v: readonly number[]) => `vec3( ${v.map(f).join(', ')} )`;

function lightsGlsl() {
  return bottomLights()
    .map(([name, size, color, dayWatts, eveningWatts, position, axis, facing]) => {
      const n = new THREE.Vector3().fromArray(facing).normalize();
      const x = new THREE.Vector3().fromArray(axis).normalize();
      const y = new THREE.Vector3().crossVectors(n, x);
      const area = sourceArea(size);
      const half = size.length === 2 ? [size[0] / 2, size[1] / 2] : [size[0] / 2, size[0] / 2];
      const distance = size.length === 2 ? 'max( abs( q.x ), abs( q.y ) )' : 'length( q )';
      return `	// ${name}
	along = dot( direction, ${vec3(n.toArray())} );
	t = dot( ${vec3(position)} - origin, ${vec3(n.toArray())} ) / min( along, -1e-4 );
	if ( along < -1e-4 && t > 0.0 ) {
		vec3 hit = origin + direction * t - ${vec3(position)};
		vec2 q = vec2( dot( hit, ${vec3(x.toArray())} ), dot( hit, ${vec3(y.toArray())} ) ) / vec2( ${f(half[0])}, ${f(half[1])} );
		sum += ( 1.0 - smoothstep( ${f(1 - LIGHT_EDGE)}, ${f(1 + LIGHT_EDGE)}, ${distance} ) ) *
			mix( ${vec3(areaRadiance(dayWatts, color, area))}, ${vec3(areaRadiance(eveningWatts, color, area))}, suiIrradianceEvening );
	}
`;
    })
    .join('');
}

// The part of the reflection probes that only glossy rays see (the V7 strip), taken out of the
// reflected view: suiGlossyOnly( direction ) evaluates its L2 coefficients seen from PROBE_POINT.
function glossyOnlyGlsl() {
  const sums = GLOSSY_SOURCES.filter(([name]) => TRANSMISSION_INVISIBLE.includes(name))
    .map((source) => sourceSH(source, PROBE_POINT))
    .reduce((a, b) => a.map((scene, s) => scene.map((k, i) => k.map((c, j) => c + b[s][i][j]))));
  const coefficient = (i: number) => `mix( ${vec3(sums[0][i])}, ${vec3(sums[1][i])}, suiIrradianceEvening )`;
  return `vec3 suiGlossyOnly( vec3 n ) {
	return ${coefficient(0)} * 0.282095 +
		( ${coefficient(1)} * n.y + ${coefficient(2)} * n.z + ${coefficient(3)} * n.x ) * 0.488603 +
		${coefficient(4)} * ( 1.092548 * n.x * n.y ) + ${coefficient(5)} * ( 1.092548 * n.y * n.z ) +
		${coefficient(6)} * ( 0.315392 * ( 3.0 * n.z * n.z - 1.0 ) ) + ${coefficient(7)} * ( 1.092548 * n.x * n.z ) +
		${coefficient(8)} * ( 0.546274 * ( n.x * n.x - n.y * n.y ) );
}`;
}

/**
 * GLSL (after lights_pars_begin, for materials with SUI_WATER_BOTTOM): the radiance the floor's
 * view reflects up at the water's bottom, given the view `d` (refracted, going down) at the floor
 * point and the floor's color; w is the reflectance there. Mirrors bottomExit, upwardExit,
 * clearsRim and bottomLightRadiance. The surface is at SUI_REFRACTION.
 */
export function bottomGlsl() {
  const { min, max } = WATER_VOLUME;
  const box = (v: THREE.Vector3) => `vec2( ${f(v.x)}, ${f(v.z)} )`;
  return /* glsl */ `
#if defined( SUI_WATER_BOTTOM ) && defined( SUI_REFRACTION ) && defined( SUI_REFLECTION )
float suiSideDistance( vec2 p, vec2 d ) {
	vec2 wall = mix( ${box(min)}, ${box(max)}, step( 0.0, d ) );
	vec2 t = max( ( wall - p ) / ( sign( d ) * max( abs( d ), vec2( 1e-6 ) ) ), 0.0 );
	t = mix( vec2( 1e6 ), t, step( 1e-6, abs( d ) ) );
	return min( t.x, t.y );
}
vec3 suiBottomLights( vec3 origin, vec3 direction ) {
	vec3 sum = vec3( 0.0 );
	if ( origin.y + direction.y * suiSideDistance( origin.xz, direction.xz ) < ${f(RIM_HEIGHT)} ) return sum;
	float along;
	float t;
${lightsGlsl()}	return sum;
}
${glossyOnlyGlsl()}
vec4 suiBottomReflection( vec3 point, vec3 d, vec3 floorColor ) {
	d = normalize( d );
	float reflectance = suiWaterAirReflectance( - d.y );
	vec3 p = point + d * ( ( ${f(WATER_BOTTOM)} - point.y ) / d.y );
	d.y = - d.y;
	float weight = 1.0;
	float path = 0.0;
	vec3 up = vec3( 0.0 );
	for ( int i = 0; i <= ${MAX_SIDES}; i ++ ) {
		vec2 wall = mix( ${box(min)}, ${box(max)}, step( 0.0, d.xz ) );
		vec2 t = mix( vec2( 1e6 ), max( ( wall - p.xz ) / ( sign( d.xz ) * max( abs( d.xz ), vec2( 1e-6 ) ) ), 0.0 ), step( 1e-6, abs( d.xz ) ) );
		float top = max( 0.0, ( float( SUI_REFRACTION ) - p.y ) / d.y );
		if ( top <= min( t.x, t.y ) ) {
			p += d * top;
			path += top;
			vec3 n = suiWaveNormal( p.xz, suiWaterTime );
			float cosine = dot( d, n );
			vec3 leaving = refract( d, - n, ${f(WATER_IOR)} );
			if ( cosine <= 0.0 || dot( leaving, leaving ) == 0.0 ) break;
			float surface = suiWaterAirReflectance( cosine );
			leaving = normalize( leaving );
			vec3 seen = max( suiReflection( p + n * 0.02, n, leaving, 0.018, false, false ) - suiGlossyOnly( leaving ), 0.0 ) + suiBottomLights( p, leaving );
			up = weight * ( ( 1.0 - surface ) * ${vec3(WATER_TINT)} * seen + surface * floorColor ) *
				exp( - ${vec3(WATER_ABSORPTION)} * path );
			break;
		}
		if ( i == ${MAX_SIDES} ) break;
		bool alongX = t.x < t.y;
		p += d * min( t.x, t.y );
		path += min( t.x, t.y );
		weight *= suiWaterAirReflectance( abs( alongX ? d.x : d.z ) );
		if ( alongX ) d.x = - d.x;
		else d.z = - d.z;
	}
	return vec4( up, reflectance );
}
#endif
`;
}

// Opaque_fragment, before the view tint of refraction.ts: the floor under the water's bottom is
// seen through it and the reflection is added. suiWetView is the refracted view there
// (refraction.ts), zero for fragments not seen through the water. The foot of the tub walls just
// behind the sides counts as floor: their mirrored images meet the floor's along the corners.
const BLEND = /* glsl */ `
#if defined( SUI_WATER_BOTTOM ) && defined( SUI_REFRACTION ) && defined( SUI_REFLECTION )
if ( suiWetView.y < 0.0 && suiWorldPosition.y < ${f(WATER_BOTTOM)} && all( greaterThan( suiWorldPosition.xz, vec2( ${f(WATER_VOLUME.min.x - SIDE_WALL_LAYER)}, ${f(WATER_VOLUME.min.z - SIDE_WALL_LAYER)} ) ) ) && all( lessThan( suiWorldPosition.xz, vec2( ${f(WATER_VOLUME.max.x + SIDE_WALL_LAYER)}, ${f(WATER_VOLUME.max.z + SIDE_WALL_LAYER)} ) ) ) ) {
	vec4 suiBottom = suiBottomReflection( suiWorldPosition, suiWetView, gl_FragColor.rgb );
	gl_FragColor.rgb = ( 1.0 - suiBottom.a ) * ${vec3(WATER_TINT)} * gl_FragColor.rgb + suiBottom.a * suiBottom.rgb;
}
#endif
`;

/**
 * Marks the materials of `root` drawn through the water (SUI_REFRACTION) that have triangles
 * under the water's bottom (the pool floor). Returns their number.
 */
export function applyWaterBottom(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const a = new THREE.Vector3();
  const { min, max } = WATER_VOLUME;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const list: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    const groups = object.geometry.groups.length
      ? object.geometry.groups
      : [{ start: 0, count: Infinity, materialIndex: 0 }];
    const index = object.geometry.index;
    for (const group of groups) {
      const material = list[group.materialIndex ?? 0];
      if (!(material instanceof THREE.MeshStandardMaterial) || material.defines?.SUI_REFRACTION === undefined) continue;
      if (materials.has(material)) continue;
      const end = Math.min(group.start + group.count, index ? index.count : position.count);
      for (let i = group.start; i < end; i++) {
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(object.matrixWorld);
        const m = SIDE_WALL_LAYER;
        if (a.y < min.y && a.x > min.x - m && a.x < max.x + m && a.z > min.z - m && a.z < max.z + m) {
          materials.add(material);
          break;
        }
      }
    }
  });
  for (const material of materials) {
    material.defines = { ...material.defines, SUI_WATER_BOTTOM: '' };
    material.needsUpdate = true;
  }
  return materials.size;
}

// three 0.186 is pinned; refraction.ts has added the view tint.
if (!THREE.ShaderChunk.lights_pars_begin.includes('suiBottomReflection')) {
  const opaque = THREE.ShaderChunk.opaque_fragment;
  const at = opaque.indexOf(VIEW_TINT);
  if (at < 0) throw new Error('three shader chunks changed; update waterBottom.ts');
  THREE.ShaderChunk.lights_pars_begin += bottomGlsl();
  THREE.ShaderChunk.opaque_fragment = opaque.slice(0, at) + BLEND + opaque.slice(at);
}
