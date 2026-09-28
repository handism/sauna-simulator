import * as THREE from 'three';

// Percentage-closer soft shadows for the renderer's BasicShadowMap. Cycles blurs the sun shadow
// by its 4.9° disk and the V9 lounge light by its 1.25 m disk, so leaf shadows several meters
// from a wall fade into an even dimming while contact shadows stay sharp. A blocker search
// finds the mean occluder depth and the filter radius grows with the receiver-to-occluder gap.
//
// For an orthographic (directional) shadow and for a perspective one (1/view depth is linear in
// the stored depth), the penumbra width in shadow-map UV is k * (receiver depth - blocker depth),
// so the shader reads k from the light's shadow.radius uniform.
export const BLOCKER_SAMPLES = 16,
  FILTER_SAMPLES = 24;
// The blue-hour sun (0.045) adds little light, so its grain at 4+6 samples was invisible while
// the evening GPU time fell by 12–17% (docs/3d-qa/shadow-per-light). The lighting blend decides
// per frame from the sun's color × intensity, a uniform, so the branch is coherent and needs no
// recompile; the daylight sun (3.2) and every spot light keep 16+24.
export const SUN_LITE_SAMPLES = [4, 6] as const,
  SUN_LITE_BELOW = 0.1;
// Caps the search and filter radius (shadow-map UV) so a distant blocker cannot blur without bound.
const MAX_RADIUS = 0.02;

/** k for a directional light of angular diameter `angle` (radians). */
export function directionalPenumbra(camera: THREE.OrthographicCamera, angle: number): number {
  return (2 * Math.tan(angle / 2) * (camera.far - camera.near)) / (camera.right - camera.left);
}

/** k for a spot light's disk of `diameter` meters; `fov` is the shadow camera's vertical fov (degrees). */
export function spotPenumbra(near: number, far: number, fov: number, diameter: number): number {
  return (diameter * (far - near)) / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * far * near);
}

const pcssShadow = (name: string, blocker: number, filter: number) => /* glsl */ `
	// shadowRadius carries k: penumbra width in UV per unit of stored depth between receiver and blocker.
	float ${name}( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;

		// Receiver plane depth bias: the depth of the receiving surface at each sample offset, so a
		// wide kernel on a sloped floor or wall does not shadow itself. The derivatives come from
		// suiShadowSlope() outside the lights' branch.
		vec3 dx = suiShadowDx;
		vec3 dy = suiShadowDy;
		float det = dx.x * dy.y - dx.y * dy.x;
		vec2 slope = abs( det ) > 1e-12 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
		slope = clamp( slope, - 4.0, 4.0 );

		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		if ( ! inFrustum || shadowCoord.z > 1.0 ) return 1.0;

		float phi = pcssNoise( gl_FragCoord.xy ) * PI2;

		float texel = 1.0 / shadowMapSize.x;
		float search = clamp( shadowRadius * shadowCoord.z * 0.5, 2.0 * texel, ${MAX_RADIUS.toFixed(4)} );
		float blockerDepth = 0.0;
		float blockers = 0.0;

		for ( int i = 0; i < ${blocker}; i ++ ) {

			vec2 offset = pcssDisk( i, ${blocker}, phi ) * search;
			float depth = texture2D( shadowMap, shadowCoord.xy + offset ).r;
			if ( depth < shadowCoord.z + dot( slope, offset ) ) {

				blockerDepth += depth;
				blockers += 1.0;

			}

		}

		if ( blockers == 0.0 ) return 1.0;

		blockerDepth /= blockers;
		float radius = clamp( shadowRadius * ( shadowCoord.z - blockerDepth ) * 0.5, 1.5 * texel, ${MAX_RADIUS.toFixed(4)} );
		float lit = pcssFilter( shadowMap, shadowCoord.xyz, slope, radius, ${filter}, phi + 1.0 );
		return mix( 1.0, lit / ${filter}.0, shadowIntensity );

	}
`;

const pcss = /* glsl */ `
	vec3 suiShadowDx = vec3( 0.0 ), suiShadowDy = vec3( 0.0 );

	// Called for every pixel before the lights' shadow branch: derivatives inside the branch are
	// undefined where a 2x2 quad takes it only partly (the edge of a face turning from a light).
	void suiShadowSlope( vec4 shadowCoord ) {

		suiShadowDx = dFdx( shadowCoord.xyz / shadowCoord.w );
		suiShadowDy = dFdy( shadowCoord.xyz / shadowCoord.w );

	}

	float pcssNoise( vec2 position ) {

		return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );

	}

	vec2 pcssDisk( int index, int count, float phi ) {

		float r = sqrt( ( float( index ) + 0.5 ) / float( count ) );
		float theta = float( index ) * 2.399963229728653 + phi;
		return vec2( cos( theta ), sin( theta ) ) * r;

	}

	float pcssFilter( sampler2D shadowMap, vec3 coord, vec2 slope, float radius, int count, float phi ) {

		float lit = 0.0;

		for ( int i = 0; i < count; i ++ ) {

			vec2 offset = pcssDisk( i, count, phi ) * radius;
			lit += step( coord.z + dot( slope, offset ), texture2D( shadowMap, coord.xy + offset ).r );

		}

		return lit;

	}

${pcssShadow('getShadow', BLOCKER_SAMPLES, FILTER_SAMPLES)}
${pcssShadow('suiGetShadowSunLite', ...SUN_LITE_SAMPLES)}
	float suiSunShadow( vec3 sunColor, sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

		return max( sunColor.r, max( sunColor.g, sunColor.b ) ) < ${SUN_LITE_BELOW.toFixed(4)}
			? suiGetShadowSunLite( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord )
			: getShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );

	}
`;

