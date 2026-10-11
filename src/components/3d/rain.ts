import * as THREE from 'three';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';

// Falling rain and snow around the camera, in a box that follows the camera and wraps, so the
// drops stay put in the world while the view turns. Rain is thin camera-facing streaks (the
// motion blur of a drop over a short exposure); snow is soft round flakes that fall slowly and
// sway. Not in the source scenes; an approximation drawn over the lighting of the time of day
// (lighting.ts). Neither falls under the sauna room's roof, and both stop at the plunge's surface,
// where waterEffects.ts draws the rain's rings (snow melts without them).

export type Precipitation = 'rain' | 'snow';

interface Fall {
  /** Particles in the box at full amount; a share of them falls at a partial amount (the fade in and out). */
  count: number;
  /** Fall speed (m/s) and a light wind's drift (m/s along x and z). */
  speed: number;
  wind: readonly [number, number];
  /** Sideways sway of a flake (m) and its rate (rad/s); 0 for rain. */
  sway: number;
  swayRate: number;
  /** Width of a drop or flake (m); below a pixel it is drawn a pixel wide (1.5 for a flake), keeping its light. */
  size: number;
  /** Peak opacity at that size. */
  opacity: number;
  /** Radiance against the overcast sky's (a flake is whiter than a drop). */
  brightness: number;
}

export const FALLS: Record<Precipitation, Fall> = {
  rain: {
    count: 14000,
    speed: 7.5,
    wind: [0.9, 0.35],
    sway: 0,
    swayRate: 0,
    size: 0.003,
    opacity: 0.6,
    brightness: 1,
  },
  snow: {
    count: 20000,
    speed: 0.9,
    wind: [0.3, 0.12],
    sway: 0.22,
    swayRate: 1.3,
    size: 0.02,
    opacity: 0.9,
    brightness: 1.8,
  },
};
export const RAIN_DROPS = FALLS.rain.count;
/** Horizontal size of the box around the camera and its height range (m). */
export const RAIN_SPAN = 18;
const RAIN_BOTTOM = -0.5;
const RAIN_HEIGHT = 8;
export const RAIN_SPEED = FALLS.rain.speed;
/** Exposure a rain streak spans (s). */
const STREAK_SECONDS = 0.045;
/** Margin of the sauna room's roof beyond its walls (m). */
const EAVES = 0.3;

const f = (value: number) => value.toFixed(6);

/**
 * Where a drop or flake is at `time`: seed (x, z, phase, sway phase) in [0, 1), the camera's xz.
 * Mirrors the vertex shader.
 */
export function dropPosition(
  seed: readonly number[],
  center: readonly [number, number],
  time: number,
  kind: Precipitation = 'rain',
) {
  const fall = FALLS[kind];
  const wrap = (s: number, c: number) => c + (((((s - c / RAIN_SPAN) % 1) + 1) % 1) - 0.5) * RAIN_SPAN;
  const height = (((seed[2] - (time * fall.speed) / RAIN_HEIGHT) % 1) + 1) % 1;
  // Higher drops are further upwind: the streaks slant with the wind.
  const drift = (height * RAIN_HEIGHT) / fall.speed;
  const phase = time * fall.swayRate + (seed[3] ?? 0) * 2 * Math.PI;
  return [
    wrap(seed[0], center[0]) - fall.wind[0] * drift + fall.sway * Math.sin(phase),
    RAIN_BOTTOM + height * RAIN_HEIGHT,
    wrap(seed[1], center[1]) - fall.wind[1] * drift + fall.sway * Math.cos(phase * 0.8),
  ];
}

/** Whether rain or snow reaches world (x, z): not under the sauna room's roof. */
export function rainReaches(x: number, z: number) {
  return !(
    x > INTERIOR_BOX.min.x - EAVES &&
    x < INTERIOR_BOX.max.x + EAVES &&
    z > INTERIOR_BOX.min.z - EAVES &&
    z < INTERIOR_BOX.max.z + EAVES
  );
}

