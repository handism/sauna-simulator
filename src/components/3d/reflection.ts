import * as THREE from 'three';
// Patches lights_pars_begin and lights_fragment_begin first (suiProbes, suiWorldNormal).
import { createIrradianceTextures, IRRADIANCE_LINE, type IrradianceHeader } from './irradiance';

// What glossy rays see, baked from the source Cycles scenes by
// scripts/bake_irradiance_probes.py --reflection on the grids of the irradiance probes: the sky,
// the surfaces with all their light, and the lights that are visible to glossy rays but have no
// browser highlight (the V7 strip over the plunge, the V8 maple light, the deck edge lights,
// ...). The sun, Sky softbox, Sunlit courtyard, the lanterns and the six sauna-room lights are
// invisible to glossy rays in the source and are not in it; V9 and the blue-hour accents draw
// their own highlights. The irradiance probes cannot stand in for it: they hold those diffuse-only
// area lights, and without any environment reflection the browser missed the whitish sky sheen
// that Cycles adds to every surface (5–17% of the surface luminance), which left the courtyard
// too saturated.
//
// The L2 radiance is filtered for each material's roughness by scaling bands 1 and 2 as a
// von Mises–Fisher lobe of the same width as GGX (κ ≈ 2/α², Λl ≈ exp(−l(l+1)/2κ), α = roughness²)
// and evaluated along three's dominant direction; three's split-sum term (RE_IndirectSpecular)
// applies the Fresnel. L2 cannot hold a sharp mirror image: glass and water get a soft sheen.

export function createReflectionUniforms() {
  return {
    suiReflectionRoom: { value: null as THREE.Data3DTexture | null },
    suiReflectionCourtyard: { value: null as THREE.Data3DTexture | null },
    suiReflectionOuter: { value: null as THREE.Data3DTexture | null },
  };
}
export type ReflectionUniforms = ReturnType<typeof createReflectionUniforms>;

const layout = (header: IrradianceHeader) =>
  JSON.stringify(header.grids?.map(({ name, min, max, resolution }) => [name, min, max, resolution]));

/** Same packing as the irradiance probes; the grids must match (they share the grid uniforms). */
export function createReflectionTextures(irradiance: IrradianceHeader, header: IrradianceHeader, buffer: ArrayBuffer) {
  if (layout(header) !== layout(irradiance)) throw Error('reflection');
  const probes = createIrradianceTextures(header, buffer);
  return {
    apply(uniforms: ReflectionUniforms) {
      [uniforms.suiReflectionRoom.value, uniforms.suiReflectionCourtyard.value, uniforms.suiReflectionOuter.value] =
        probes.textures;
    },
    dispose: probes.dispose,
  };
}

/** Adds the reflection to every material lit by the probes (applyIrradiance first). */
export function applyReflection(root: THREE.Object3D, uniforms: ReflectionUniforms): number {
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (material instanceof THREE.MeshStandardMaterial && material.defines?.SUI_IRRADIANCE !== undefined)
        materials.add(material);
  });
  for (const material of materials) {
    const previous = material.onBeforeCompile;
    material.defines = { ...material.defines, SUI_REFLECTION: '' };
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
    };
    material.needsUpdate = true;
  }
  return materials.size;
}

export const REFLECTION_PARS = /* glsl */ `
#ifdef SUI_REFLECTION
uniform highp sampler3D suiReflectionRoom;
uniform highp sampler3D suiReflectionCourtyard;
uniform highp sampler3D suiReflectionOuter;

// Radiance arriving along D, filtered by a GGX lobe of the given roughness.
vec3 suiReflection( const in vec3 P, const in vec3 N, const in vec3 D, const in float roughness, const in bool interior ) {
	float alpha = roughness * roughness;
	vec2 lobe = exp( - vec2( 0.5, 1.5 ) * alpha * alpha );
	return suiProbes( suiReflectionRoom, suiReflectionCourtyard, suiReflectionOuter, P, N, D, vec3( 1.0, lobe ), interior );
}
#endif
`;

/** The reflection line of lights_fragment_begin (after radiance is declared). */
export const REFLECTION_LINE =
  'radiance += suiReflection( suiWorldPosition, suiWorldNormal, inverseTransformDirection( normalize( mix( reflect( - geometryViewDir, geometryNormal ), geometryNormal, pow4( material.roughness ) ) ), viewMatrix ), material.roughness, suiInterior );';
const RADIANCE = 'vec3 clearcoatRadiance = vec3( 0.0 );\n#endif';

// three 0.186 is pinned; irradiance.ts has already declared suiWorldNormal.
const begin = THREE.ShaderChunk.lights_fragment_begin;
if (!begin.includes(REFLECTION_LINE)) {
  const at = begin.indexOf(RADIANCE);
  if (at < 0 || at < begin.indexOf(IRRADIANCE_LINE) || !THREE.ShaderChunk.common.includes('inverseTransformDirection'))
    throw new Error('three lighting chunks changed; update reflection.ts');
  THREE.ShaderChunk.lights_pars_begin += REFLECTION_PARS;
  THREE.ShaderChunk.lights_fragment_begin =
    begin.slice(0, at + RADIANCE.length) +
    `\n#if defined( SUI_REFLECTION ) && defined( RE_IndirectSpecular )\n\t${REFLECTION_LINE}\n#endif` +
    begin.slice(at + RADIANCE.length);
}
