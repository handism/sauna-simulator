import * as THREE from 'three';
import { INTERIOR_BOX, WATER_BOX } from './interiorLights';
import { surfaceDetailOf, type SurfaceDetail } from './surfaceDetails';

// Rain-wet outdoor surfaces. Not in the source scenes, like the rain itself (rain.ts): during rain
// the deck, stones, paving and the moss ground darken (water fills the pores, so less light
// scatters back out), and the deck and stones turn glossier (a film of water that also smooths
// their fine relief). The gloss shows the reflection probe's overcast sky at grazing angles and
// the evening and night spot lights; it is an L2 probe, so there are no mirrored images and no
// puddles (a smooth patch could only show the same blurred grey). Upward faces get the full amount,
// vertical faces about half (the water runs off) and faces turned down a little. Nothing under
// the sauna room's roof (as for the falling rain) or below the plunge's surface gets wet.

export type WetSurface = Extract<SurfaceDetail, 'deck' | 'stone' | 'ground'>;

function wetSurfaceOf(name: string): WetSurface | null {
  const kind = surfaceDetailOf(name);
  return kind === 'deck' || kind === 'stone' || kind === 'ground' ? kind : null;
}

/** Darkening at full wetness and roughness of the water film, per surface. */
export const WETNESS: Record<WetSurface, { darken: number; roughness: number }> = {
  // Weathered ash soaks up water and darkens strongly. The probe only holds a blurred sky, so a
  // smoother film turned the whole deck an even grey sheen instead of reflecting its surroundings.
  deck: { darken: 0.5, roughness: 0.4 },
  // Honed stone and paving darken less and hold a thin film.
  stone: { darken: 0.62, roughness: 0.3 },
  // Soil and moss only darken: the blades keep it rough, and any gloss read as frost at a distance.
  ground: { darken: 0.6, roughness: 1 },
};

/** Margin of the sauna room's roof beyond its walls (m), as for the falling rain. */
const EAVES = 0.3;
/** Under the sauna room's roof, from just below its floor to the roof. */
const SHELTER = INTERIOR_BOX.clone().expandByVector(new THREE.Vector3(EAVES, 0.2, EAVES));
const vec3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;

const COMMON = '#include <common>';
const PROJECT = '#include <project_vertex>';
const EMISSIVE = '#include <emissivemap_fragment>';

const PARS = /* glsl */ `
uniform float suiRainWet;
varying vec3 vSuiWetPosition;
varying vec3 vSuiWetNormal;
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
    roughnessFactor = mix(roughnessFactor, min(roughnessFactor, SUI_WET_ROUGHNESS), suiWet);
    normal = normalize(mix(normal, nonPerturbedNormal, suiWet * 0.5));
  }
`;

export function patchRainWetnessShader(shader: { vertexShader: string; fragmentShader: string }) {
  if (
    !shader.vertexShader.includes(COMMON) ||
    !shader.vertexShader.includes(PROJECT) ||
    !shader.fragmentShader.includes(COMMON) ||
    !shader.fragmentShader.includes(EMISSIVE)
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
    .replace(EMISSIVE, `${WET}\n${EMISSIVE}`);
}

/** Lets the outdoor deck, stone and ground materials under `root` get wet by `amount` (0–1). */
export function applyRainWetness(root: THREE.Object3D, amount: { value: number }): number {
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
    const { darken, roughness } = WETNESS[kind];
    material.defines = {
      ...material.defines,
      SUI_WET_DARKEN: darken.toFixed(3),
      SUI_WET_ROUGHNESS: roughness.toFixed(3),
    };
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.suiRainWet = amount;
      patchRainWetnessShader(shader);
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}|rain-wet-v1`;
    material.needsUpdate = true;
  }
  return materials.size;
}
