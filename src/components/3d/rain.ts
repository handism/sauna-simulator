import * as THREE from 'three';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';

// Falling rain around the camera: thin camera-facing streaks (the motion blur of a drop over a
// short exposure) in a box that follows the camera and wraps, so the drops stay put in the world
// while the view turns. Not in the source scenes; an approximation drawn over the lighting of the
// time of day (lighting.ts). The drops keep out of the sauna room (its roof) and stop at the
// plunge's surface, where waterEffects.ts draws their rings.

/** Drops in the box at full rain; a share of them falls at a partial amount (the fade in and out). */
export const RAIN_DROPS = 14000;
/** Horizontal size of the box around the camera and its height range (m). */
export const RAIN_SPAN = 18;
const RAIN_BOTTOM = -0.5;
const RAIN_HEIGHT = 8;
/** Fall speed (m/s) and a light wind's drift (m/s along x and z). */
export const RAIN_SPEED = 7.5;
const RAIN_WIND = [0.9, 0.35] as const;
/** Exposure the streak spans (s) and the drop's width (m); thinner than a pixel, it spreads its light. */
const STREAK_SECONDS = 0.045;
const DROP_WIDTH = 0.003;
/** Peak opacity of a streak at the drop's width. */
const OPACITY = 0.6;
/** Margin of the sauna room's roof beyond its walls (m). */
const EAVES = 0.3;

const f = (value: number) => value.toFixed(6);

/** Where a drop is at `time`: seed (x, z, phase) in [0, 1), the camera's xz. Mirrors the vertex shader. */
export function dropPosition(seed: readonly number[], center: readonly [number, number], time: number) {
  const wrap = (s: number, c: number) => c + (((((s - c / RAIN_SPAN) % 1) + 1) % 1) - 0.5) * RAIN_SPAN;
  const fall = (((seed[2] - (time * RAIN_SPEED) / RAIN_HEIGHT) % 1) + 1) % 1;
  // Higher drops are further upwind: the streaks slant with the wind.
  const drift = (fall * RAIN_HEIGHT) / RAIN_SPEED;
  return [
    wrap(seed[0], center[0]) - RAIN_WIND[0] * drift,
    RAIN_BOTTOM + fall * RAIN_HEIGHT,
    wrap(seed[1], center[1]) - RAIN_WIND[1] * drift,
  ];
}

/** Whether rain reaches world (x, z): not under the sauna room's roof. */
export function rainReaches(x: number, z: number) {
  return !(
    x > INTERIOR_BOX.min.x - EAVES &&
    x < INTERIOR_BOX.max.x + EAVES &&
    z > INTERIOR_BOX.min.z - EAVES &&
    z < INTERIOR_BOX.max.z + EAVES
  );
}

const vertexShader = /* glsl */ `
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
	float fall = fract( seed.z - suiRainTime * ${f(RAIN_SPEED / RAIN_HEIGHT)} );
	vec3 wind = vec3( ${f(RAIN_WIND[0])}, 0.0, ${f(RAIN_WIND[1])} );
	vec3 head = vec3( xz.x, ${f(RAIN_BOTTOM)} + fall * ${f(RAIN_HEIGHT)}, xz.y ) - wind * ( fall * ${f(RAIN_HEIGHT / RAIN_SPEED)} );
	if ( head.x > ${f(INTERIOR_BOX.min.x - EAVES)} && head.x < ${f(INTERIOR_BOX.max.x + EAVES)} && head.z > ${f(INTERIOR_BOX.min.z - EAVES)} && head.z < ${f(INTERIOR_BOX.max.z + EAVES)} ) return;
	vec3 velocity = wind - vec3( 0.0, ${f(RAIN_SPEED)}, 0.0 );
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
	float width = max( ${f(DROP_WIDTH)}, pixel );
	vSuiRainAlpha = ${f(OPACITY)} * ${f(DROP_WIDTH)} / width
		* smoothstep( 0.4, 1.2, distance )
		* ( 1.0 - smoothstep( ${f(RAIN_SPAN * 0.32)}, ${f(RAIN_SPAN * 0.5)}, length( head.xz - suiRainCenter ) ) );
	vSuiRainWorld = mix( head, tail, corner.y );
	gl_Position = projectionMatrix * vec4( point + side * corner.x * 0.5 * width, 1.0 );
}`;

const fragmentShader = /* glsl */ `
uniform vec3 suiRainColor;
varying float vSuiRainAlpha;
varying vec2 vSuiRainCorner;
varying vec3 vSuiRainWorld;
void main() {
	// Into the plunge the drop ends at the surface (no streaks under the water).
	if ( vSuiRainWorld.y < ${f(WATER_BOX.max.y)} && all( greaterThan( vSuiRainWorld.xz, vec2( ${f(WATER_BOX.min.x)}, ${f(WATER_BOX.min.z)} ) ) ) && all( lessThan( vSuiRainWorld.xz, vec2( ${f(WATER_BOX.max.x)}, ${f(WATER_BOX.max.z)} ) ) ) ) discard;
	float across = 1.0 - abs( vSuiRainCorner.x );
	float along = smoothstep( 0.0, 0.25, vSuiRainCorner.y ) * ( 1.0 - smoothstep( 0.6, 1.0, vSuiRainCorner.y ) );
	gl_FragColor = vec4( suiRainColor, vSuiRainAlpha * across * along );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

/**
 * The rain's streaks. `update` takes the rain's share (0 hides them), the scene-linear radiance
 * the drops carry (the overcast's) and the time (still with reduced motion). It is visible until
 * the first `update`, so the scene's compile includes its program.
 */
export function createRain() {
  const seeds = new Float32Array(RAIN_DROPS * 4 * 4);
  const corners = new Float32Array(RAIN_DROPS * 4 * 2);
  const indices = new Uint32Array(RAIN_DROPS * 6);
  // Deterministic, so the same view looks the same on every visit.
  let state = 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  for (let i = 0; i < RAIN_DROPS; i++) {
    const seed = [random(), random(), random(), (i + 0.5) / RAIN_DROPS];
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
    name: 'rain',
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // The quad's winding follows the streak's direction on screen.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'rain';
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
