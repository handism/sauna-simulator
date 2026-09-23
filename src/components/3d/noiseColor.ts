import * as THREE from 'three';

// Base colors that Blender drives with world-space FBM noise through a linear ramp
// (ground moss, ferns). The exporter records the source node values in the glTF
// material extras; the ramp colors are linear, like the shader's diffuseColor.
export interface NoiseColor {
  space: 'blender_world';
  scale: number;
  detail: number;
  roughness: number;
  lacunarity: number;
  stops: RampStop[];
}

export const NOISE_COLOR_MAX_STOPS = 4;
const MAX_DETAIL = 15;

const COMMON_INCLUDE = '#include <common>';
const PROJECT_INCLUDE = '#include <project_vertex>';
const COLOR_INCLUDE = '#include <color_fragment>';

// Blender's linear Color Ramp; positions ascend and are padded by repeating the last stop.
export const RAMP_GLSL = `
vec3 sui_ramp( float fac, vec4 stops[ ${NOISE_COLOR_MAX_STOPS} ], int count ) {
	vec3 color = stops[ 0 ].yzw;
	for ( int i = 1; i < ${NOISE_COLOR_MAX_STOPS}; i ++ ) {
		if ( i >= count ) break;
		color = mix( color, stops[ i ].yzw, clamp( ( fac - stops[ i - 1 ].x ) / max( stops[ i ].x - stops[ i - 1 ].x, 1e-6 ), 0.0, 1.0 ) );
	}
	return color;
}
`;

// Port of Blender's shader-node Perlin noise (Jenkins lookup3 hash, quintic fade,
// 0.982 scale) and normalized FBM, so the pattern matches the Cycles renders.
// Octaves finer than a pixel fade to their zero mean instead of shimmering; Cycles
// averages them away across its samples.
export const NOISE_COLOR_GLSL = `
uint sui_rot( uint x, uint k ) { return ( x << k ) | ( x >> ( 32u - k ) ); }
uint sui_hash( ivec3 key ) {
	uint a = 0xdeadbeefu + 25u;
	uint b = a;
	uint c = a;
	c += uint( key.z ); b += uint( key.y ); a += uint( key.x );
	c ^= b; c -= sui_rot( b, 14u ); a ^= c; a -= sui_rot( c, 11u );
	b ^= a; b -= sui_rot( a, 25u ); c ^= b; c -= sui_rot( b, 16u );
	a ^= c; a -= sui_rot( c, 4u ); b ^= a; b -= sui_rot( a, 14u );
	c ^= b; c -= sui_rot( b, 24u );
	return c;
}
float sui_grad( ivec3 cell, vec3 p ) {
	uint h = sui_hash( cell ) & 15u;
	float u = h < 8u ? p.x : p.y;
	float v = h < 4u ? p.y : ( h == 12u || h == 14u ) ? p.x : p.z;
	return ( ( h & 1u ) != 0u ? - u : u ) + ( ( h & 2u ) != 0u ? - v : v );
}
float sui_perlin( vec3 p ) {
	vec3 cellFloor = floor( p );
	ivec3 c = ivec3( cellFloor );
	vec3 f = p - cellFloor;
	vec3 w = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
	float x00 = mix( sui_grad( c, f ), sui_grad( c + ivec3( 1, 0, 0 ), f - vec3( 1, 0, 0 ) ), w.x );
	float x10 = mix( sui_grad( c + ivec3( 0, 1, 0 ), f - vec3( 0, 1, 0 ) ), sui_grad( c + ivec3( 1, 1, 0 ), f - vec3( 1, 1, 0 ) ), w.x );
	float x01 = mix( sui_grad( c + ivec3( 0, 0, 1 ), f - vec3( 0, 0, 1 ) ), sui_grad( c + ivec3( 1, 0, 1 ), f - vec3( 1, 0, 1 ) ), w.x );
	float x11 = mix( sui_grad( c + ivec3( 0, 1, 1 ), f - vec3( 0, 1, 1 ) ), sui_grad( c + ivec3( 1, 1, 1 ), f - vec3( 1, 1, 1 ) ), w.x );
	return 0.982 * mix( mix( x00, x10, w.y ), mix( x01, x11, w.y ), w.z );
}
// One octave, faded to its zero mean as its cells shrink toward a pixel; skipped once invisible.
float sui_octave( vec3 p, float fscale, float footprint ) {
	float weight = 1.0 - smoothstep( 0.5, 1.0, footprint * fscale );
	return weight > 0.0 ? weight * sui_perlin( fscale * p ) : 0.0;
}
// footprint: size of one pixel in noise space; 0 evaluates every octave exactly.
float sui_fbm( vec3 p, float detail, float roughness, float lacunarity, float footprint ) {
	float fscale = 1.0, amp = 1.0, maxamp = 0.0, sum = 0.0;
	float octaves = floor( detail );
	for ( int i = 0; i <= ${MAX_DETAIL}; i ++ ) {
		if ( float( i ) > octaves ) break;
		sum += sui_octave( p, fscale, footprint ) * amp;
		maxamp += amp;
		amp *= roughness;
		fscale *= lacunarity;
	}
	float rmd = detail - octaves;
	if ( rmd != 0.0 ) {
		float sum2 = sum + sui_octave( p, fscale, footprint ) * amp;
		return mix( 0.5 * sum / maxamp + 0.5, 0.5 * sum2 / ( maxamp + amp ) + 0.5, rmd );
	}
	return 0.5 * sum / maxamp + 0.5;
}
${RAMP_GLSL}`;

