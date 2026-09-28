import * as THREE from 'three';
import { BLENDER_HASH_GLSL } from './caustics';
import { FBM_GLSL } from './noiseColor';
import { MIRROR_LAYER } from './planarReflection';
import record from './sky.json' with { type: 'json' };

// The sky of the source worlds (scripts/build_sky_world.py), which camera and glossy rays see
// before any diffuse bounce: a zenith-horizon gradient, a glow, FBM clouds on a curved plane,
// Voronoi stars and the sun's disk (the moon's at night). Diffuse light from the sky is in the
// irradiance probes (the source's flat colour) and glossy light in the reflection probes, so this
// only draws the background, in the main pass and the water's mirror. The graph reads the view direction alone
// and is evaluated here node by node, in Blender axes (z up): Math Power and Divide are safe
// versions, Mix clamps its factor, Map Range clamps. The Blender graph is sharp; here the stars
// and the sun's disk keep their flux over a pixel and cloud octaves below a pixel fade to their
// mean (FBM_GLSL). The e2e test sky.e2e.ts compares the unfiltered graph with Cycles.

type Color = number[];
export interface SkyParameters {
  zenith: Color;
  horizon: Color;
  gradient_power: number;
  glow: { color: Color; power: number }[];
  glow_direction: Color;
  clouds: {
    scale: number;
    offset: Color;
    detail: number;
    roughness: number;
    lacunarity: number;
    low: number;
    high: number;
    opacity: number;
    bend: number;
    horizon_fade: number;
    shade: Color;
    lit: Color;
    lit_power: number;
  };
  stars: { scale: number; radius: number; density: number; color: Color; power: number };
  disk: boolean;
  disk_cos?: number;
  disk_radiance?: Color;
  sun_direction: Color;
}

export const SKY = record.scenes as Record<'day' | 'evening' | 'night', SkyParameters>;
/** Hash of the source blend the sky came from; the probes are baked from the same blend. */
export const SKY_BLEND_SHA256 = record.output_sha256;

const f = (value: number) => {
  if (!Number.isFinite(value)) throw Error('Sky parameter is not finite');
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
};
const v3 = (c: readonly number[]) => `vec3( ${c.map(f).join(', ')} )`;

/** GLSL of one scene's sky: `vec3 sui_sky_<name>( vec3 d )`, d a unit direction in Blender axes. */
export function skyFunction(name: string, p: SkyParameters) {
  const c = p.clouds;
  const s = p.stars;
  const glow = p.glow
    .map((lobe) => `\tsky += ${v3(lobe.color)} * sui_sky_pow( cosGlow, ${f(lobe.power)} );`)
    .join('\n');
  const stars = s.color.some((value) => value > 0)
    ? `\tsky += ${v3(s.color)} * sui_sky_star( d * ${f(s.scale)}, ${f(s.radius)}, ${f(s.density)}, ${f(s.power)} ) * fade;`
    : '';
  const disk =
    p.disk && p.disk_cos !== undefined && p.disk_radiance
      ? `\tsky += ${v3(p.disk_radiance)} * sui_sky_disk( d, ${v3(p.sun_direction)}, ${f(p.disk_cos)} ) * suiSkyDisk;`
      : '';
  return /* glsl */ `
vec3 sui_sky_${name}( vec3 d ) {
	float up = max( d.z, 0.0 );
	vec3 sky = mix( ${v3(p.horizon)}, ${v3(p.zenith)}, clamp( sui_sky_pow( up, ${f(p.gradient_power)} ), 0.0, 1.0 ) );
	float cosGlow = max( dot( d, ${v3(p.glow_direction)} ), 0.0 );
${glow}
	float fade = clamp( d.z / ${f(c.horizon_fade)}, 0.0, 1.0 );
${stars}
${disk}
	// The clouds cover the stars and the disk.
	float denominator = up + ${f(c.bend)};
	vec3 cloudPoint = ( vec3( d.x / denominator, d.y / denominator, 0.0 ) + ${v3(c.offset)} ) * ${f(c.scale)};
	float footprint = max( length( dFdx( cloudPoint ) ), length( dFdy( cloudPoint ) ) );
	float cover = smoothstep( ${f(c.low)}, ${f(c.high)}, sui_fbm( cloudPoint, ${f(c.detail)}, ${f(c.roughness)}, ${f(c.lacunarity)}, footprint ) );
	cover = clamp( cover * fade * ${f(c.opacity)}, 0.0, 1.0 );
	vec3 cloud = mix( ${v3(c.shade)}, ${v3(c.lit)}, clamp( sui_sky_pow( cosGlow, ${f(c.lit_power)} ), 0.0, 1.0 ) );
	return mix( sky, cloud, cover );
}`;
}