// Swaps the BasicShadowMap branch of three's shared shadow chunk; three 0.186 is pinned, and a
// changed chunk fails loudly instead of silently keeping hard shadows.
// The built chunk has no comments, so the branch is found as the #else after the VSM one.
const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
const vsm = chunk.indexOf('#elif defined( SHADOWMAP_TYPE_VSM )');
const start = vsm < 0 ? -1 : chunk.indexOf('\n\t#else', vsm);
const end = start < 0 ? -1 : chunk.indexOf('\n\t#endif', start);
if (!chunk.includes('pcssDisk')) {
  if (end < 0 || !chunk.slice(start, end).includes('float getShadow( sampler2D shadowMap'))
    throw new Error('three shadowmap_pars_fragment changed; update softShadows.ts');
  THREE.ShaderChunk.shadowmap_pars_fragment = `${chunk.slice(0, start)}\n\t#else\n${pcss}${chunk.slice(end)}`;
}

// Every material here takes a light's direct term as saturate( dot( N, L ) ) times its color (no
// clearcoat, whose normal differs), so a pixel facing away from a light needs no shadow lookup; it
// was a third of the evening's PCSS cost. The derivatives are taken before that branch.
export const SHADOW_FACING = `
#if defined( STANDARD ) && ! defined( USE_CLEARCOAT )
#define SUI_SHADOW_FACING ( dot( geometryNormal, directLight.direction ) > 0.0 )
#else
#define SUI_SHADOW_FACING true
#endif
`;
const SHADOW_BRANCH = '( directLight.visible && receiveShadow ) ? getShadow( ';
const lights = THREE.ShaderChunk.lights_fragment_begin;
if (!lights.includes('SUI_SHADOW_FACING')) {
  // The sun (the only directional light) passes its color × intensity to choose its sample count;
  // the right-hand side reads directLight.color before the product is assigned.
  const calls = [
    ['spotShadowMap[ i ]', 'vSpotLightCoord[ i ]', 'getShadow( '],
    ['directionalShadowMap[ i ]', 'vDirectionalShadowCoord[ i ]', 'suiSunShadow( directLight.color, '],
  ].map(([map, coord, call]) => {
    const line = lights.split('\n').find((text) => text.includes(`${SHADOW_BRANCH}${map}`));
    if (!line?.trim().startsWith('directLight.color *=') || !line.includes(`, ${coord} ) : 1.0;`))
      throw new Error('three lighting chunks changed; update softShadows.ts');
    return [line, coord, call];
  });
  let patched = SHADOW_FACING + lights;
  for (const [line, coord, call] of calls) {
    const indent = line.slice(0, line.indexOf('directLight'));
    patched = patched.replace(
      line,
      `${indent}suiShadowSlope( ${coord} );\n${line.replace(
        SHADOW_BRANCH,
        `( directLight.visible && receiveShadow && SUI_SHADOW_FACING ) ? ${call}`,
      )}`,
    );
  }
  THREE.ShaderChunk.lights_fragment_begin = patched;
}

// three offsets the shadow lookup along the vertex normal (normalBias), but shades a double-sided
// back face with the flipped normal. The merged 'Mossy woodland terrain' is double-sided and its
// far slope faces down, so the lookup sank below the ground and the slope shadowed itself (the
// sunless hill of camera 07); Cycles shades both sides alike. Offset toward the viewer's side,
// per vertex, as the fragment shading flips per pixel.
export const FACING_NORMAL_BIAS =
  'if ( dot( shadowWorldNormal, cameraPosition - worldPosition.xyz ) < 0.0 ) shadowWorldNormal = - shadowWorldNormal;';
const WORLD_POSITION = 'vec4 shadowWorldPosition;';
const vertex = THREE.ShaderChunk.shadowmap_vertex;
if (!vertex.includes(FACING_NORMAL_BIAS)) {
  if (vertex.split(WORLD_POSITION).length !== 2 || !vertex.includes('vec3 shadowWorldNormal ='))
    throw new Error('three shadowmap_vertex changed; update softShadows.ts');
  THREE.ShaderChunk.shadowmap_vertex = vertex.replace(
    WORLD_POSITION,
    `${WORLD_POSITION}\n\t#ifdef DOUBLE_SIDED\n\t${FACING_NORMAL_BIAS}\n\t#endif`,
  );
}
