import * as THREE from 'three';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';
import type { PlanarReflectionUniforms } from './planarReflection';
import { surfaceDetailOf, type SurfaceDetail } from './surfaceDetails';
import { RAIN_RIPPLE_GLSL } from './waterEffects';

// Rain-wet outdoor surfaces. Not in the source scenes, like the rain itself (rain.ts): during rain
// the deck, stones, paving and the moss ground darken (water fills the pores, so less light
// scatters back out), and the deck and stones turn glossier (a film of water that also smooths
// their fine relief). Upward faces get the full amount, vertical faces about half (the water runs
// off) and faces turned down a little. Nothing under the sauna room's roof (as for the falling rain)
// or below the plunge's surface gets wet.
//
// The reflection probes are L2 and hold only a blurred sky, so with them alone a glossier film or a
// puddle read as an even grey sheen (frost). Given the deck's mirror (a planar reflection in the
// plane of the deck's top, drawn while it rains), the flat tops of the deck and stones reflect it
// instead: the film a blurred image streaked towards the viewer (the reflected lobe stretches in
// the plane of incidence), and sparse puddles of standing water a sharp one, rippled by the drops
// like the plunge (waterEffects.ts). Without the mirror (low quality, no HDR output, the deck out of
// sight) there are no puddles and the probes stay.

export type WetSurface = Extract<SurfaceDetail, 'deck' | 'stone' | 'ground'>;

function wetSurfaceOf(name: string): WetSurface | null {
  const kind = surfaceDetailOf(name);
  return kind === 'deck' || kind === 'stone' || kind === 'ground' ? kind : null;
}

/**
 * Darkening at full wetness and roughness of the water film, per surface; for the mirroring ones,
 * the film's roughness while the mirror shows and the noise level above which water stands in
 * puddles (higher is fewer).
 */
export const WETNESS: Record<WetSurface, { darken: number; roughness: number; mirror?: number; pool?: number }> = {
  // Weathered ash soaks up water and darkens strongly; puddles only where the boards dip. With the
  // probes alone a smoother film turned the whole deck an even grey sheen.
  deck: { darken: 0.5, roughness: 0.4, mirror: 0.3, pool: 0.75 },
  // Honed stone and paving darken less, hold a thin film, and water stands in their hollows.
  stone: { darken: 0.62, roughness: 0.3, mirror: 0.22, pool: 0.68 },
  // Soil and moss only darken: the blades keep it rough, and any gloss read as frost at a distance.
  ground: { darken: 0.6, roughness: 1 },
};

/** Height of the deck's top (m), the plane of its mirror; the stepping stones and paving lie within 1 cm. */
export const DECK_LEVEL = 0.075;
/** The deck, the stepping stones beyond it and the paving, on the plane of the deck's top. */
export const DECK_AREA = new THREE.Box2(new THREE.Vector2(-7, -1.7), new THREE.Vector2(7, 4.6));
/** Angular half width of the film's blurred reflection per unit of GGX alpha, before stretching. */
export const FILM_SPREAD = 2.2;

/** Margin of the sauna room's roof beyond its walls (m), as for the falling rain. */
const EAVES = 0.3;
/** Under the sauna room's roof, from just below its floor to the roof. */
const SHELTER = INTERIOR_BOX.clone().expandByVector(new THREE.Vector3(EAVES, 0.2, EAVES));
const vec3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
const f = (value: number) => value.toFixed(4);

const COMMON = '#include <common>';
const PROJECT = '#include <project_vertex>';
const EMISSIVE = '#include <emissivemap_fragment>';
const LIGHTS_END = '#include <lights_fragment_end>';

const PARS = /* glsl */ `
uniform float suiRainWet;
varying vec3 vSuiWetPosition;
varying vec3 vSuiWetNormal;
#ifdef SUI_WET_MIRROR
uniform float suiWetTime;
uniform sampler2D suiWetMirror;
uniform mat4 suiWetMirrorMatrix;
uniform vec2 suiWetMirrorLimit;
uniform float suiWetMirrorAmount;
// Set before lighting: how much of the probes' reflection the mirror replaces, and the puddles.
float suiWetMirrorWeight = 0.0;
float suiPuddle = 0.0;
float suiWetHash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}
float suiWetNoise( vec2 p ) {
  vec2 cell = floor( p ), t = fract( p );
  t = t * t * ( 3.0 - 2.0 * t );
  return mix( mix( suiWetHash( cell ), suiWetHash( cell + vec2( 1.0, 0.0 ) ), t.x ),
    mix( suiWetHash( cell + vec2( 0.0, 1.0 ) ), suiWetHash( cell + vec2( 1.0, 1.0 ) ), t.x ), t.y );
}
${RAIN_RIPPLE_GLSL}
vec3 suiWetMirrorAt( vec3 P, vec3 direction ) {
  vec4 image = suiWetMirrorMatrix * vec4( P + direction * 2.0, 1.0 );
  return texture2D( suiWetMirror, clamp( image.xy / image.w, vec2( 0.0 ), suiWetMirrorLimit ) ).rgb;
}
#endif
`;

