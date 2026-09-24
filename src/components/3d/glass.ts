import * as THREE from 'three';
import { IRRADIANCE_PARS, type IrradianceUniforms } from './irradiance';
import { INTERIOR_BOX } from './interiorLights';
import { REFLECTION_PARS, type ReflectionUniforms } from './reflection';

// The source glass is a Principled BSDF with full transmission: 18 mm panes (closed boxes) of
// IOR 1.45 whose base color tints each refraction, and a hourglass of IOR 1.46. The exporter
// wrote it as a 12% opaque diffuse surface, lit by the sun and the probes, which made everything
// seen through the glass brighter (by 2.4x from the courtyard instead of Cycles' 1.35–1.48x).
//
// Each glass mesh is drawn twice, back to back: the view behind is multiplied by the slab's
// transmittance, then the reflection probes are added, weighted by its reflectance. With F the
// exact unpolarized dielectric Fresnel and t the base color, T = (1 − F)² t / (1 − F² t) and
// R = F + F (1 − F)² t / (1 − F² t): the source material in Cycles (18 mm slab, white emitter
// behind / white world) gave T = 0.812 / 0.896 / 0.887 and R = 0.062 at normal incidence and
// T = 0.525 / 0.579 / 0.573, R = 0.373 at 75°, all within 0.01 of these (tinting at both
// refractions, t², would pass only 0.71 of the red). The probes are sampled on the camera side of the
// pane, so the room grid serves views from inside the sauna. Refraction offsets (at most a few
// millimeters) and the 0.055 roughness are left out; L2 probes give a soft reflection.

/** Source IOR and base color by material name. */
export const GLASS: Record<string, { ior: number; tint: [number, number, number] }> = {
  'Low iron architectural glass': { ior: 1.45, tint: [0.87, 0.96, 0.95] },
  'V11 | timer clear glass': { ior: 1.46, tint: [0.9, 0.97, 1] },
};

/** Unpolarized Fresnel reflectance of a dielectric interface (suiFresnel in the shader). */
export function fresnel(cosine: number, eta: number): number {
  const g = Math.sqrt(Math.max(eta * eta - 1 + cosine * cosine, 0));
  const a = (g - cosine) / (g + cosine);
  const b = (cosine * (g + cosine) - 1) / (cosine * (g - cosine) + 1);
  return 0.5 * a * a * (1 + b * b);
}

/** The slab's per-channel transmittance and reflectance at a view angle, as the shader forms them. */
export function slab(cosine: number, optics: (typeof GLASS)[string]) {
  const f = fresnel(Math.max(cosine, 1e-4), optics.ior);
  const through = optics.tint.map((t) => ((1 - f) * (1 - f) * t) / (1 - f * f * t));
  return { transmittance: through, reflectance: through.map((t) => f + f * t) };
}

const vec3 = (v: THREE.Vector3) => `vec3( ${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)} )`;

const vertexShader = /* glsl */ `varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
void main() {
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vWorldPosition = world.xyz;
	vWorldNormal = normalize( mat3( modelMatrix ) * normal );
	gl_Position = projectionMatrix * viewMatrix * world;
}`;

const fragmentShader = /* glsl */ `#include <common>
${IRRADIANCE_PARS}
${REFLECTION_PARS}
uniform float ior;
uniform vec3 tint;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

// Unpolarized Fresnel reflectance of a dielectric interface (from the outer medium).
float suiFresnel( const in float cosine, const in float eta ) {
	float g2 = eta * eta - 1.0 + cosine * cosine;
	float g = sqrt( max( g2, 0.0 ) );
	float a = ( g - cosine ) / ( g + cosine );
	float b = ( cosine * ( g + cosine ) - 1.0 ) / ( cosine * ( g - cosine ) + 1.0 );
	return 0.5 * a * a * ( 1.0 + b * b );
}

void main() {
	vec3 V = normalize( cameraPosition - vWorldPosition );
	vec3 N = normalize( vWorldNormal );
	N = dot( N, V ) < 0.0 ? - N : N;
	float F = suiFresnel( max( dot( N, V ), 1e-4 ), ior );
	vec3 through = ( 1.0 - F ) * ( 1.0 - F ) * tint / ( 1.0 - F * F * tint );
	#ifdef SUI_GLASS_TRANSMISSION
		gl_FragColor = vec4( through, 1.0 );
	#else
		// Camera side of the pane, which lies on the room box.
		vec3 P = vWorldPosition + N * 0.02;
		bool interior = all( greaterThanEqual( P, ${vec3(INTERIOR_BOX.min)} ) ) && all( lessThanEqual( P, ${vec3(INTERIOR_BOX.max)} ) );
		vec3 radiance = suiReflection( P, N, reflect( - V, N ), 0.055, interior );
		gl_FragColor = vec4( radiance * ( F + F * through ), 1.0 );
		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	#endif
}`;

function glassMaterial(
  source: THREE.Material,
  optics: (typeof GLASS)[string],
  transmission: boolean,
  uniforms: IrradianceUniforms & ReflectionUniforms,
) {
  const material = new THREE.ShaderMaterial({
    name: source.name,
    defines: transmission ? { SUI_GLASS_TRANSMISSION: '' } : { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: { ...uniforms, ior: { value: optics.ior }, tint: { value: new THREE.Vector3(...optics.tint) } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    // dst × transmittance, then + reflection.
    blendSrc: transmission ? THREE.ZeroFactor : THREE.OneFactor,
    blendDst: transmission ? THREE.SrcColorFactor : THREE.OneFactor,
    // A factor, not a color: never tone mapped.
    toneMapped: !transmission,
  });
  return material;
}

/**
 * Replaces the exported glass of the model. The original mesh keeps its shadow and draws the
 * transmittance; a copy sharing its geometry draws the reflection right after it (equal render
 * order and depth, so the later id sorts last). Returns the number of glass meshes.
 */
export function applyGlass(root: THREE.Object3D, uniforms: IrradianceUniforms & ReflectionUniforms): number {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && GLASS[object.material.name])
      meshes.push(object);
  });
  for (const mesh of meshes) {
    const source = mesh.material as THREE.Material;
    const optics = GLASS[source.name];
    mesh.material = glassMaterial(source, optics, true, uniforms);
    const reflection = new THREE.Mesh(mesh.geometry, glassMaterial(source, optics, false, uniforms));
    reflection.name = `${mesh.name} reflection`;
    reflection.castShadow = reflection.receiveShadow = false;
    mesh.add(reflection);
    source.dispose();
  }
  return meshes.length;
}
