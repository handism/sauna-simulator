import * as THREE from 'three';
import './softShadows';
import { cutoutOf, PREPASS_LAYER, takesPrepassDepth } from './depthPrepass';
import { mayDiscardGlsl } from './refraction';

// The dusk and night frames spend about 75–85% of their GPU time in the PCSS shadows, in
// proportion to the pixels times the lookups (docs/3d-qa/light-shadow-cost). This evaluates the
// shadows of the opaque surfaces once per pixel of a half-resolution pass, a quarter of the
// lookups, and the lit pass reads them back.
//
// The pass draws copies of the opaque meshes on SHADOW_MASK_LAYER (children sharing the
// geometry, as depthPrepass.ts does) over the half-resolution depth-only copies. Each writes the
// factors of the shadow casting lights, 8 bits each, three to a channel of a 32-bit float target
// (exact below 2^24), its vertex normal and its view depth in alpha. The lit pass takes the four
// texels around a pixel, keeps those whose depth and normal are its own surface's, and
// interpolates them; where none is (silhouettes, grooves, parts thinner than the half resolution)
// it looks the shadow maps up once each. The lit pass keeps no PCSS of its own: the code alone,
// never run, cost as much as running it. The water's mirror draws a mask of its own. Materials
// under the water (SUI_REFRACTION) draw their copies at the same refracted image, keeping the true
// position for the shadows (and the pool floor's lookups at its paths' exits, waterBottom.ts), and
// write nothing where the lit pass may discard them. The woodland cards' copies write where the lit
// pass keeps their leaves (alpha at least the alpha test). Left out, evaluating the shadows as
// before: transparent and non-default layer surfaces, including the images in the sides.

export const SHADOW_MASK_LAYER = 5;
// Directional then spot shadows, three to a channel of red, green and blue; the last two slots
// hold the octahedral vertex normal, which tells a groove's side from the board beside it at
// almost the same depth.
export const MASK_SLOTS = 9,
  SHADOW_SLOTS = 7;
// Texels whose normal differs more are another surface.
const NORMAL_MIN = 0.9;
const OCTAHEDRAL = /* glsl */ `
vec2 suiOctahedral( vec3 n ) {
	n /= abs( n.x ) + abs( n.y ) + abs( n.z );
	return n.z >= 0.0 ? n.xy : ( 1.0 - abs( n.yx ) ) * vec2( n.x >= 0.0 ? 1.0 : - 1.0, n.y >= 0.0 ? 1.0 : - 1.0 );
}
vec3 suiFromOctahedral( vec2 e ) {
	vec3 n = vec3( e, 1.0 - abs( e.x ) - abs( e.y ) );
	if ( n.z < 0.0 ) n.xy = ( 1.0 - abs( n.yx ) ) * vec2( n.x >= 0.0 ? 1.0 : - 1.0, n.y >= 0.0 ? 1.0 : - 1.0 );
	return normalize( n );
}
#if NUM_DIR_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS > ${SHADOW_SLOTS}
#error shadowMask.ts packs ${SHADOW_SLOTS} shadow casting lights at most
#endif
`;
// The lit pass skips a light's shadow where the shading normal faces away from it (softShadows.ts
// SUI_SHADOW_FACING); the pass has only the vertex normal, which normal and bump maps may tilt.
const FACING_MIN = -0.25;