// After every color, roughness and normal change (the image ramps, surface details and snow), so
// the film smooths their bumps and its roughness is not clamped by the surface details.
const WET = /* glsl */ `
  {
    vec3 suiWetP = vSuiWetPosition;
    float suiWetUp = normalize(vSuiWetNormal).y;
    #ifdef DOUBLE_SIDED
    suiWetUp *= gl_FrontFacing ? 1.0 : -1.0;
    #endif
    bool suiWetSheltered = all(greaterThan(suiWetP, ${vec3(SHELTER.min)})) && all(lessThan(suiWetP, ${vec3(SHELTER.max)}));
    bool suiWetSubmerged = all(greaterThanEqual(suiWetP, ${vec3(WATER_BOX.min)}))
      && all(lessThanEqual(suiWetP, ${vec3(WATER_BOX.max)}));
    float suiWet = (suiWetSheltered || suiWetSubmerged) ? 0.0 : suiRainWet;
    suiWet *= mix(0.25, 1.0, smoothstep(-0.4, 0.0, suiWetUp)) * mix(0.5, 1.0, smoothstep(0.3, 0.8, suiWetUp));
    diffuseColor.rgb *= mix(1.0, SUI_WET_DARKEN, suiWet);
    float suiWetRoughness = SUI_WET_ROUGHNESS;
    #ifdef SUI_WET_MIRROR
    suiWetRoughness = mix(suiWetRoughness, SUI_WET_MIRROR_ROUGHNESS, suiWetMirrorAmount);
    #endif
    roughnessFactor = mix(roughnessFactor, min(roughnessFactor, suiWetRoughness), suiWet);
    normal = normalize(mix(normal, nonPerturbedNormal, suiWet * 0.5));
    #ifdef SUI_WET_MIRROR
    // The flat tops on the mirror's plane (the deck, stepping stones and paving).
    float suiWetFlat = smoothstep(0.9, 0.98, suiWetUp) * (1.0 - smoothstep(0.012, 0.03, abs(suiWetP.y - SUI_WET_MIRROR)));
    suiWetMirrorWeight = suiWetFlat * suiWet;
    if (suiWetMirrorWeight > 0.0 && suiWetMirrorAmount > 0.5) {
      float suiPool = suiWetNoise(suiWetP.xz * 1.7) * 0.65 + suiWetNoise(suiWetP.xz * 4.6 + 7.1) * 0.35;
      float suiPoolEdge = fwidth(suiPool) + 0.012;
      suiPuddle = suiWetMirrorWeight * smoothstep(0.6, 1.0, suiWet) * smoothstep(SUI_WET_POOL - suiPoolEdge, SUI_WET_POOL + suiPoolEdge, suiPool);
      if (suiPuddle > 0.0) {
        // Under standing water: a little darker, mirror smooth and only the drops' rings. Darker
        // puddles read as stains where they mirror the dark tub wall or the pergola.
        diffuseColor.rgb *= mix(1.0, 0.85, suiPuddle);
        roughnessFactor = mix(roughnessFactor, 0.04, suiPuddle);
        vec2 suiRings = suiRainRipples(suiWetP.xz, suiWetTime) * suiPuddle;
        normal = normalize(mix(normal, nonPerturbedNormal, suiPuddle) + mat3(viewMatrix) * vec3(-suiRings.x, 0.0, -suiRings.y));
      }
    }
    #endif
  }
`;

// Replaces the probes' reflection (radiance, reflection.ts) before the indirect specular is
// applied, so three's split-sum Fresnel and the material's roughness still scale it.
const MIRROR = /* glsl */ `
#if defined( SUI_WET_MIRROR ) && defined( RE_IndirectSpecular )
  if ( suiWetMirrorWeight > 0.0 && suiWetMirrorAmount > 0.0 ) {
    vec3 suiWetN = inverseTransformDirection( normal, viewMatrix );
    vec3 suiWetV = normalize( cameraPosition - vSuiWetPosition );
    vec3 suiWetR = reflect( - suiWetV, suiWetN );
    // The film's lobe, in the plane of incidence and stretched at grazing angles; none in puddles.
    float suiWetAlpha = roughnessFactor * roughnessFactor;
    float suiWetSpread = ${f(FILM_SPREAD)} * suiWetAlpha * ( 1.0 + 2.0 * ( 1.0 - abs( dot( suiWetV, suiWetN ) ) ) ) * ( 1.0 - suiPuddle );
    vec3 suiWetT = suiWetN - suiWetR * dot( suiWetN, suiWetR );
    suiWetT *= inversesqrt( max( dot( suiWetT, suiWetT ), 1e-6 ) );
    vec3 suiWetB = cross( suiWetR, suiWetT );
    vec3 suiWetImage = vec3( 0.0 );
    float suiWetTotal = 0.0;
    for ( int i = - 3; i <= 3; i ++ ) {
      float k = float( i ) / 3.0;
      float w = exp( - 2.0 * k * k );
      vec3 d = normalize( suiWetR + suiWetSpread * ( k * suiWetT + 0.2 * k * suiWetB ) );
      suiWetImage += w * suiWetMirrorAt( vSuiWetPosition, d );
      suiWetTotal += w;
    }
    radiance = mix( radiance, suiWetImage / suiWetTotal, suiWetMirrorWeight * suiWetMirrorAmount );
  }
#endif
`;

