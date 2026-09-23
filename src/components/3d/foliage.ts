import * as THREE from 'three';

// Thin leaves, fern fronds and conifer sprays. Fallen leaves and moss lie on the ground.
const FOLIAGE = /\b(leaf|foliage|fern)\b|maple fresh olive/i;
// Share of the diffuse response passed to the far face. The Cycles source used a
// small Subsurface Weight plus bounced light; this is a realtime approximation.
export const FOLIAGE_TRANSMISSION = 0.6;

const PARS_INCLUDE = '#include <lights_physical_pars_fragment>';
const BEGIN_INCLUDE = '#include <lights_fragment_begin>';
const HEMISPHERE_TARGET = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';

export function isFoliageMaterial(material: THREE.Material): material is THREE.MeshStandardMaterial {
  return material instanceof THREE.MeshStandardMaterial && FOLIAGE.test(material.name);
}

// geometryNormal faces the viewer on double-sided leaves, so light arriving on the
// opposite face is transmitted through the blade instead of leaving it black.
export function patchFoliageShader(fragmentShader: string): string {
  const begin = THREE.ShaderChunk.lights_fragment_begin;
  if (
    !fragmentShader.includes(PARS_INCLUDE) ||
    !fragmentShader.includes(BEGIN_INCLUDE) ||
    !begin.includes(HEMISPHERE_TARGET)
  ) {
    throw Error('Unsupported three.js lighting chunks for foliage transmission');
  }
  const transmission = FOLIAGE_TRANSMISSION.toFixed(2);
  return fragmentShader
    .replace(
      PARS_INCLUDE,
      `${PARS_INCLUDE}
void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	reflectedLight.directDiffuse += ${transmission} * saturate( - dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Foliage`,
    )
    .replace(
      BEGIN_INCLUDE,
      begin.replace(
        HEMISPHERE_TARGET,
        `${HEMISPHERE_TARGET}
			irradiance += ${transmission} * getHemisphereLightIrradiance( hemisphereLights[ i ], - geometryNormal );`,
      ),
    );
}

export function applyFoliageTransmission(material: THREE.MeshStandardMaterial) {
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = patchFoliageShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'foliage-transmission';
  material.needsUpdate = true;
}