const vertexShader = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
varying vec3 vViewPosition;
varying vec3 vSuiNormal;
#ifdef SUI_CUTOUT
uniform mat3 suiAlphaMapTransform;
varying vec2 vSuiAlphaMapUv;
#endif
void main() {
	#ifdef SUI_CUTOUT
	vSuiAlphaMapUv = ( suiAlphaMapTransform * vec3( uv, 1.0 ) ).xy;
	#endif
	#include <beginnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	vViewPosition = - mvPosition.xyz;
	vSuiNormal = transformedNormal;
}`;

const fragmentShader = (discard: string) => /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
${OCTAHEDRAL}
varying vec3 vViewPosition;
varying vec3 vSuiNormal;
#ifdef SUI_CUTOUT
uniform sampler2D suiAlphaMap;
uniform float suiAlphaTest;
uniform float suiOpacity;
varying vec2 vSuiAlphaMapUv;
#endif
void main() {
	vec3 geometryPosition = - vViewPosition;
	${discard}
	vec3 normal = normalize( vSuiNormal );
	#ifdef DOUBLE_SIDED
	normal *= gl_FrontFacing ? 1.0 : - 1.0;
	#endif
	float suiShadow[ ${MASK_SLOTS} ];
	for ( int i = 0; i < ${MASK_SLOTS}; i ++ ) suiShadow[ i ] = 1.0;
	IncidentLight directLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		getDirectionalLightInfo( directionalLights[ i ], directLight );
		directionalLightShadow = directionalLightShadows[ i ];
		suiShadowSlope( vDirectionalShadowCoord[ i ] );
		suiShadow[ UNROLLED_LOOP_INDEX ] = ( directLight.visible && dot( normal, directLight.direction ) > ${FACING_MIN.toFixed(2)} ) ? suiSunShadow( directLight.color, directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		getSpotLightInfo( spotLights[ i ], geometryPosition, directLight );
		spotLightShadow = spotLightShadows[ i ];
		suiShadowSlope( vSpotLightCoord[ i ] );
		suiShadow[ NUM_DIR_LIGHT_SHADOWS + UNROLLED_LOOP_INDEX ] = ( directLight.visible && dot( normal, directLight.direction ) > ${FACING_MIN.toFixed(2)} ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	vec2 octahedral = suiOctahedral( normal ) * 0.5 + 0.5;
	suiShadow[ ${SHADOW_SLOTS} ] = octahedral.x;
	suiShadow[ ${SHADOW_SLOTS + 1} ] = octahedral.y;
	vec3 packed = vec3( 0.0 );
	for ( int i = 0; i < ${MASK_SLOTS}; i ++ ) {
		float level = floor( saturate( suiShadow[ i ] ) * 255.0 + 0.5 );
		float scale = i % 3 == 0 ? 1.0 : i % 3 == 1 ? 256.0 : 65536.0;
		if ( i < 3 ) packed.r += level * scale;
		else if ( i < 6 ) packed.g += level * scale;
		else packed.b += level * scale;
	}
	gl_FragColor = vec4( packed, vViewPosition.z );
}`;

