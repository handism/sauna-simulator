import * as THREE from 'three';
import { IRRADIANCE_PARS, type IrradianceUniforms } from './irradiance';
import { REFLECTION_PARS } from './reflection';
import type { PlanarReflectionUniforms } from './planarReflection';

export interface WaterDefinition {
  center: number[];
  size: [number, number];
  inlet: number[];
  spout: number[];
}

// The waves of the source water mesh (V4 rippled spring water volume), fitted to its top: rings
// around the spout and a plane wave across the pool (R² 0.986, residual 0.11 mm, source slope
// spread about 0.02), in glTF-axis meters: blender (x, y) is (x, −z). Cycles renders them still; here
// they run outward at the phase speed of capillary–gravity waves of that length (ω² = gk + σk³/ρ),
// and reduced motion keeps the source's shape. The Bump node's fine noise (slopes near 0.003) is
// left out.
export const WAVES = {
  center: [1.18, -3.99] as const,
  ring: { amplitude: 0.005585, decay: 1.6814, number: 33.988 },
  plane: { amplitude: 0.00068389, vector: [15, -10] as const },
};
export const waveSpeed = (k: number) => Math.sqrt(9.81 * k + (0.0728 / 1000) * k ** 3);

/** Height of the source water surface above its mean level at glTF (x, z), time `t`. */
export function waveHeight(x: number, z: number, t = 0) {
  const r = Math.hypot(x - WAVES.center[0], z - WAVES.center[1]);
  const { amplitude, decay, number } = WAVES.ring;
  const plane = WAVES.plane.vector[0] * x + WAVES.plane.vector[1] * z;
  const k = Math.hypot(...WAVES.plane.vector);
  return (
    amplitude * Math.exp(-decay * r) * Math.sin(number * r - waveSpeed(number) * t) +
    WAVES.plane.amplitude * Math.sin(plane - waveSpeed(k) * t)
  );
}

const f = (v: number) => v.toFixed(6);
/** The surface normal of WAVES at world (x, z) and time t, in GLSL (also used by refraction.ts). */
export const WAVE_NORMAL = /* glsl */ `
vec3 suiWaveNormal( vec2 xz, float t ) {
	vec2 offset = xz - vec2( ${f(WAVES.center[0])}, ${f(WAVES.center[1])} );
	float r = max( length( offset ), 1e-4 );
	float phase = ${f(WAVES.ring.number)} * r - ${f(waveSpeed(WAVES.ring.number))} * t;
	float slope = ${f(WAVES.ring.amplitude)} * exp( - ${f(WAVES.ring.decay)} * r ) * ( ${f(WAVES.ring.number)} * cos( phase ) - ${f(WAVES.ring.decay)} * sin( phase ) );
	vec2 k = vec2( ${f(WAVES.plane.vector[0])}, ${f(WAVES.plane.vector[1])} );
	vec2 gradient = slope * offset / r + ${f(WAVES.plane.amplitude)} * cos( dot( k, xz ) - ${f(waveSpeed(Math.hypot(...WAVES.plane.vector)))} * t ) * k;
	return normalize( vec3( - gradient.x, 1.0, - gradient.y ) );
}
`;

// The source water's Bump node (Strength 0.08, Distance 0.0006, not inverted) on the Fac of a
// normalized FBM noise (Scale 55, Detail 2, Roughness 0.5, Lacunarity 2) of Object coordinates,
// which are Blender world meters (the water has no transform). Its slopes are small (about 0.005),
// but a view that leaves the water toward a light meters away swings with them: in Cycles the
// edges of the lights seen off the water's bottom (waterBottom.ts) are ragged, and smooth with
// the bump removed (docs/3d-qa/water-bottom-bump).
export const WATER_BUMP = { scale: 55, detail: 2, roughness: 0.5, lacunarity: 2, distance: 0.0006, strength: 0.08 };
/** Finite-difference step of the bump's height, in meters (the finest octave's cells are 4.5 mm). */
export const WATER_BUMP_STEP = 0.0004;

/**
 * GLSL (needs FBM_GLSL): suiWaterBump( p, n, footprint ) is the normal n at the glTF point p
 * perturbed like Blender's Bump node, with the surface taken as level for the height's gradient.
 * footprint is a pixel's size there in meters; octaves finer than it fade out (noiseColor.ts).
 */
