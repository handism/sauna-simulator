import * as THREE from 'three';
import { IRRADIANCE_PARS, type IrradianceUniforms } from './irradiance';
import { INTERIOR_BOX, interiorPointSources } from './interiorLights';
import { MIRROR_LAYER } from './planarReflection';
import { REFLECTION_PARS } from './reflection';
import { GLOSSY_SOURCES } from './glossyLights';
import { sourcesGlsl } from './waterBottom';
import { CANOPY_GLSL } from './waterLightOcclusion';

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
//
// Not in the source's shortcut: the probes hold no direct light of the browser's lights, so from
// inside the sauna by night the glass showed the dark garden with none of the lit room in it
// (Cycles shows the warm room on the panes). The reflected view is followed to the room box's
// cedar wall, floor or ceiling and lit there by the six room lights as points (their spread and
// the benches in the way are left out); a view to the other glass sees none of it.
/** The room's cedar and ash as seen in the glass (linear albedo). */
export const ROOM_ALBEDO = [0.26, 0.17, 0.085];

// Nor do the probes hold V9 and the five blue-hour accents, whose highlights the browser draws
// (scripts/bake_irradiance_probes.py), but not on the glass: by night Cycles shows the 2 m lounge
// dusk fill as a bright disk in the sauna's window seen from the plunge, which the panes lacked.
// From outside the room the reflected view is tested against their shapes as the water's bottom
// does (waterBottom.ts sourcesGlsl, the canopy in the way); other occluders are left out. From
// inside, the reflected view stays in the room. Not in the water's mirror: seen off the water and
// then the glass, the lights are a second glossy bounce, which Cycles' indirect clamp leaves faint
// (by day V9 is a white disk in the pane looking up, as in Cycles, but only a pale ring in the
// water below it).
/** The glossy-only lights left out of the reflection probes (seen by the glass from outside). */
export const GLASS_LIGHTS = [
  'V9 lounge patch of sunlight',
  'V10 lounge dusk fill',
  'V10 path grazing light 1',
  'V10 path grazing light 4',
  'V10 path grazing light 7',
  'V10 specimen uplight',
];
// The reflection's material only (the transmittance's has no irradiance uniforms).
const GLASS_LIGHTS_GLSL = /* glsl */ `
#ifdef SUI_REFLECTION
${CANOPY_GLSL}
vec3 suiGlassLights( const in vec3 origin, const in vec3 direction ) {
	vec3 sum = vec3( 0.0 );
	float along;
	float t;
${sourcesGlsl(GLOSSY_SOURCES.filter(([name]) => GLASS_LIGHTS.includes(name)))}	return sum;
}
#endif`;

// The condensation beads on the sauna's window are fully transmissive water (IOR 1.333) too, but
// the exporter wrote them as an opaque off-white surface: dimly lit, they showed as dark specks
// against the bright sky. Drawn as this glass, each bead's front face is one slab; the blur of
// its refraction (Cycles' frosted view through them) is left out.

/** Source IOR and base color by material name. */
export const GLASS: Record<string, { ior: number; tint: [number, number, number] }> = {
  'Low iron architectural glass': { ior: 1.45, tint: [0.87, 0.96, 0.95] },
  'V11 | timer clear glass': { ior: 1.46, tint: [0.9, 0.97, 1] },
  'V2 | condensed clear droplets': { ior: 1.333, tint: [0.94, 0.98, 1] },
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

// The room lights' direct light reflected toward the camera from where the view R from P (inside
// the room box) meets the box: no light on the glass sides (+x and +z).
const ROOM_GLOW = (() => {
  const lights = interiorPointSources()
    .map(
      ({ position, emit, intensity }) => `
	d = H - ${vec3(position)};
	r2 = dot( d, d ) + 0.15;
	d = normalize( d );
	E += ${vec3(new THREE.Vector3(intensity.r, intensity.g, intensity.b))} * max( dot( d, ${vec3(emit)} ), 0.0 ) * max( - dot( d, Nh ), 0.0 ) / r2;`,
    )
    .join('');
  return /* glsl */ `
vec3 suiRoomGlow( const in vec3 P, const in vec3 R ) {
	vec3 bound = mix( ${vec3(INTERIOR_BOX.min)}, ${vec3(INTERIOR_BOX.max)}, step( 0.0, R ) );
	vec3 t = ( bound - P ) / mix( vec3( 1e-6 ), R, step( 1e-6, abs( R ) ) );
	float hit = min( t.x, min( t.y, t.z ) );
	vec3 Nh = t.x == hit ? vec3( - sign( R.x ), 0.0, 0.0 ) : t.y == hit ? vec3( 0.0, - sign( R.y ), 0.0 ) : vec3( 0.0, 0.0, - sign( R.z ) );
	if ( Nh.x < 0.0 || Nh.z < 0.0 ) return vec3( 0.0 );
	vec3 H = P + R * hit;
	vec3 E = vec3( 0.0 );
	vec3 d;
	float r2;${lights}
	return ${vec3(new THREE.Vector3(...ROOM_ALBEDO))} * RECIPROCAL_PI * E;
}`;
})();

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
uniform float suiGlassLightsOn;
${ROOM_GLOW}
${GLASS_LIGHTS_GLSL}
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
		vec3 radiance = suiReflection( P, N, reflect( - V, N ), 0.055, interior, false );
		if ( interior ) radiance += suiRoomGlow( P, reflect( - V, N ) );
		else radiance += suiGlassLightsOn * suiGlassLights( P, reflect( - V, N ) );
		gl_FragColor = vec4( radiance * ( F + F * through ), 1.0 );
		#include <tonemapping_fragment>
		#include <colorspace_fragment>
	#endif
}`;

function glassMaterial(
  source: THREE.Material,
  optics: (typeof GLASS)[string],
  transmission: boolean,
  uniforms: IrradianceUniforms,
) {
  const material = new THREE.ShaderMaterial({
    name: source.name,
    defines: transmission ? { SUI_GLASS_TRANSMISSION: '' } : { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: {
      ...uniforms,
      ior: { value: optics.ior },
      tint: { value: new THREE.Vector3(...optics.tint) },
      suiGlassLightsOn: { value: 1 },
    },
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
export function applyGlass(root: THREE.Object3D, uniforms: IrradianceUniforms): number {
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
    const uniform = (reflection.material as THREE.ShaderMaterial).uniforms.suiGlassLightsOn;
    reflection.onBeforeRender = (_renderer, _scene, camera) => {
      uniform.value = camera.layers.isEnabled(MIRROR_LAYER) ? 0 : 1;
    };
    mesh.add(reflection);
    source.dispose();
  }
  return meshes.length;
}
