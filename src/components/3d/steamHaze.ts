import * as THREE from 'three';
import { INTERIOR_BOX, interiorPointSources } from './interiorLights';

// The room's steam after a löyly (not in the source scenes, which have no volume). The puff
// (steam.ts) lasts six seconds; the vapor it leaves fills the room and lingers, denser under the
// ceiling where the hot air rises, and everything seen through it (the stove, the far wall, the
// garden and the sky through the glass) pales toward the steam's color. Drawn in the full-screen
// pass (hdrOutput.ts) from the scene's depth, so every material is hazed alike. Not a volume: the
// share follows the length of the view ray inside the room's box (INTERIOR_BOX, to the glass) from
// a camera in the room, with a density that grows with the height, integrated exactly for the
// box's segment. The steam takes an even light (HAZE_COLOR: the daylight through the glass and the
// room's bounce) and, along the segment, the room's six lights (interiorLights.ts, as points with
// their cosine), so it glows around the bench strips, under the ceiling light and in the source's
// 'Steam soft backlight' by the glass. Single scattering, isotropic, without shadows or the
// extinction between a light and the steam; only the view is hazed, not the light reaching the
// surfaces; transparent surfaces (glass, the puff) are hazed as whatever stands behind them.

/** Seconds over which a löyly's vapor spreads into the room. */
export const HAZE_RISE_SECONDS = 2.5;
/** Seconds over which the vapor thins to 1/e. */
export const HAZE_DECAY_SECONDS = 28;
/** Density each löyly adds (1 at most). */
export const HAZE_PER_LOYLY = 0.5;
/** Extinction (per m) at density 1, on the floor and under the ceiling (linear in between). */
export const HAZE_FLOOR = 0.015;
export const HAZE_CEILING = 0.11;
/**
 * The steam's even radiance (scene-linear) by day: the daylight through the glass and the room's
 * bounce. The room's lights add their warm light on top (HAZE_LIGHT).
 */
export const HAZE_COLOR = [0.52, 0.51, 0.48] as const;
/**
 * Its share at blue hour and at night (lighting.ts sceneWeights): the daylight through the glass
 * no longer fills the room, and the view's exposure opens (a fixed radiance went white).
 */
export const HAZE_SCENES = [1, 0.22, 0.14] as const;
/**
 * The room's lights as points (interiorLights.ts, cells of at most 1.5 m: 16) and the closest a
 * view ray is taken to pass one (m), the size of a cell, so a ray through a light stays finite.
 */
export const HAZE_SOURCES = interiorPointSources(1.5);
export const HAZE_SOURCE_RADIUS = 0.25;
/** The share of the lights' single scattering drawn (1 is a white, isotropic droplet cloud). */
export const HAZE_LIGHT = 0.25;

/** The steam's color at the time of day's scene weights. */
export function hazeColor(weights: readonly number[], out: THREE.Color) {
  const scale = weights.reduce((sum, weight, i) => sum + weight * HAZE_SCENES[i], 0);
  return out.setRGB(HAZE_COLOR[0] * scale, HAZE_COLOR[1] * scale, HAZE_COLOR[2] * scale);
}

const vec3 = (v: THREE.Vector3) => `vec3( ${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)} )`;

/** The part of the ray from `origin` over `ray` inside the room, as fractions of `ray`; null for none. */
function roomSegment(origin: THREE.Vector3, ray: THREE.Vector3) {
  if (!INTERIOR_BOX.containsPoint(origin)) return null;
  let near = 0;
  let far = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = ray[axis];
    const a = (INTERIOR_BOX.min[axis] - origin[axis]) / d;
    const b = (INTERIOR_BOX.max[axis] - origin[axis]) / d;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return far > near ? { near, far } : null;
}

/**
 * The share of the steam's color along the ray from `origin` over `ray` (its full length) at
 * `density`. Mirrors HAZE_GLSL.
 */