// The lit pass (lights_pars_begin, for materials with SUI_SHADOW_MASK or SUI_HARD_SHADOW).
export const MASK_PARS = /* glsl */ `
#if ( defined( SUI_SHADOW_MASK ) || defined( SUI_HARD_SHADOW ) ) && defined( USE_SHADOWMAP )
// One lookup of the shadow map at the pixel, in place of the PCSS. With the mask, where no texel is
// on this surface (silhouettes, grooves and parts thinner than the half resolution): taking a
// neighbouring surface's factor lit the shadowed grooves between ceiling boards. With
// SUI_HARD_SHADOW, everywhere: the underwater copies drawing no mask (refraction.ts), where the
// sun and spot lights light nothing (lighting.ts DRY_ONLY) but the pool floor's highlights.
// Same arguments as getShadow.
float suiHardShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
	shadowCoord.xyz /= shadowCoord.w;
	shadowCoord.z += shadowBias;
	if ( any( lessThan( shadowCoord.xy, vec2( 0.0 ) ) ) || any( greaterThan( shadowCoord.xyz, vec3( 1.0 ) ) ) ) return 1.0;
	return mix( 1.0, step( shadowCoord.z, texture2D( shadowMap, shadowCoord.xy ).r ), shadowIntensity );
}
float suiSunHardShadow( vec3 sunColor, sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
	return suiHardShadow( shadowMap, shadowMapSize, shadowIntensity, shadowBias, shadowRadius, shadowCoord );
}
#endif
#if defined( SUI_SHADOW_MASK ) && defined( USE_SHADOWMAP )
uniform sampler2D suiShadowMask;
uniform vec2 suiShadowMaskScale;
uniform bool suiShadowMaskOn;
vec3 suiMaskLow, suiMaskMiddle, suiMaskHigh;
${OCTAHEDRAL}
// Whether a texel around this pixel lies on its surface.
bool suiMaskHit;
// The shadow factors of the half-resolution pass around this pixel: the texels on this surface
// (depth within the tolerance, normal within NORMAL_MIN), interpolated.
void suiLoadShadowMask( float depth, float slope, vec3 normal ) {
	suiMaskLow = suiMaskMiddle = suiMaskHigh = vec3( 0.0 );
	suiMaskHit = false;
	if ( ! suiShadowMaskOn ) return;
	vec2 at = gl_FragCoord.xy * suiShadowMaskScale - 0.5;
	ivec2 base = ivec2( floor( at ) );
	vec2 f = at - floor( at );
	ivec2 last = textureSize( suiShadowMask, 0 ) - 1;
	// A tap is at most a texel (1 / scale pixels) away along each axis.
	float tolerance = 0.002 * depth + 1.25 * slope / suiShadowMaskScale.x;
	float total = 0.0;
	for ( int tap = 0; tap < 4; tap ++ ) {
		ivec2 offset = ivec2( tap % 2, tap / 2 );
		vec4 texel = texelFetch( suiShadowMask, clamp( base + offset, ivec2( 0 ), last ), 0 );
		float weight = ( offset.x == 1 ? f.x : 1.0 - f.x ) * ( offset.y == 1 ? f.y : 1.0 - f.y );
		if ( abs( texel.a - depth ) > tolerance || weight == 0.0 ) continue;
		// Exact integers; + 0.5 would round 2^24 − 1 (every light unshadowed) up to 2^24.
		vec3 v = round( texel.rgb );
		vec3 high = floor( v / 65536.0 );
		vec3 middle = floor( ( v - high * 65536.0 ) / 256.0 );
		vec3 low = v - high * 65536.0 - middle * 256.0;
		if ( dot( suiFromOctahedral( vec2( middle.b, high.b ) / 127.5 - 1.0 ), normal ) < ${NORMAL_MIN.toFixed(2)} ) continue;
		total += weight;
		suiMaskLow += weight * low;
		suiMaskMiddle += weight * middle;
		suiMaskHigh += weight * high;
	}
	suiMaskHit = total >= 1e-3;
	float scale = suiMaskHit ? 1.0 / ( total * 255.0 ) : 0.0;
	suiMaskLow *= scale;
	suiMaskMiddle *= scale;
	suiMaskHigh *= scale;
}
float suiMaskFactor( int slot ) {
	int c = slot / 3, k = slot - c * 3;
	vec3 v = k == 0 ? suiMaskLow : k == 1 ? suiMaskMiddle : suiMaskHigh;
	return c == 0 ? v.x : c == 1 ? v.y : v.z;
}
#endif
`;
// The lit pass, before the lights (lights_fragment_begin): the derivative is taken outside any
// branch. The PCSS calls of the lights' loops become the single lookups, and the PCSS functions,
// never called, are dropped: merely present behind a branch never taken, their unrolled lookups
// made the lit pass as slow as evaluating them (docs/3d-qa/shadow-mask). SUI_HARD_SHADOW takes the
// single lookups without a mask.
export const MASK_LOAD = /* glsl */ `
#if defined( SUI_SHADOW_MASK ) && defined( USE_SHADOWMAP )
vec3 suiMaskNormal = normalize( vNormal );
#ifdef DOUBLE_SIDED
suiMaskNormal *= gl_FrontFacing ? 1.0 : - 1.0;
#endif
suiLoadShadowMask( vViewPosition.z, fwidth( vViewPosition.z ), suiMaskNormal );
#define SUI_MASKED( slot ) suiMaskHit ? suiMaskFactor( slot ) :
#define getShadow suiHardShadow
#define suiSunShadow suiSunHardShadow
#else
#define SUI_MASKED( slot )
#if defined( SUI_HARD_SHADOW ) && defined( USE_SHADOWMAP )
#define getShadow suiHardShadow
#define suiSunShadow suiSunHardShadow
#endif
#endif
`;
export const MASK_END = /* glsl */ `
#if ( defined( SUI_SHADOW_MASK ) || defined( SUI_HARD_SHADOW ) ) && defined( USE_SHADOWMAP )
#undef getShadow
#undef suiSunShadow
#endif
`;

const SHADOW_CALLS = [
  [
    '? getShadow( spotShadowMap[ i ]',
    '? SUI_MASKED( NUM_DIR_LIGHT_SHADOWS + UNROLLED_LOOP_INDEX ) getShadow( spotShadowMap[ i ]',
  ],
  [
    '? suiSunShadow( directLight.color, directionalShadowMap[ i ]',
    '? SUI_MASKED( UNROLLED_LOOP_INDEX ) suiSunShadow( directLight.color, directionalShadowMap[ i ]',
  ],
];
// three 0.186 is pinned and softShadows.ts has placed its calls; a changed chunk fails loudly.
if (!THREE.ShaderChunk.lights_fragment_begin.includes('SUI_MASKED')) {
  let begin = THREE.ShaderChunk.lights_fragment_begin;
  for (const [call, masked] of SHADOW_CALLS) {
    if (begin.split(call).length !== 2) throw new Error('three lighting chunks changed; update shadowMask.ts');
    begin = begin.replace(call, masked);
  }
  THREE.ShaderChunk.lights_fragment_begin = MASK_LOAD + begin + MASK_END;
  THREE.ShaderChunk.lights_pars_begin += MASK_PARS;
}

