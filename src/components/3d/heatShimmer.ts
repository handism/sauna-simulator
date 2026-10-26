import * as THREE from 'three';

// The heat haze above the stove (not in the source scenes, a still image): the hot air rising off
// the stones bends the view behind it, and more so after a löyly, while the steam rises. Drawn in
// the full-screen pass (hdrOutput.ts) as a small offset of where the scene's image is read, inside
// the screen footprint of a column of air above the stones. Not refraction through a volume: the
// offset ignores depth, so whatever stands in front of the column wavers too (the room has
// nothing between the seat and the stove), and the mirror and the glass do not show it.

/** The column above the stove's steam origin (scene definition), in metres. */
export const SHIMMER_BASE = -0.28;
export const SHIMMER_TOP = 1.25;
/** Half the column's width at its base; it widens by half again toward the top. */
export const SHIMMER_RADIUS = 0.3;
/**
 * Largest offset (pixels at an 800-pixel-high view) over the hot stones, and the löyly's addition
 * as the steam flashes off, fading over SHIMMER_LOYLY_SECONDS.
 */
export const SHIMMER_IDLE = 0.9;
export const SHIMMER_LOYLY = 2.4;
export const SHIMMER_LOYLY_SECONDS = 6;

export const SHIMMER_GLSL = /* glsl */ `
uniform vec2 suiShimmerBase;
uniform vec2 suiShimmerTop;
uniform float suiShimmerRadius;
uniform float suiShimmerStrength;
uniform float suiShimmerTime;
uniform vec2 suiShimmerSize;
float suiShimmerHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float suiShimmerNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( suiShimmerHash( i ), suiShimmerHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( suiShimmerHash( i + vec2( 0.0, 1.0 ) ), suiShimmerHash( i + vec2( 1.0, 1.0 ) ), u.x ),
		u.y
	);
}
// The image's coordinate to read at uv: rising cells of warm air, a few centimetres across,
// sliding sideways and up, strongest just above the stones.
vec2 suiShimmer( vec2 uv ) {
	if ( suiShimmerStrength <= 0.0 ) return uv;
	vec2 pixel = uv * suiShimmerSize;
	vec2 base = suiShimmerBase * suiShimmerSize;
	vec2 axis = suiShimmerTop * suiShimmerSize - base;
	float length2 = max( dot( axis, axis ), 1.0 );
	float along = dot( pixel - base, axis ) / length2;
	vec2 normal = vec2( - axis.y, axis.x ) * inversesqrt( length2 );
	float across = dot( pixel - base, normal ) / ( suiShimmerRadius * ( 1.0 + 0.5 * clamp( along, 0.0, 1.0 ) ) );
	float mask = smoothstep( - 0.08, 0.08, along ) * ( 1.0 - smoothstep( 0.35, 1.0, along ) ) * ( 1.0 - smoothstep( 0.45, 1.0, abs( across ) ) );
	if ( mask <= 0.0 ) return uv;
	vec2 cell = vec2( across * 2.2, along * 7.0 - suiShimmerTime * 2.4 );
	vec2 wobble = vec2(
		suiShimmerNoise( cell ) + 0.5 * suiShimmerNoise( cell * 2.1 + vec2( 3.1, - suiShimmerTime * 1.7 ) ),
		suiShimmerNoise( cell + vec2( 7.3, 2.9 ) ) + 0.5 * suiShimmerNoise( cell * 2.1 + vec2( 1.7, 5.2 ) )
	) / 1.5 - 0.5;
	return uv + wobble * 2.0 * suiShimmerStrength * mask / suiShimmerSize;
}
`;

export function createShimmerUniforms() {
  return {
    /** The column's base and top on the image (0–1). */
    suiShimmerBase: { value: new THREE.Vector2() },
    suiShimmerTop: { value: new THREE.Vector2() },
    /** Half the column's width at its base (pixels). */
    suiShimmerRadius: { value: 1 },
    /** Largest offset (pixels); 0 draws no shimmer. */
    suiShimmerStrength: { value: 0 },
    suiShimmerTime: { value: 0 },
    /** The image's size (pixels). */
    suiShimmerSize: { value: new THREE.Vector2(1, 1) },
  };
}
export type ShimmerUniforms = ReturnType<typeof createShimmerUniforms>;

const point = new THREE.Vector3();
const right = new THREE.Vector3();

/** Projects `world` onto the image (0–1) into `out`; false behind the camera. */
function project(world: THREE.Vector3, camera: THREE.Camera, out: THREE.Vector2) {
  point.copy(world).applyMatrix4(camera.matrixWorldInverse);
  if (point.z > -0.05) return false;
  point.applyMatrix4(camera.projectionMatrix);
  out.set(point.x * 0.5 + 0.5, point.y * 0.5 + 0.5);
  return true;
}

/**
 * Sets the shimmer for this frame: the column above `stove` seen by `camera` on an image of
 * `size` pixels. `loylyAge` is the seconds since the last löyly (Infinity before one). Reduced
 * motion and a camera that does not see the column turn it off.
 */
export function updateShimmer(
  uniforms: ShimmerUniforms,
  camera: THREE.Camera,
  stove: THREE.Vector3,
  size: THREE.Vector2,
  seconds: number,
  loylyAge: number,
  reducedMotion: boolean,
) {
  uniforms.suiShimmerStrength.value = 0;
  if (reducedMotion) return 0;
  const base = point.copy(stove);
  base.y += SHIMMER_BASE;
  const baseWorld = base.clone();
  if (!project(baseWorld, camera, uniforms.suiShimmerBase.value)) return 0;
  const topWorld = baseWorld.clone();
  topWorld.y += SHIMMER_TOP - SHIMMER_BASE;
  if (!project(topWorld, camera, uniforms.suiShimmerTop.value)) return 0;
  // The base's half width on the image, along the camera's right.
  right.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(SHIMMER_RADIUS).add(baseWorld);
  const side = new THREE.Vector2();
  if (!project(right, camera, side)) return 0;
  uniforms.suiShimmerSize.value.copy(size);
  uniforms.suiShimmerRadius.value = side.sub(uniforms.suiShimmerBase.value).multiply(size).length();
  const loyly =
    loylyAge >= 0 && loylyAge < SHIMMER_LOYLY_SECONDS
      ? Math.sin((Math.min(1, loylyAge / 0.6) * Math.PI) / 2) * (1 - loylyAge / SHIMMER_LOYLY_SECONDS)
      : 0;
  const strength = ((SHIMMER_IDLE + SHIMMER_LOYLY * loyly) * size.y) / 800;
  uniforms.suiShimmerStrength.value = strength;
  uniforms.suiShimmerTime.value = seconds % 1000;
  return strength;
}