export const WATER_BUMP_GLSL = /* glsl */ `
float suiWaterBumpHeight( vec3 blender, float footprint ) {
	return sui_fbm( blender * ${f(WATER_BUMP.scale)}, ${f(WATER_BUMP.detail)}, ${f(WATER_BUMP.roughness)}, ${f(WATER_BUMP.lacunarity)}, footprint * ${f(WATER_BUMP.scale)} );
}
vec3 suiWaterBump( vec3 p, vec3 n, float footprint ) {
	// glTF (x, y, z) is Blender (x, −z, y).
	vec3 blender = vec3( p.x, - p.z, p.y );
	float h = suiWaterBumpHeight( blender, footprint );
	float hx = suiWaterBumpHeight( blender + vec3( ${f(WATER_BUMP_STEP)}, 0.0, 0.0 ), footprint );
	float hz = suiWaterBumpHeight( blender - vec3( 0.0, ${f(WATER_BUMP_STEP)}, 0.0 ), footprint );
	vec3 gradient = vec3( hx - h, 0.0, hz - h ) / ${f(WATER_BUMP_STEP)};
	gradient -= n * dot( n, gradient );
	vec3 bumped = normalize( n - ${f(WATER_BUMP.distance)} * gradient );
	return normalize( mix( n, bumped, ${f(WATER_BUMP.strength)} ) );
}
`;

// How far the mirror image is looked up along the rippled reflection ray, in meters. The true
// distance to the reflected surface varies (the tub walls are 0.1–3 m away); this sets how far the
// waves displace the image.
export const MIRROR_DISTANCE = 0.6;

// A bounded surface avoids rings crossing the pool coping. No fluid simulation.
// `probes` are the shared probe uniforms (reflection.ts), filled before the first frame; `mirror`
// is the planar reflection (planarReflection.ts), used while it holds this frame's image.
export function createWaterEffects(
  definition: WaterDefinition,
  probes: IrradianceUniforms,
  mirror: PlanarReflectionUniforms,
) {
  const group = new THREE.Group();
  const time = { value: 0 };
  const vertexShader = `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  // The source water is clear (transmission 1, IOR 1.333, absorption density 0.12), so the teal
  // tiles below stay visible. Only the Fresnel reflection is blended over: the mirror image, or
  // the reflection probes (roughness 0.018 of the source) when there is none.
  const water = new THREE.ShaderMaterial({
    defines: { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: { ...probes, ...mirror, time },
    vertexShader: `varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `#include <common>
      ${IRRADIANCE_PARS}
      ${REFLECTION_PARS}
      ${WAVE_NORMAL}
      uniform float time; uniform sampler2D suiMirror; uniform mat4 suiMirrorMatrix; uniform vec2 suiMirrorLimit; uniform float suiMirrorAmount;
      varying vec3 vWorld;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 normal = suiWaveNormal(vWorld.xz, time);
        if (view.y < 0.0) normal = -normal;
        float facing = clamp(dot(normal, view), 0.0, 1.0);
        // Schlick's approximation for water (F0 = 0.02).
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        vec3 direction = reflect(-view, normal);
        vec3 color = suiReflection(vWorld + normal * 0.02, normal, direction, 0.018, false, false);
        if (suiMirrorAmount > 0.0) {
          // The flat mirror's ray through this point projects onto it; the rippled one is displaced.
          vec4 image = suiMirrorMatrix * vec4(vWorld + direction * ${MIRROR_DISTANCE.toFixed(2)}, 1.0);
          color = mix(color, texture2D(suiMirror, clamp(image.xy / image.w, vec2(0.0), suiMirrorLimit)).rgb, suiMirrorAmount);
        }
        gl_FragColor = vec4(color, fresnel);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(...definition.size), water);
  surface.rotation.x = -Math.PI / 2;
  surface.position.fromArray(definition.center);
  surface.updateMatrixWorld();
  group.add(surface);
  const flow = new THREE.ShaderMaterial({
    uniforms: { time },
    vertexShader,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main() {
        float streak = 0.5 + 0.5 * sin(vUv.x * 110.0 + sin(vUv.y * 14.0 + time * 5.0));
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(0.0, 0.08, 1.0-vUv.x);
        gl_FragColor = vec4(vec3(0.62, 0.83, 0.84), (0.13 + streak * 0.15) * edge);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const height = definition.spout[1] - definition.inlet[1];
  const cascade = new THREE.Mesh(new THREE.PlaneGeometry(0.46, height), flow);
  cascade.position.fromArray(definition.inlet);
  cascade.position.y += height / 2;
  cascade.position.z += 0.015;
  group.add(cascade);
  return {
    group,
    surface,
    /** The waves' time in seconds (0 with reduced motion), shared with the underwater views. */
    time,
    update: (seconds: number, reducedMotion: boolean) => {
      time.value = reducedMotion ? 0 : seconds;
    },
  };
}