/** The mask material of a lit material with `side`, refracted under the water at `level` (the define's string). */
function maskMaterial(side: THREE.Side, level?: string, waterBottom = false, cutout?: THREE.MeshStandardMaterial) {
  // Cut-out materials are not refracted (cutoutOf).
  // The true world position, which the vertex stage keeps in vViewPosition.
  const discard = cutout
    ? // Where the lit pass keeps the leaves (alphatest_fragment, with or without alpha to coverage).
      'if ( suiOpacity * texture2D( suiAlphaMap, vSuiAlphaMapUv ).g < suiAlphaTest ) discard;'
    : level === undefined
      ? ''
      : `vec3 suiTrue = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	if ( ${mayDiscardGlsl(level, 'suiTrue')} ) discard;`;
  const uniforms: Record<string, THREE.IUniform> = THREE.UniformsUtils.clone(THREE.UniformsLib.lights);
  if (cutout) {
    // The texture's own matrix, which three updates for the lit pass.
    uniforms.suiAlphaMap = { value: cutout.alphaMap };
    uniforms.suiAlphaMapTransform = { value: cutout.alphaMap!.matrix };
    uniforms.suiAlphaTest = { value: cutout.alphaTest };
    uniforms.suiOpacity = { value: cutout.opacity };
  }
  return new THREE.ShaderMaterial({
    name: 'shadow mask',
    uniforms,
    vertexShader,
    fragmentShader: fragmentShader(discard),
    // project_vertex refracts; the floor's spot shadow coordinates move to the paths' exits.
    defines: {
      ...(level === undefined ? {} : { SUI_REFRACTION: level, ...(waterBottom ? { SUI_WATER_BOTTOM: '' } : {}) }),
      ...(cutout ? { SUI_CUTOUT: '' } : {}),
    },
    lights: true,
    side,
  });
}

/** Whether the lit pass's `material` can read its shadows from the mask. */
export function takesShadowMask(material: THREE.Material) {
  return takesPrepassDepth(material) && material instanceof THREE.MeshStandardMaterial && !material.flatShading;
}

export type MaskPass = 'main' | 'mirror';