const FRAGMENT_PARS = `
varying vec3 vSuiNoisePosition;
uniform float suiNoiseScale;
uniform float suiNoiseDetail;
uniform float suiNoiseRoughness;
uniform float suiNoiseLacunarity;
uniform vec4 suiNoiseStops[ ${NOISE_COLOR_MAX_STOPS} ];
uniform int suiNoiseStopCount;
${NOISE_COLOR_GLSL}`;

// glTF +Y up (x, y, z) is Blender (x, -z, y); the source noise is sampled in Blender space.
const FRAGMENT_COLOR = `
	vec3 suiNoisePoint = vec3( vSuiNoisePosition.x, - vSuiNoisePosition.z, vSuiNoisePosition.y ) * suiNoiseScale;
	float suiFootprint = max( length( dFdx( suiNoisePoint ) ), length( dFdy( suiNoisePoint ) ) );
	diffuseColor.rgb = sui_ramp( sui_fbm( suiNoisePoint, suiNoiseDetail, suiNoiseRoughness, suiNoiseLacunarity, suiFootprint ), suiNoiseStops, suiNoiseStopCount );`;

export type RampStop = [number, number, number, number];

export function validRampStops(stops: unknown): stops is RampStop[] {
  return Array.isArray(stops) && stops.length >= 1 && stops.length <= NOISE_COLOR_MAX_STOPS
    && stops.every((stop, i) => Array.isArray(stop) && stop.length === 4 && stop.every(Number.isFinite) && (i === 0 || stop[0] >= stops[i - 1][0]));
}

export const rampUniform = (stops: RampStop[]) =>
  Array.from({ length: NOISE_COLOR_MAX_STOPS }, (_, i) => new THREE.Vector4(...stops[Math.min(i, stops.length - 1)]));

export function noiseColorOf(material: THREE.Material): NoiseColor | null {
  if (!(material instanceof THREE.MeshStandardMaterial)) return null;
  const value = material.userData.suiNoiseColor as NoiseColor | undefined;
  if (!value || value.space !== 'blender_world') return null;
  const finite = [value.scale, value.detail, value.roughness, value.lacunarity].every(Number.isFinite);
  if (!finite || !validRampStops(value.stops) || value.detail < 0 || value.detail > MAX_DETAIL) throw Error(`Unsupported noise color on ${material.name}`);
  return value;
}

export function patchNoiseColorShader(shader: { vertexShader: string; fragmentShader: string }) {
  const { vertexShader, fragmentShader } = shader;
  if (!vertexShader.includes(COMMON_INCLUDE) || !vertexShader.includes(PROJECT_INCLUDE)
    || !fragmentShader.includes(COMMON_INCLUDE) || !fragmentShader.includes(COLOR_INCLUDE)) {
    throw Error('Unsupported three.js shader chunks for noise color');
  }
  shader.vertexShader = vertexShader
    .replace(COMMON_INCLUDE, `${COMMON_INCLUDE}\nvarying vec3 vSuiNoisePosition;`)
    .replace(PROJECT_INCLUDE, `${PROJECT_INCLUDE}\n\tvSuiNoisePosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
  shader.fragmentShader = fragmentShader
    .replace(COMMON_INCLUDE, `${COMMON_INCLUDE}${FRAGMENT_PARS}`)
    .replace(COLOR_INCLUDE, `${COLOR_INCLUDE}${FRAGMENT_COLOR}`);
}

// Composes with an earlier onBeforeCompile (fern foliage transmission).
export function applyNoiseColor(material: THREE.MeshStandardMaterial, noise: NoiseColor) {
  const stops = rampUniform(noise.stops);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      suiNoiseScale: { value: noise.scale }, suiNoiseDetail: { value: noise.detail },
      suiNoiseRoughness: { value: noise.roughness }, suiNoiseLacunarity: { value: noise.lacunarity },
      suiNoiseStops: { value: stops }, suiNoiseStopCount: { value: noise.stops.length },
    });
    patchNoiseColorShader(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|noise-color`;
  material.needsUpdate = true;
}
