import * as THREE from 'three';

// The air between the viewer and the garden. The distant ridges and the far forest were hazed with
// their own fixed shares, while every lit surface kept its full contrast however far it stood: the
// woodland's crowns, 10–44 m out, read as dark speckle against the sky, darker than the forest
// behind them. One share by the distance from the camera now hazes the lit surfaces and the far
// forest alike, toward the same air color as the ridges (gardenDetails.ts). Not a volume: no
// in-scattering by the sun's direction, no extinction of the light toward the surface.

/**
 * Within this distance (m) nothing is hazed: the sauna room, the plunge, the deck and the meadow
 * around it. From 8 m the meadow's hill turned into a pale band at blue hour and at night, and the
 * woodland's green went grey.
 */
export const AIR_START = 20;
/** Distance (m) over which the clear part falls to 1/e: the woodland's far edge (44 m) about 0.09, the far forest (54 m) 0.13. */
export const AIR_DEPTH = 250;

/** The share of the air color at a distance (m) from the camera (mirrors AIR_GLSL). */
export function airAmount(distance: number) {
  return 1 - Math.exp(-Math.max(0, distance - AIR_START) / AIR_DEPTH);
}

export const AIR_GLSL = /* glsl */ `
#ifndef SUI_AIR
#define SUI_AIR
float suiAirAmount( const in float distance ) {
	return 1.0 - exp( -max( 0.0, distance - ${AIR_START.toFixed(1)} ) / ${AIR_DEPTH.toFixed(1)} );
}
#endif
`;

export function createAirUniforms() {
  /** The air's radiance (scene-linear, before exposure); gardenDetails.ts sets it by time and weather. */
  return { suiAirColor: { value: new THREE.Color() } };
}

// After the lighting and before tone mapping (which the HDR path leaves to its own pass), so the
// mix is of linear radiance on either path. Standard materials with the probes only: glass and the
// other shader materials that share the probe uniforms do not define STANDARD.
const AIR_MIX = /* glsl */ `#if defined( SUI_IRRADIANCE ) && defined( STANDARD )
	float suiAir = suiAirAmount( length( vViewPosition ) );
	// SUI_AIR_CONTROL
	gl_FragColor.rgb = mix( gl_FragColor.rgb, suiAirColor, suiAir );
#endif
`;

// three 0.186 is pinned: the standard fragment shader includes lights_pars_begin and then
// tonemapping_fragment after opaque_fragment.
if (!THREE.ShaderChunk.tonemapping_fragment.includes('SUI_AIR_CONTROL')) {
  if (!THREE.ShaderChunk.meshphysical_frag.includes('#include <opaque_fragment>\n\t#include <tonemapping_fragment>'))
    throw new Error('three standard fragment changed; update aerialPerspective.ts');
  THREE.ShaderChunk.lights_pars_begin += `\n#ifdef SUI_IRRADIANCE\nuniform vec3 suiAirColor;\n${AIR_GLSL}#endif\n`;
  THREE.ShaderChunk.tonemapping_fragment = AIR_MIX + THREE.ShaderChunk.tonemapping_fragment;
}
