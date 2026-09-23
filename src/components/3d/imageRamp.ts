import * as THREE from 'three';
import { RAMP_GLSL, NOISE_COLOR_MAX_STOPS, rampUniform, validRampStops, type RampStop } from './noiseColor';

// Base colors that Blender derives from an image: RGB to BW -> linear Color Ramp,
// multiplied by a ramp of Object Info Random and optionally mixed toward a flat
// color (stone, linen, timber). The exporter records the node values in the glTF
// material extras and the per-object random value in COLOR_0; colors are linear.
export interface ImageRamp {
  luminance: [number, number, number];
  stops: RampStop[];
  random: RampStop[];
  mix: { factor: number; color: [number, number, number] } | null;
}

const COMMON_INCLUDE = '#include <common>';
const MAP_INCLUDE = '#include <map_fragment>';
const COLOR_INCLUDE = '#include <color_fragment>';

const FRAGMENT_PARS = `
uniform vec3 suiRampLuminance;
uniform vec4 suiRampStops[ ${NOISE_COLOR_MAX_STOPS} ];
uniform int suiRampStopCount;
uniform vec4 suiRandomStops[ ${NOISE_COLOR_MAX_STOPS} ];
uniform int suiRandomStopCount;
uniform vec4 suiRampMix;
${RAMP_GLSL}`;

// map_fragment leaves the decoded texel in sampledDiffuseColor; vColor.r is the object's random value.
const FRAGMENT_COLOR = `
	vec3 suiRampColor = sui_ramp( dot( sampledDiffuseColor.rgb, suiRampLuminance ), suiRampStops, suiRampStopCount )
		* sui_ramp( vColor.r, suiRandomStops, suiRandomStopCount );
	diffuseColor.rgb = mix( suiRampColor, suiRampMix.rgb, suiRampMix.a );`;

const color3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export function imageRampOf(material: THREE.Material): ImageRamp | null {
  if (!(material instanceof THREE.MeshStandardMaterial)) return null;
  const value = material.userData.suiImageRamp as ImageRamp | undefined;
  if (!value) return null;
  const mix = value.mix === null || (value.mix && Number.isFinite(value.mix.factor) && color3(value.mix.color));
  if (!color3(value.luminance) || !validRampStops(value.stops) || !validRampStops(value.random) || !mix) {
    throw Error(`Unsupported image ramp on ${material.name}`);
  }
  return value;
}

export function patchImageRampShader(shader: { fragmentShader: string }) {
  const { fragmentShader } = shader;
  if (
    !fragmentShader.includes(COMMON_INCLUDE) ||
    !fragmentShader.includes(MAP_INCLUDE) ||
    !fragmentShader.includes(COLOR_INCLUDE) ||
    fragmentShader.indexOf(MAP_INCLUDE) > fragmentShader.indexOf(COLOR_INCLUDE)
  ) {
    throw Error('Unsupported three.js shader chunks for image ramp');
  }
  shader.fragmentShader = fragmentShader
    .replace(COMMON_INCLUDE, `${COMMON_INCLUDE}${FRAGMENT_PARS}`)
    .replace(COLOR_INCLUDE, `${COLOR_INCLUDE}${FRAGMENT_COLOR}`);
}

// Needs the base color texture and the exported per-object vertex color.
export function applyImageRamp(material: THREE.MeshStandardMaterial, ramp: ImageRamp) {
  if (!material.map || !material.vertexColors)
    throw Error(`Image ramp needs a map and vertex colors on ${material.name}`);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      suiRampLuminance: { value: new THREE.Vector3(...ramp.luminance) },
      suiRampStops: { value: rampUniform(ramp.stops) },
      suiRampStopCount: { value: ramp.stops.length },
      suiRandomStops: { value: rampUniform(ramp.random) },
      suiRandomStopCount: { value: ramp.random.length },
      // Vector4 defaults w to 1, which would mix fully toward black.
      suiRampMix: {
        value: ramp.mix ? new THREE.Vector4(...ramp.mix.color, ramp.mix.factor) : new THREE.Vector4(0, 0, 0, 0),
      },
    });
    patchImageRampShader(shader);
  };
  material.customProgramCacheKey = () => `${previousKey.call(material)}|image-ramp`;
  material.needsUpdate = true;
}