export function createShadowMask(renderer: THREE.WebGLRenderer) {
  // One target per pass, so the mirror's smaller one is not reallocated every frame.
  const targets = new Map<MaskPass, THREE.WebGLRenderTarget>();
  const targetFor = (pass: MaskPass) => {
    if (!targets.has(pass))
      targets.set(
        pass,
        new THREE.WebGLRenderTarget(1, 1, {
          type: THREE.FloatType,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          generateMipmaps: false,
        }),
      );
    return targets.get(pass)!;
  };
  const uniforms = {
    suiShadowMask: { value: null as THREE.Texture | null },
    suiShadowMaskScale: { value: new THREE.Vector2(0.5, 0.5) },
    suiShadowMaskOn: { value: false },
  };
  const materials = new Map<string, THREE.ShaderMaterial>();
  const cutouts = new Map<THREE.Material, THREE.ShaderMaterial>();
  const materialFor = (material: THREE.Material) => {
    if (cutoutOf(material)) {
      if (!cutouts.has(material))
        cutouts.set(material, maskMaterial(material.side, undefined, false, material as THREE.MeshStandardMaterial));
      return cutouts.get(material)!;
    }
    const defines = (material as { defines?: Record<string, unknown> }).defines;
    const level = defines?.SUI_REFRACTION === undefined ? undefined : String(defines.SUI_REFRACTION);
    const waterBottom = level !== undefined && defines?.SUI_WATER_BOTTOM !== undefined;
    const key = `${material.side}|${level ?? ''}|${waterBottom}`;
    if (!materials.has(key)) materials.set(key, maskMaterial(material.side, level, waterBottom));
    return materials.get(key)!;
  };
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const marked = new WeakSet<THREE.Material>();
  const mark = (material: THREE.MeshStandardMaterial) => {
    if (marked.has(material)) return;
    marked.add(material);
    material.defines = { ...material.defines, SUI_SHADOW_MASK: '' };
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, r) => {
      previous.call(material, shader, r);
      Object.assign(shader.uniforms, uniforms);
    };
    material.needsUpdate = true;
  };
  const clear = new THREE.Color();
  const defaultLayer = new THREE.Layers();
  return {
    uniforms,
    /** Adds shadow mask copies of `root`'s eligible meshes and marks their materials; returns how many. */
    add(root: THREE.Object3D) {
      const sources: THREE.Mesh[] = [];
      root.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          !(object instanceof THREE.InstancedMesh) &&
          !(object instanceof THREE.SkinnedMesh) &&
          !object.morphTargetInfluences &&
          object.receiveShadow &&
          object.layers.mask === defaultLayer.mask
        )
          sources.push(object);
      });
      let added = 0;
      for (const source of sources) {
        const list: THREE.Material[] = Array.isArray(source.material) ? source.material : [source.material];
        const copies = list.map((material) => {
          if (!takesShadowMask(material)) return hidden;
          mark(material as THREE.MeshStandardMaterial);
          return materialFor(material);
        });
        if (copies.every((material) => material === hidden)) continue;
        const copy = new THREE.Mesh(source.geometry, Array.isArray(source.material) ? copies : copies[0]);
        copy.name = `${source.name} shadow mask`;
        copy.layers.set(SHADOW_MASK_LAYER);
        copy.castShadow = false;
        copy.receiveShadow = true;
        copy.renderOrder = source.renderOrder;
        copy.frustumCulled = source.frustumCulled;
        source.add(copy);
        added++;
      }
      return added;
    },
    /**
     * Draws the mask of `camera`'s view of `width` × `height` pixels (from the lower left corner of
     * the target it will be drawn into) at half resolution; the lit pass reads it until `end()`.
     */
    render(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number, pass: MaskPass = 'main') {
      // three gathers only the lights on the camera's layers; the same lights in the same order
      // keep the shadow slots of the two passes alike.
      const casters: (THREE.DirectionalLight | THREE.SpotLight)[] = [];
      scene.traverse((object) => {
        if (!(object as THREE.Light).isLight) return;
        object.layers.enable(SHADOW_MASK_LAYER);
        if (object.castShadow) casters.push(object as THREE.DirectionalLight | THREE.SpotLight);
      });
      // The static shadow maps are drawn by the first render after they need it, of the objects on
      // that render's camera layers: drawn by this pass's layers, they would hold none. A frame that
      // needs them (loading, a quality change) first renders the view as it is, into this target.
      const refresh = casters.some(({ shadow }) => shadow.needsUpdate || !shadow.map);
      const target = targetFor(pass);
      const w = Math.max(1, Math.ceil(width / 2)),
        h = Math.max(1, Math.ceil(height / 2));
      if (target.width !== w || target.height !== h) target.setSize(w, h);

      const previousTarget = renderer.getRenderTarget();
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const autoClear = renderer.autoClear;
      const mask = camera.layers.mask;
      // Alpha 0: no surface (every drawn depth is positive).
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(target);
      if (refresh) {
        // Not reading the target it draws into.
        uniforms.suiShadowMask.value = null;
        renderer.render(scene, camera);
      }
      renderer.clear();
      renderer.autoClear = false;
      camera.layers.set(PREPASS_LAYER);
      renderer.render(scene, camera);
      camera.layers.set(SHADOW_MASK_LAYER);
      renderer.render(scene, camera);
      camera.layers.mask = mask;
      renderer.autoClear = autoClear;
      renderer.setClearColor(clear, alpha);
      renderer.setRenderTarget(previousTarget);
      uniforms.suiShadowMask.value = target.texture;
      uniforms.suiShadowMaskScale.value.set(w / width, h / height);
      uniforms.suiShadowMaskOn.value = true;
    },
    end() {
      uniforms.suiShadowMaskOn.value = false;
    },
    dispose() {
      for (const target of targets.values()) target.dispose();
      targets.clear();
      for (const material of [...materials.values(), ...cutouts.values()]) material.dispose();
      hidden.dispose();
    },
  };
}
export type ShadowMask = ReturnType<typeof createShadowMask>;