export function hazeAmount(origin: THREE.Vector3, ray: THREE.Vector3, density: number) {
  const segment = density > 0 ? roomSegment(origin, ray) : null;
  if (!segment) return 0;
  const { near, far } = segment;
  const height = THREE.MathUtils.clamp(
    (origin.y + (ray.y * (near + far)) / 2 - INTERIOR_BOX.min.y) / (INTERIOR_BOX.max.y - INTERIOR_BOX.min.y),
    0,
    1,
  );
  const depth = density * (far - near) * ray.length() * THREE.MathUtils.lerp(HAZE_FLOOR, HAZE_CEILING, height);
  return 1 - Math.exp(-depth);
}

/**
 * The mean radiance the room's lights scatter toward the camera from the steam along the room's
 * part of the ray from `origin` over `ray` (scene-linear; × the haze's share). Mirrors HAZE_GLSL.
 */
export function hazeLight(origin: THREE.Vector3, ray: THREE.Vector3, out: THREE.Color) {
  out.setRGB(0, 0, 0);
  const segment = roomSegment(origin, ray);
  if (!segment) return out;
  const length = ray.length();
  const u = ray.clone().divideScalar(length);
  const t0 = segment.near * length;
  const t1 = segment.far * length;
  const w = new THREE.Vector3();
  for (const { position, emit, intensity } of HAZE_SOURCES) {
    const j = sourceIntegral(w.subVectors(origin, position), u, emit, t0, t1);
    out.r += intensity.r * j;
    out.g += intensity.g * j;
    out.b += intensity.b * j;
  }
  return out.multiplyScalar(HAZE_LIGHT / (4 * Math.PI * (t1 - t0)));
}

/**
 * ∫ max(cos θ, 0) / d² dt from t0 to t1 along origin + t·u (unit) for a point at `w` = origin −
 * light shining along `emit`: cos θ / d² = emit·(p − light) / d³, in closed form once the part
 * behind the light is cut off.
 */
function sourceIntegral(w: THREE.Vector3, u: THREE.Vector3, emit: THREE.Vector3, t0: number, t1: number) {
  const tc = -w.dot(u);
  const h2 = w.lengthSq() - tc * tc + HAZE_SOURCE_RADIUS * HAZE_SOURCE_RADIUS;
  const b = emit.dot(u);
  const a = emit.dot(w) + b * tc;
  let from = t0 - tc;
  let to = t1 - tc;
  if (Math.abs(b) > 1e-4) {
    if (b > 0) from = Math.max(from, -a / b);
    else to = Math.min(to, -a / b);
  } else if (a <= 0) return 0;
  if (!(to > from)) return 0;
  const f = (t: number) => {
    const r = Math.sqrt(h2 + t * t);
    return (a * t) / (h2 * r) - b / r;
  };
  return Math.max(0, f(to) - f(from));
}

const sourcesGlsl = () =>
  HAZE_SOURCES.map(
    ({ position, emit, intensity }) =>
      `	light += ${vec3(new THREE.Vector3(intensity.r, intensity.g, intensity.b))} * suiHazeSource( origin - ${vec3(position)}, u, ${vec3(emit)}, t0, t1 );\n`,
  ).join('');