export function patchRainWetnessShader(shader: { vertexShader: string; fragmentShader: string }) {
  if (
    !shader.vertexShader.includes(COMMON) ||
    !shader.vertexShader.includes(PROJECT) ||
    !shader.fragmentShader.includes(COMMON) ||
    !shader.fragmentShader.includes(EMISSIVE) ||
    !shader.fragmentShader.includes(LIGHTS_END)
  )
    throw Error('Unsupported three.js shader chunks for rain wetness');
  shader.vertexShader = shader.vertexShader
    .replace(COMMON, `${COMMON}\nvarying vec3 vSuiWetPosition;\nvarying vec3 vSuiWetNormal;`)
    .replace(
      PROJECT,
      `${PROJECT}\nvSuiWetPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSuiWetNormal = inverseTransformDirection(transformedNormal, viewMatrix);`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(COMMON, `${COMMON}\n${PARS}`)
    .replace(EMISSIVE, `${WET}\n${EMISSIVE}`)
    .replace(LIGHTS_END, `${MIRROR}\n${LIGHTS_END}`);
}

/** The deck's mirror (planarReflection.ts) and the time of the drops' rings. */
export interface WetMirror {
  uniforms: PlanarReflectionUniforms;
  time: { value: number };
}

/**
 * Lets the outdoor deck, stone and ground materials under `root` get wet by `amount` (0–1); with
 * `mirror`, the deck's and stones' flat tops reflect it.
 */
export function applyRainWetness(root: THREE.Object3D, amount: { value: number }, mirror?: WetMirror): number {
  const materials = new Map<THREE.MeshStandardMaterial, WetSurface>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const kind = wetSurfaceOf(material.name);
      if (kind && material instanceof THREE.MeshStandardMaterial && material.defines?.SUI_WET_DARKEN === undefined)
        materials.set(material, kind);
    }
  });
  for (const [material, kind] of materials) {
    const { darken, roughness, mirror: mirrorRoughness, pool } = WETNESS[kind];
    // The approach stones' tops (deckIrradiance.ts) and the sauna room's surfaces (roomIrradiance.ts,
    // under the roof) already use all 16 texture units with their local irradiance: they keep the probes.
    const mirrored =
      mirror &&
      pool !== undefined &&
      mirrorRoughness !== undefined &&
      !material.userData.suiDeckReceiver &&
      !material.userData.suiRoomReceiver;
    material.defines = {
      ...material.defines,
      SUI_WET_DARKEN: darken.toFixed(3),
      SUI_WET_ROUGHNESS: roughness.toFixed(3),
      ...(mirrored && {
        SUI_WET_MIRROR: DECK_LEVEL.toFixed(3),
        SUI_WET_MIRROR_ROUGHNESS: mirrorRoughness.toFixed(3),
        SUI_WET_POOL: pool.toFixed(3),
      }),
    };
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.suiRainWet = amount;
      if (mirrored) {
        shader.uniforms.suiWetTime = mirror.time;
        shader.uniforms.suiWetMirror = mirror.uniforms.suiMirror;
        shader.uniforms.suiWetMirrorMatrix = mirror.uniforms.suiMirrorMatrix;
        shader.uniforms.suiWetMirrorLimit = mirror.uniforms.suiMirrorLimit;
        shader.uniforms.suiWetMirrorAmount = mirror.uniforms.suiMirrorAmount;
      }
      patchRainWetnessShader(shader);
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}|rain-wet-v2`;
    material.needsUpdate = true;
  }
  return materials.size;
}

/** A plane over the deck's area for the mirror's bounds (planarReflection.ts); never drawn. */
export function deckMirrorSurface() {
  const size = DECK_AREA.getSize(new THREE.Vector2());
  const center = DECK_AREA.getCenter(new THREE.Vector2());
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y));
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(center.x, DECK_LEVEL, center.y);
  surface.updateMatrixWorld();
  return surface;
}
