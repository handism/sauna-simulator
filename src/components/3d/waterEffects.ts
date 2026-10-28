import * as THREE from 'three';
import { IRRADIANCE_PARS, type IrradianceUniforms } from './irradiance';
import { REFLECTION_PARS } from './reflection';
import type { PlanarReflectionUniforms } from './planarReflection';
import { createSpoutWater } from './waterSpout';

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

/** Analytic CPU counterpart of WAVE_NORMAL, for the refraction reference tests. */
export function waveNormal(x: number, z: number, t = 0) {
  const dx = x - WAVES.center[0],
    dz = z - WAVES.center[1];
  const r = Math.max(Math.hypot(dx, dz), 1e-4);
  const phase = WAVES.ring.number * r - waveSpeed(WAVES.ring.number) * t;
  const slope =
    WAVES.ring.amplitude *
    Math.exp(-WAVES.ring.decay * r) *
    (WAVES.ring.number * Math.cos(phase) - WAVES.ring.decay * Math.sin(phase));
  const plane =
    WAVES.plane.amplitude *
    Math.cos(WAVES.plane.vector[0] * x + WAVES.plane.vector[1] * z - waveSpeed(Math.hypot(...WAVES.plane.vector)) * t);
  return new THREE.Vector3(
    (-slope * dx) / r - plane * WAVES.plane.vector[0],
    1,
    (-slope * dz) / r - plane * WAVES.plane.vector[1],
  ).normalize();
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

// Rings of raindrops on the surface (rain.ts): in each cell of a jittered grid a drop lands once
// a period, at a random time and spot, and its ring runs outward and fades. Two offset grids.
// Only the reflection's normal takes them; the views through the water keep WAVE_NORMAL.
export const RAIN_RIPPLES = { cell: 0.22, period: 1.1, radius: 0.5, wavelength: 0.06, slope: 0.14 };
export const RAIN_RIPPLE_GLSL = /* glsl */ `
vec3 suiRainHash( vec2 cell ) {
	vec3 p = fract( vec3( cell.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
	p += dot( p, p.yxz + 33.33 );
	return fract( ( p.xxy + p.yzz ) * p.zyx );
}
// The slope (height gradient over xz, in meters per meter) of the rings at world xz, time t.
vec2 suiRainRipples( vec2 xz, float t ) {
	vec2 gradient = vec2( 0.0 );
	for ( int layer = 0; layer < 2; layer ++ ) {
		vec2 p = xz / ${f(RAIN_RIPPLES.cell)} + float( layer ) * vec2( 0.37, 0.71 );
		vec2 base = floor( p );
		for ( int j = - 1; j <= 1; j ++ ) for ( int i = - 1; i <= 1; i ++ ) {
			vec2 cell = base + vec2( i, j );
			vec3 h = suiRainHash( cell + float( layer ) * 57.0 );
			float age = fract( t / ${f(RAIN_RIPPLES.period)} + h.z );
			vec2 offset = p - cell - h.xy;
			float r = length( offset );
			float d = r - age * ${f(RAIN_RIPPLES.radius / RAIN_RIPPLES.cell)};
			float ring = cos( d * ${f((2 * Math.PI * RAIN_RIPPLES.cell) / RAIN_RIPPLES.wavelength)} ) * exp( - d * d * 40.0 ) * ( 1.0 - age ) * ( 1.0 - age );
			gradient += ring * offset / max( r, 1e-3 );
		}
	}
	return gradient * ${f(RAIN_RIPPLES.slope)};
}
`;

/** Top of the coping around the water on all four sides, glTF y. */
export const RIM_HEIGHT = 1.035;

// How far the mirror image is looked up along the rippled reflection ray, in meters: the distance
// to the coping where the ray meets it, else MIRROR_DISTANCE for what stands beyond it. This sets
// how far the waves displace the image. A fixed 0.6 m moved the image of the coping and the black
// spout trough, 0.1–0.3 m from the water by the far wall, up to six times too far: the spout's
// ripples drew them as sharp dark rings and teeth along the waterline.
export const MIRROR_DISTANCE = 0.6;
const MIRROR_NEAREST = 0.03;
/**
 * Not in the source (a still mirror with a faint bump): the plunge is stirred by the spout, so what
 * stands far beyond the water smears along the view's vertical. The mirror is read over `taps`
 * points up to `reach` of its height above and below (Gaussian, `across` of that sideways), by
 * the ray's share of MIRROR_DISTANCE: the coping's image at the waterline stays sharp. Read sharp,
 * the lounge fill's image ended at the coping's in a hard edge toothed by the frozen ripples, a
 * cream triangle laid on the tiles at dusk and night (docs/3d-qa/graphic-followup-20261028/).
 */
export const MIRROR_RIPPLE = { reach: 0.015, across: 0.2, taps: 13 };

/** The ripple blur's reads: offsets in units of its reach and weights summing to 1. */
export function rippleTaps() {
  const n = MIRROR_RIPPLE.taps;
  const taps = Array.from({ length: n }, (_, i) => {
    const t = (2 * i) / (n - 1) - 1;
    // Alternating sideways, so the streak is not a single column.
    return { x: (i % 2 ? 1 : -1) * MIRROR_RIPPLE.across * (1 - Math.abs(t)), y: t, w: Math.exp(-2 * t * t) };
  });
  const total = taps.reduce((sum, tap) => sum + tap.w, 0);
  return taps.map((tap) => ({ ...tap, w: tap.w / total }));
}

// A bounded surface avoids rings crossing the pool coping. No fluid simulation.
// `probes` are the shared probe uniforms (reflection.ts), filled before the first frame; `mirror`
// is the planar reflection (planarReflection.ts), used while it holds this frame's image.
export function createWaterEffects(
  definition: WaterDefinition,
  probes: IrradianceUniforms,
  mirror: PlanarReflectionUniforms,
  time = { value: 0 },
) {
  const group = new THREE.Group();
  const rain = { value: 0 };
  // The surface spans the tub between the coping's inner faces.
  const [width, depth] = definition.size;
  const poolMin = [definition.center[0] - width / 2, definition.center[2] - depth / 2];
  const poolMax = [definition.center[0] + width / 2, definition.center[2] + depth / 2];
  const glslVec2 = ([x, z]: number[]) => `vec2(${x.toFixed(4)}, ${z.toFixed(4)})`;
  // The source water is clear (transmission 1, IOR 1.333, absorption density 0.12), so the teal
  // tiles below stay visible. Only the Fresnel reflection is blended over: the mirror image, or
  // the reflection probes (roughness 0.018 of the source) when there is none.
  const water = new THREE.ShaderMaterial({
    defines: { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: { ...probes, ...mirror, time, suiRain: rain },
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
      ${RAIN_RIPPLE_GLSL}
      uniform float time; uniform float suiRain; uniform sampler2D suiMirror; uniform mat4 suiMirrorMatrix; uniform vec2 suiMirrorLimit; uniform float suiMirrorAmount;
      varying vec3 vWorld;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 normal = suiWaveNormal(vWorld.xz, time);
        if (suiRain > 0.0) {
          vec2 rings = suiRainRipples(vWorld.xz, time) * suiRain;
          normal = normalize(normal + vec3(-rings.x, 0.0, -rings.y));
        }
        if (view.y < 0.0) normal = -normal;
        float facing = clamp(dot(normal, view), 0.0, 1.0);
        // Schlick's approximation for water (F0 = 0.02).
        float fresnel = 0.02 + 0.98 * pow(1.0 - facing, 5.0);
        vec3 direction = reflect(-view, normal);
        vec3 color = suiReflection(vWorld + normal * 0.02, normal, direction, 0.018, false, false);
        if (suiMirrorAmount > 0.0) {
          // The flat mirror's ray through this point projects onto it; the rippled one is displaced
          // by as much as the surface it meets is far.
          vec2 wall = mix(${glslVec2(poolMin)}, ${glslVec2(poolMax)}, step(0.0, direction.xz));
          vec2 across = abs(wall - vWorld.xz) / max(abs(direction.xz), vec2(1e-4));
          float reach = min(across.x, across.y);
          reach = vWorld.y + direction.y * reach < ${RIM_HEIGHT.toFixed(3)}
            ? clamp(reach, ${MIRROR_NEAREST.toFixed(2)}, ${MIRROR_DISTANCE.toFixed(2)}) : ${MIRROR_DISTANCE.toFixed(2)};
          vec4 image = suiMirrorMatrix * vec4(vWorld + direction * reach, 1.0);
          // MIRROR_RIPPLE: smeared vertically by as much as the ray reaches past the coping.
          vec2 mirrorAt = image.xy / image.w;
          vec2 smear = vec2(${MIRROR_RIPPLE.reach.toFixed(4)}) * vec2(float(textureSize(suiMirror, 0).y) / float(textureSize(suiMirror, 0).x), 1.0)
            * smoothstep(${MIRROR_NEAREST.toFixed(2)}, ${MIRROR_DISTANCE.toFixed(2)}, reach);
          vec3 mirrored = vec3(0.0);
${rippleTaps()
  .map(
    ({
      x,
      y,
      w,
    }) => `          mirrored += ${w.toFixed(5)} * texture2D(suiMirror, clamp(mirrorAt + smear * vec2(${x.toFixed(4)}, ${y.toFixed(4)}), vec2(0.0), suiMirrorLimit)).rgb;
`,
  )
  .join('')}          color = mix(color, mirrored, suiMirrorAmount);
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
  // The spout's falling sheet, its foam and drops (waterSpout.ts).
  const spout = createSpoutWater(definition.spout[0], definition.center[1], probes, time);
  group.add(spout.sheet, ...spout.mainOnly);
  return {
    group,
    surface,
    /** The foam and drops at the spout's foot, for the main camera only. */
    mainOnly: spout.mainOnly,
    /** The waves' time in seconds (0 with reduced motion), shared with the underwater views. */
    time,
    /** `rainAmount` is the rain's share (lighting.ts), which sets the rings of its drops. */
    update: (seconds: number, reducedMotion: boolean, rainAmount = 0) => {
      time.value = reducedMotion ? 0 : seconds;
      rain.value = rainAmount;
      spout.update(reducedMotion);
    },
  };
}