export const HAZE_GLSL = /* glsl */ `
#ifndef SUI_HAZE
#define SUI_HAZE
uniform float suiSteamHaze;
uniform vec3 suiSteamHazeColor;
// sourceIntegral.
float suiHazeSource( const in vec3 w, const in vec3 u, const in vec3 emit, const in float t0, const in float t1 ) {
	float tc = - dot( w, u );
	float h2 = dot( w, w ) - tc * tc + ${(HAZE_SOURCE_RADIUS * HAZE_SOURCE_RADIUS).toFixed(4)};
	float b = dot( emit, u );
	float a = dot( emit, w ) + b * tc;
	float lo = t0 - tc;
	float hi = t1 - tc;
	if ( abs( b ) > 1e-4 ) {
		if ( b > 0.0 ) lo = max( lo, - a / b );
		else hi = min( hi, - a / b );
	} else if ( a <= 0.0 ) return 0.0;
	if ( hi <= lo ) return 0.0;
	float rHi = sqrt( h2 + hi * hi );
	float rLo = sqrt( h2 + lo * lo );
	return max( 0.0, ( a * hi / ( h2 * rHi ) - b / rHi ) - ( a * lo / ( h2 * rLo ) - b / rLo ) );
}
// The lights' scattered radiance over the room's part of the ray (rgb, hazeLight) and the haze's
// share (a, hazeAmount). The density is linear in height, so its mean over the segment is the value
// at its middle.
vec4 suiHaze( const in vec3 origin, const in vec3 ray ) {
	// Seen from inside the room only: the water's mirror and the deck's look from outside.
	if ( any( lessThan( origin, ${vec3(INTERIOR_BOX.min)} ) ) || any( greaterThan( origin, ${vec3(INTERIOR_BOX.max)} ) ) ) return vec4( 0.0 );
	vec3 lower = ( ${vec3(INTERIOR_BOX.min)} - origin ) / ray;
	vec3 upper = ( ${vec3(INTERIOR_BOX.max)} - origin ) / ray;
	vec3 enter = min( lower, upper );
	vec3 leave = max( lower, upper );
	float near = max( 0.0, max( enter.x, max( enter.y, enter.z ) ) );
	float far = min( 1.0, min( leave.x, min( leave.y, leave.z ) ) );
	if ( far <= near ) return vec4( 0.0 );
	float height = clamp( ( origin.y + ray.y * 0.5 * ( near + far ) - ${INTERIOR_BOX.min.y.toFixed(4)} ) / ${(INTERIOR_BOX.max.y - INTERIOR_BOX.min.y).toFixed(4)}, 0.0, 1.0 );
	float len = length( ray );
	float depth = suiSteamHaze * ( far - near ) * len * mix( ${HAZE_FLOOR.toFixed(3)}, ${HAZE_CEILING.toFixed(3)}, height );
	vec3 u = ray / len;
	float t0 = near * len;
	float t1 = far * len;
	vec3 light = vec3( 0.0 );
${sourcesGlsl()}	return vec4( light * ${(HAZE_LIGHT / (4 * Math.PI)).toFixed(5)} / ( t1 - t0 ), 1.0 - exp( - depth ) );
}
#endif
`;

export function createHazeUniforms() {
  return {
    /** The room's vapor (0 clear, 1 after a full löyly); createSteamHaze sets it. 0 skips the depth. */
    suiSteamHaze: { value: 0 },
    suiSteamHazeColor: { value: new THREE.Color(...HAZE_COLOR) },
  };
}

/** The density over time: each löyly adds to it, spreading in and thinning out. */
export function createSteamHaze(uniforms: ReturnType<typeof createHazeUniforms>) {
  // The vapor still to spread in, and the density spread so far.
  let pending = 0;
  let density = 0;
  let last = -Infinity;
  return {
    start() {
      pending = Math.min(1 - density, pending + HAZE_PER_LOYLY);
    },
    /** Advances to `now` (ms); `active` is false outside the room's stage, where the vapor clears at once. */
    update(now: number, active: boolean) {
      const dt = last > -Infinity ? Math.min(0.25, Math.max(0, (now - last) / 1000)) : 0;
      last = now;
      if (!active) {
        pending = density = 0;
      } else {
        const spread = pending * (1 - Math.exp(-dt / (HAZE_RISE_SECONDS / 3)));
        pending -= spread;
        density = Math.min(1, density * Math.exp(-dt / HAZE_DECAY_SECONDS) + spread);
        if (density < 0.003 && pending < 0.003) pending = density = 0;
      }
      uniforms.suiSteamHaze.value = density;
      return density;
    },
  };
}