function vertexShader(fall: Fall, snow: boolean) {
  return /* glsl */ `
attribute vec4 seed;
attribute vec2 corner;
uniform float suiRainTime;
uniform float suiRainAmount;
uniform vec2 suiRainCenter;
uniform float suiRainViewport;
varying float vSuiRainAlpha;
varying vec2 vSuiRainCorner;
varying vec3 vSuiRainWorld;
void main() {
	vSuiRainCorner = corner;
	vSuiRainAlpha = 0.0;
	// A share of the drops falls at a partial amount; the rest leave the clip volume.
	gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
	if ( seed.w >= suiRainAmount ) return;
	vec2 xz = suiRainCenter + ( fract( seed.xy - suiRainCenter / ${f(RAIN_SPAN)} ) - 0.5 ) * ${f(RAIN_SPAN)};
	float fall = fract( seed.z - suiRainTime * ${f(fall.speed / RAIN_HEIGHT)} );
	vec3 wind = vec3( ${f(fall.wind[0])}, 0.0, ${f(fall.wind[1])} );
	vec3 head = vec3( xz.x, ${f(RAIN_BOTTOM)} + fall * ${f(RAIN_HEIGHT)}, xz.y ) - wind * ( fall * ${f(RAIN_HEIGHT / fall.speed)} );
	if ( head.x > ${f(INTERIOR_BOX.min.x - EAVES)} && head.x < ${f(INTERIOR_BOX.max.x + EAVES)} && head.z > ${f(INTERIOR_BOX.min.z - EAVES)} && head.z < ${f(INTERIOR_BOX.max.z + EAVES)} ) return;
	float fade = 1.0 - smoothstep( ${f(RAIN_SPAN * 0.32)}, ${f(RAIN_SPAN * 0.5)}, length( head.xz - suiRainCenter ) );
${
  snow
    ? `	// The flake sways (seed.w also orders the flakes for the amount, so the phase takes it whole).
	float phase = suiRainTime * ${f(fall.swayRate)} + seed.w * ${f(2 * Math.PI)};
	head.xz += ${f(fall.sway)} * vec2( sin( phase ), cos( phase * 0.8 ) );
	vec3 point = ( viewMatrix * vec4( head, 1.0 ) ).xyz;
	if ( point.z > - 0.05 ) return;
	float pixel = - point.z * 2.0 / ( projectionMatrix[ 1 ][ 1 ] * suiRainViewport );
	// A flake smaller than a pixel and a half spreads its light over that.
	float size = max( ${f(fall.size)}, 1.5 * pixel );
	float share = ${f(fall.size)} / size;
	vSuiRainAlpha = ${f(fall.opacity)} * share * share * smoothstep( 0.3, 0.8, length( point ) ) * fade;
	vSuiRainWorld = head;
	gl_Position = projectionMatrix * vec4( point + vec3( corner.x, corner.y * 2.0 - 1.0, 0.0 ) * 0.5 * size, 1.0 );`
    : `	vec3 velocity = wind - vec3( 0.0, ${f(fall.speed)}, 0.0 );
	vec3 tail = head - velocity * ${f(STREAK_SECONDS)};
	vec3 viewHead = ( viewMatrix * vec4( head, 1.0 ) ).xyz;
	vec3 viewTail = ( viewMatrix * vec4( tail, 1.0 ) ).xyz;
	vec3 point = mix( viewHead, viewTail, corner.y );
	float distance = length( point );
	// Across the streak, facing the camera.
	vec3 side = cross( viewTail - viewHead, point );
	if ( dot( side, side ) < 1e-12 || point.z > - 0.05 ) return;
	side = normalize( side );
	// A drop thinner than a pixel is drawn a pixel wide, keeping its light.
	float pixel = - point.z * 2.0 / ( projectionMatrix[ 1 ][ 1 ] * suiRainViewport );
	float width = max( ${f(fall.size)}, pixel );
	vSuiRainAlpha = ${f(fall.opacity)} * ${f(fall.size)} / width * smoothstep( 0.4, 1.2, distance ) * fade;
	vSuiRainWorld = mix( head, tail, corner.y );
	gl_Position = projectionMatrix * vec4( point + side * corner.x * 0.5 * width, 1.0 );`
}
}`;
}

