import * as THREE from 'three';
import { INTERIOR_BOX } from './interiorLights';

// The room's steam after a löyly (not in the source scenes, which have no volume). The puff
// (steam.ts) lasts six seconds; the vapor it leaves fills the room and lingers, denser under the
// ceiling where the hot air rises, and everything seen through it (the stove, the far wall, the
// garden and the sky through the glass) pales toward the steam's color. Drawn in the full-screen
// pass (hdrOutput.ts) from the scene's depth, so every material is hazed alike. Not a volume: the
// share follows the length of the view ray inside the room's box (INTERIOR_BOX, to the glass) from
// a camera in the room, with a density that grows with the height, integrated exactly for the
// box's segment. The steam is lit evenly (no shadows, no light shafts), and only the view is
// hazed, not the light reaching the surfaces; transparent surfaces (glass, the puff) are hazed as
// whatever stands behind them.

/** Seconds over which a löyly's vapor spreads into the room. */
export const HAZE_RISE_SECONDS = 2.5;
/** Seconds over which the vapor thins to 1/e. */
export const HAZE_DECAY_SECONDS = 28;
/** Density each löyly adds (1 at most). */
export const HAZE_PER_LOYLY = 0.5;
/** Extinction (per m) at density 1, on the floor and under the ceiling (linear in between). */
export const HAZE_FLOOR = 0.015;
export const HAZE_CEILING = 0.11;
/** The steam's radiance (scene-linear) by day, a warm white under the room's 2700 K lights. */
export const HAZE_COLOR = [0.62, 0.58, 0.52] as const;
/**
 * Its share at blue hour and at night (lighting.ts sceneWeights): the daylight through the glass
 * no longer fills the room, and the view's exposure opens (a fixed radiance went white).
 */
export const HAZE_SCENES = [1, 0.32, 0.22] as const;

/** The steam's color at the time of day's scene weights. */
export function hazeColor(weights: readonly number[], out: THREE.Color) {
  const scale = weights.reduce((sum, weight, i) => sum + weight * HAZE_SCENES[i], 0);
  return out.setRGB(HAZE_COLOR[0] * scale, HAZE_COLOR[1] * scale, HAZE_COLOR[2] * scale);
}

const vec3 = (v: THREE.Vector3) => `vec3( ${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)} )`;

/**
 * The share of the steam's color along the ray from `origin` over `ray` (its full length) at
 * `density`. Mirrors HAZE_GLSL.
 */
export function hazeAmount(origin: THREE.Vector3, ray: THREE.Vector3, density: number) {
  if (density <= 0 || !INTERIOR_BOX.containsPoint(origin)) return 0;
  let near = 0;
  let far = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const d = ray[axis];
    const a = (INTERIOR_BOX.min[axis] - origin[axis]) / d;
    const b = (INTERIOR_BOX.max[axis] - origin[axis]) / d;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  if (!(far > near)) return 0;
  const height = THREE.MathUtils.clamp(
    (origin.y + (ray.y * (near + far)) / 2 - INTERIOR_BOX.min.y) / (INTERIOR_BOX.max.y - INTERIOR_BOX.min.y),
    0,
    1,
  );
  const depth = density * (far - near) * ray.length() * THREE.MathUtils.lerp(HAZE_FLOOR, HAZE_CEILING, height);
  return 1 - Math.exp(-depth);
}

export const HAZE_GLSL = /* glsl */ `
#ifndef SUI_HAZE
#define SUI_HAZE
uniform float suiSteamHaze;
uniform vec3 suiSteamHazeColor;
// The density is linear in height, so its mean over the segment is the value at its middle.
float suiHazeAmount( const in vec3 origin, const in vec3 ray ) {
	// Seen from inside the room only: the water's mirror and the deck's look from outside.
	if ( any( lessThan( origin, ${vec3(INTERIOR_BOX.min)} ) ) || any( greaterThan( origin, ${vec3(INTERIOR_BOX.max)} ) ) ) return 0.0;
	vec3 lower = ( ${vec3(INTERIOR_BOX.min)} - origin ) / ray;
	vec3 upper = ( ${vec3(INTERIOR_BOX.max)} - origin ) / ray;
	vec3 enter = min( lower, upper );
	vec3 leave = max( lower, upper );
	float near = max( 0.0, max( enter.x, max( enter.y, enter.z ) ) );
	float far = min( 1.0, min( leave.x, min( leave.y, leave.z ) ) );
	if ( far <= near ) return 0.0;
	float height = clamp( ( origin.y + ray.y * 0.5 * ( near + far ) - ${INTERIOR_BOX.min.y.toFixed(4)} ) / ${(INTERIOR_BOX.max.y - INTERIOR_BOX.min.y).toFixed(4)}, 0.0, 1.0 );
	float depth = suiSteamHaze * ( far - near ) * length( ray ) * mix( ${HAZE_FLOOR.toFixed(3)}, ${HAZE_CEILING.toFixed(3)}, height );
	return 1.0 - exp( - depth );
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