export const SKY_GLSL = /* glsl */ `${FBM_GLSL}${BLENDER_HASH_GLSL}
uniform float suiSkyDisk;
// Blender's safe power for a >= 0.
float sui_sky_pow( float a, float b ) { return a > 0.0 ? pow( a, b ) : 0.0; }
// Blender's 3D Voronoi F1 (Euclidean, randomness 1): distance to the nearest point, its cell color.
float sui_voronoi_f1( vec3 coord, out vec3 color ) {
	vec3 cellPosition = floor( coord );
	vec3 localPosition = coord - cellPosition;
	float minDistance = 3.4e38;
	vec3 targetOffset = vec3( 0.0 );
	for ( int k = - 1; k <= 1; k ++ ) for ( int j = - 1; j <= 1; j ++ ) for ( int i = - 1; i <= 1; i ++ ) {
		vec3 cellOffset = vec3( i, j, k );
		float distanceToPoint = distance( cellOffset + sui_hash3v( cellPosition + cellOffset ), localPosition );
		if ( distanceToPoint < minDistance ) {
			minDistance = distanceToPoint;
			targetOffset = cellOffset;
		}
	}
	color = sui_hash3v( cellPosition + targetOffset );
	return minDistance;
}
// A star is a Voronoi point closer than radius, kept in a density share of the cells. Below a
// pixel it spreads its flux over a disc of the pixel's area instead of vanishing between samples.
float sui_sky_star( vec3 coord, float radius, float density, float power ) {
	float pixel = max( length( dFdx( coord ) ), length( dFdy( coord ) ) );
	float spread = max( radius, 0.5642 * pixel );
	vec3 cell;
	float dist = sui_voronoi_f1( coord, cell );
	float bright = cell.y < density ? sui_sky_pow( cell.x, power ) : 0.0;
	return dist < spread ? bright * radius * radius / ( spread * spread ) : 0.0;
}
// The sun's disk (cos of the angle to its center above diskCos), covered by the pixel's share.
float sui_sky_disk( vec3 d, vec3 sun, float diskCos ) {
	float cosine = dot( d, sun );
	float pixel = max( length( dFdx( d ) ), length( dFdy( d ) ) );
	if ( pixel <= 0.0 ) return cosine > diskCos ? 1.0 : 0.0;
	float angle = acos( clamp( cosine, - 1.0, 1.0 ) );
	return clamp( ( acos( diskCos ) - angle ) / pixel + 0.5, 0.0, 1.0 );
}
${skyFunction('day', SKY.day)}
${skyFunction('evening', SKY.evening)}
${skyFunction('night', SKY.night)}
// Direction in glTF axes (y up) to Blender axes (z up). dusk is the weight of Blue hour and Night
// together, night that of Night (lighting.ts); only skies with a weight are evaluated.
vec3 sui_sky( vec3 direction, float dusk, float night ) {
	vec3 d = normalize( vec3( direction.x, - direction.z, direction.y ) );
	vec3 sky = vec3( 0.0 );
	if ( dusk < 1.0 ) sky += ( 1.0 - dusk ) * sui_sky_day( d );
	if ( dusk > night ) sky += ( dusk - night ) * sui_sky_evening( d );
	if ( night > 0.0 ) sky += night * sui_sky_night( d );
	return sky;
}
`;

const vertexShader = /* glsl */ `
varying vec3 vSuiSkyDirection;
void main() {
	vSuiSkyDirection = position;
	// Around the camera at any distance: only the rotation of the view, drawn at the far plane.
	gl_Position = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
	gl_Position.z = gl_Position.w;
}`;

const fragmentShader = /* glsl */ `
uniform float suiSkyEvening;
uniform float suiSkyNight;
varying vec3 vSuiSkyDirection;
${SKY_GLSL}
void main() {
	gl_FragColor = vec4( sui_sky( vSuiSkyDirection, suiSkyEvening, suiSkyNight ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;

/**
 * The background sphere. It is drawn after the other opaque objects where nothing covers the far
 * plane. The water's mirror (planarReflection.ts) sees it without the sun's disk, which the source
 * shows only on paths without a glossy bounce.
 */
export function createSky() {
  const uniforms = { suiSkyEvening: { value: 0 }, suiSkyNight: { value: 0 }, suiSkyDisk: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    name: 'sky',
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.name = 'sky';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1e6;
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    uniforms.suiSkyDisk.value = camera.layers.isEnabled(MIRROR_LAYER) ? 0 : 1;
  };
  return {
    mesh,
    /** Weights of Blue hour and Night together (0 is the Daylight sky) and of Night alone. */
    update(dusk: number, night: number) {
      uniforms.suiSkyEvening.value = dusk;
      uniforms.suiSkyNight.value = night;
    },
  };
}