function fragmentShader(fall: Fall, snow: boolean) {
  return /* glsl */ `
uniform vec3 suiRainColor;
varying float vSuiRainAlpha;
varying vec2 vSuiRainCorner;
varying vec3 vSuiRainWorld;
void main() {
	// Into the plunge it ends at the surface (nothing falls under the water).
	if ( vSuiRainWorld.y < ${f(WATER_BOX.max.y)} && all( greaterThan( vSuiRainWorld.xz, vec2( ${f(WATER_BOX.min.x)}, ${f(WATER_BOX.min.z)} ) ) ) && all( lessThan( vSuiRainWorld.xz, vec2( ${f(WATER_BOX.max.x)}, ${f(WATER_BOX.max.z)} ) ) ) ) discard;
${
  snow
    ? `	// A soft round flake.
	float shape = 1.0 - smoothstep( 0.35, 1.0, length( vec2( vSuiRainCorner.x, vSuiRainCorner.y * 2.0 - 1.0 ) ) );`
    : `	float shape = ( 1.0 - abs( vSuiRainCorner.x ) ) * smoothstep( 0.0, 0.25, vSuiRainCorner.y ) * ( 1.0 - smoothstep( 0.6, 1.0, vSuiRainCorner.y ) );`
}
	gl_FragColor = vec4( suiRainColor * ${f(fall.brightness)}, vSuiRainAlpha * shape );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
}

/**
 * The rain's streaks or the snow's flakes. `update` takes its share (0 hides it), the scene-linear
 * radiance of the overcast sky and the time (still with reduced motion). It is visible until the
 * first `update`, so the scene's compile includes its program.
 */
export function createRain(kind: Precipitation = 'rain') {
  const fall = FALLS[kind];
  const snow = kind === 'snow';
  const count = fall.count;
  const seeds = new Float32Array(count * 4 * 4);
  const corners = new Float32Array(count * 4 * 2);
  const indices = new Uint32Array(count * 6);
  // Deterministic, so the same view looks the same on every visit.
  let state = snow ? 0x85ebca6b : 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const seed = [random(), random(), random(), (i + 0.5) / count];
    for (let k = 0; k < 4; k++) {
      seeds.set(seed, (i * 4 + k) * 4);
      corners.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
    }
    indices.set(
      [0, 1, 2, 2, 1, 3].map((k) => i * 4 + k),
      i * 6,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  geometry.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  // The vertex shader places every corner: no position attribute. The bounds only order the
  // transparent draws (renderOrder decides first).
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
  const uniforms = {
    suiRainTime: { value: 0 },
    suiRainAmount: { value: 0 },
    suiRainCenter: { value: new THREE.Vector2() },
    suiRainViewport: { value: 1 },
    suiRainColor: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    name: kind,
    uniforms,
    vertexShader: vertexShader(fall, snow),
    fragmentShader: fragmentShader(fall, snow),
    transparent: true,
    depthWrite: false,
    // A streak's winding follows its direction on screen.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = kind;
  mesh.frustumCulled = false;
  // After the other transparent surfaces (the water, the glass, the steam).
  mesh.renderOrder = 3;
  const viewport = new THREE.Vector4();
  mesh.onBeforeRender = (renderer) => {
    // The target's height in pixels, for the pixel-wide limit.
    uniforms.suiRainViewport.value = Math.max(1, renderer.getCurrentViewport(viewport).w);
  };
  return {
    mesh,
    update(amount: number, color: THREE.Color, camera: THREE.Camera, seconds: number) {
      mesh.visible = amount > 0;
      uniforms.suiRainAmount.value = amount;
      uniforms.suiRainColor.value.copy(color);
      uniforms.suiRainCenter.value.set(camera.position.x, camera.position.z);
      uniforms.suiRainTime.value = seconds;
    },
  };
}
