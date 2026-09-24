import * as THREE from 'three';
// Patches lights_fragment_begin first (suiWorldPosition, suiInterior).
import './interiorLights';

// Diffuse light that the browser does not draw itself, baked from the source Cycles scenes by
// scripts/bake_irradiance_probes.py: the sky, the area lights without a browser counterpart
// (Sky softbox, Sunlit courtyard, lanterns, ...) and every bounce of every light, with their
// occlusion. It replaces the unshadowed hemisphere light that stood in for all of it.
//
// Three L2 spherical-harmonic probe grids: the sauna room (0.5 m, used for fragments inside the
// room box only, so neither side leaks through the walls or the glass), the courtyard (1 m) and
// the surroundings (3 m), blended over the last 1.5 m of the courtyard grid. Day and blue-hour
// coefficients are mixed with the evening amount. three's own LightProbeGrid picks one grid per
// object, but the model's meshes are merged by material and span the room and the courtyard.

export const GRID_NAMES = ['room', 'courtyard', 'outer'] as const;
export const SCENES = ['day', 'evening'] as const;
/** 9 RGB coefficients packed into 7 RGBA texels (the last channel unused). */
const TEXELS = 7;
const COEFFICIENTS = 27;
/** Distance over which the courtyard grid fades into the outer one (m). */
export const COURTYARD_BLEND = 1.5;

export interface IrradianceGrid {
  name: (typeof GRID_NAMES)[number];
  min: [number, number, number];
  max: [number, number, number];
  resolution: [number, number, number];
  offset: Record<(typeof SCENES)[number], number>;
}

export interface IrradianceHeader {
  scenes: string[];
  grids: IrradianceGrid[];
}

export function createIrradianceUniforms() {
  return {
    suiIrradianceRoom: { value: null as THREE.Data3DTexture | null },
    suiIrradianceCourtyard: { value: null as THREE.Data3DTexture | null },
    suiIrradianceOuter: { value: null as THREE.Data3DTexture | null },
    suiIrradianceMin: { value: GRID_NAMES.map(() => new THREE.Vector3()) },
    suiIrradianceMax: { value: GRID_NAMES.map(() => new THREE.Vector3()) },
    suiIrradianceRes: { value: GRID_NAMES.map(() => new THREE.Vector3()) },
    /** 0 = Daylight, 1 = Blue hour. */
    suiIrradianceEvening: { value: 0 },
  };
}
export type IrradianceUniforms = ReturnType<typeof createIrradianceUniforms>;

const isTriple = (value: unknown, integer = false): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((v) => typeof v === 'number' && Number.isFinite(v) && (!integer || (Number.isInteger(v) && v >= 2)));

/**
 * One RGBA half-float 3D texture per grid. Along Z it stacks 14 sub-volumes (7 texels of the
 * day, then of the evening), each padded by a copy of its first and last slice so that the
 * linear filter never blends two sub-volumes (the atlas layout of three's LightProbeGrid).
 */
export function createIrradianceTextures(header: IrradianceHeader, buffer: ArrayBuffer) {
  const data = new Uint16Array(buffer);
  if (
    header.scenes?.join() !== SCENES.join() ||
    header.grids?.map((grid) => grid.name).join() !== GRID_NAMES.join() ||
    !header.grids.every(
      (grid) =>
        isTriple(grid.min) &&
        isTriple(grid.max) &&
        isTriple(grid.resolution, true) &&
        grid.min.every((v, i) => v < grid.max[i]) &&
        SCENES.every(
          (scene) =>
            Number.isInteger(grid.offset?.[scene]) &&
            grid.offset[scene] + grid.resolution.reduce((a, b) => a * b) * COEFFICIENTS <= data.length,
        ),
    ) ||
    buffer.byteLength !==
      2 * header.grids.reduce((sum, grid) => sum + 2 * grid.resolution.reduce((a, b) => a * b) * COEFFICIENTS, 0)
  )
    throw Error('irradiance');
  const textures = header.grids.map((grid) => {
    const [nx, ny, nz] = grid.resolution;
    const slices = nz + 2;
    const texels = new Uint16Array(nx * ny * slices * TEXELS * SCENES.length * 4);
    SCENES.forEach((scene, s) => {
      for (let iz = 0; iz < nz; iz++)
        for (let iy = 0; iy < ny; iy++)
          for (let ix = 0; ix < nx; ix++) {
            const source = grid.offset[scene] + ((iz * ny + iy) * nx + ix) * COEFFICIENTS;
            for (let t = 0; t < TEXELS; t++) {
              const base = (s * TEXELS + t) * slices;
              // The padding slices repeat the first and last data slice.
              for (const slice of [
                base + 1 + iz,
                ...(iz === 0 ? [base] : []),
                ...(iz === nz - 1 ? [base + nz + 1] : []),
              ]) {
                const target = ((slice * ny + iy) * nx + ix) * 4;
                for (let c = 0; c < 4; c++) {
                  const k = t * 4 + c;
                  texels[target + c] = k < COEFFICIENTS ? data[source + k] : 0;
                }
              }
            }
          }
    });
    const texture = new THREE.Data3DTexture(texels, nx, ny, slices * TEXELS * SCENES.length);
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.HalfFloatType;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  });
  return {
    textures,
    probes: header.grids.reduce((sum, grid) => sum + grid.resolution.reduce((a, b) => a * b), 0),
    apply(uniforms: IrradianceUniforms) {
      [uniforms.suiIrradianceRoom.value, uniforms.suiIrradianceCourtyard.value, uniforms.suiIrradianceOuter.value] =
        textures;
      header.grids.forEach((grid, i) => {
        uniforms.suiIrradianceMin.value[i].fromArray(grid.min);
        uniforms.suiIrradianceMax.value[i].fromArray(grid.max);
        uniforms.suiIrradianceRes.value[i].fromArray(grid.resolution);
      });
    },
    dispose() {
      for (const texture of textures) texture.dispose();
    },
  };
}

/** Lights every standard material of the model with the probes (composes with earlier hooks). */
export function applyIrradiance(root: THREE.Object3D, uniforms: IrradianceUniforms): number {
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (material instanceof THREE.MeshStandardMaterial) materials.add(material);
  });
  for (const material of materials) {
    const previous = material.onBeforeCompile;
    material.defines = { ...material.defines, SUI_IRRADIANCE: '' };
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
    };
    material.needsUpdate = true;
  }
  return materials.size;
}

// three's L2 evaluation (lightprobes_pars_fragment) over a padded sub-volume set, with a weight
// per band: (π, 2π/3, π/4) gives the irradiance of the stored radiance, (1, 1, 1) the radiance
// itself (reflection.ts scales bands 1 and 2 by its lobe).
export const IRRADIANCE_PARS = /* glsl */ `
#ifdef SUI_IRRADIANCE
uniform highp sampler3D suiIrradianceRoom;
uniform highp sampler3D suiIrradianceCourtyard;
uniform highp sampler3D suiIrradianceOuter;
uniform vec3 suiIrradianceMin[ 3 ];
uniform vec3 suiIrradianceMax[ 3 ];
uniform vec3 suiIrradianceRes[ 3 ];
uniform float suiIrradianceEvening;

vec3 suiEvaluateSH( const in highp sampler3D atlas, const in vec2 uv, const in float z, const in float first, const in float slices, const in vec3 n, const in vec3 band ) {
	float depth = ${(TEXELS * SCENES.length).toFixed(1)} * slices;
	vec4 s0 = textureLod( atlas, vec3( uv, ( z + first * slices ) / depth ), 0.0 );
	vec4 s1 = textureLod( atlas, vec3( uv, ( z + ( first + 1.0 ) * slices ) / depth ), 0.0 );
	vec4 s2 = textureLod( atlas, vec3( uv, ( z + ( first + 2.0 ) * slices ) / depth ), 0.0 );
	vec4 s3 = textureLod( atlas, vec3( uv, ( z + ( first + 3.0 ) * slices ) / depth ), 0.0 );
	vec4 s4 = textureLod( atlas, vec3( uv, ( z + ( first + 4.0 ) * slices ) / depth ), 0.0 );
	vec4 s5 = textureLod( atlas, vec3( uv, ( z + ( first + 5.0 ) * slices ) / depth ), 0.0 );
	vec4 s6 = textureLod( atlas, vec3( uv, ( z + ( first + 6.0 ) * slices ) / depth ), 0.0 );
	vec3 result = s0.xyz * ( 0.282095 * band.x );
	result += ( vec3( s0.w, s1.xy ) * n.y + vec3( s1.zw, s2.x ) * n.z + s2.yzw * n.x ) * ( 0.488603 * band.y );
	result += ( s3.xyz * ( 1.092548 * n.x * n.y ) + vec3( s3.w, s4.xy ) * ( 1.092548 * n.y * n.z ) + vec3( s4.zw, s5.x ) * ( 0.315392 * ( 3.0 * n.z * n.z - 1.0 ) ) + s5.yzw * ( 1.092548 * n.x * n.z ) + s6.xyz * ( 0.546274 * ( n.x * n.x - n.y * n.y ) ) ) * band.z;
	return max( result, vec3( 0.0 ) );
}

// Sampled half a probe spacing off the surface along N, as three's probe grid does; D is the
// direction the coefficients are evaluated in.
vec3 suiGridSH( const in highp sampler3D atlas, const in vec3 lo, const in vec3 hi, const in vec3 res, const in vec3 P, const in vec3 N, const in vec3 D, const in vec3 band ) {
	vec3 uvw = clamp( ( P + N * 0.5 * ( hi - lo ) / ( res - 1.0 ) - lo ) / ( hi - lo ), 0.0, 1.0 );
	uvw = ( uvw * ( res - 1.0 ) + 0.5 ) / res;
	float slices = res.z + 2.0;
	float z = uvw.z * res.z + 1.0;
	vec3 result = vec3( 0.0 );
	if ( suiIrradianceEvening < 1.0 ) result += ( 1.0 - suiIrradianceEvening ) * suiEvaluateSH( atlas, uvw.xy, z, 0.0, slices, D, band );
	if ( suiIrradianceEvening > 0.0 ) result += suiIrradianceEvening * suiEvaluateSH( atlas, uvw.xy, z, ${TEXELS.toFixed(1)}, slices, D, band );
	return result;
}

vec3 suiProbes( const in highp sampler3D room, const in highp sampler3D courtyard, const in highp sampler3D outer, const in vec3 P, const in vec3 N, const in vec3 D, const in vec3 band, const in bool interior ) {
	if ( interior ) return suiGridSH( room, suiIrradianceMin[ 0 ], suiIrradianceMax[ 0 ], suiIrradianceRes[ 0 ], P, N, D, band );
	vec3 lo = suiIrradianceMin[ 1 ];
	vec3 hi = suiIrradianceMax[ 1 ];
	vec2 inside = min( P.xz - lo.xz, hi.xz - P.xz );
	float weight = smoothstep( 0.0, ${COURTYARD_BLEND.toFixed(1)}, min( inside.x, inside.y ) ) * ( 1.0 - smoothstep( hi.y, hi.y + ${COURTYARD_BLEND.toFixed(1)}, P.y ) );
	vec3 result = vec3( 0.0 );
	if ( weight > 0.0 ) result += weight * suiGridSH( courtyard, lo, hi, suiIrradianceRes[ 1 ], P, N, D, band );
	if ( weight < 1.0 ) result += ( 1.0 - weight ) * suiGridSH( outer, suiIrradianceMin[ 2 ], suiIrradianceMax[ 2 ], suiIrradianceRes[ 2 ], P, N, D, band );
	return result;
}

vec3 suiIrradiance( const in vec3 P, const in vec3 N, const in bool interior ) {
	return suiProbes( suiIrradianceRoom, suiIrradianceCourtyard, suiIrradianceOuter, P, N, N, vec3( PI, 2.0 * PI / 3.0, PI / 4.0 ), interior );
}
#endif
`;

/** The probe line of lights_fragment_begin. */
export const IRRADIANCE_LINE = 'irradiance += suiIrradiance( suiWorldPosition, suiWorldNormal, suiInterior );';
const HEMI_START = '#if ( NUM_HEMI_LIGHTS > 0 )';

// three 0.186 is pinned; interiorLights.ts has already defined suiWorldPosition and suiInterior.
const begin = THREE.ShaderChunk.lights_fragment_begin;
if (!begin.includes(IRRADIANCE_LINE)) {
  const hemi = begin.indexOf(HEMI_START);
  if (
    !begin.includes('bool suiInterior') ||
    hemi < 0 ||
    !THREE.ShaderChunk.common.includes('transformNormalByInverseViewMatrix')
  )
    throw new Error('three lighting chunks changed; update irradiance.ts');
  THREE.ShaderChunk.lights_pars_begin += IRRADIANCE_PARS;
  THREE.ShaderChunk.lights_fragment_begin =
    begin.slice(0, hemi) +
    `#ifdef SUI_IRRADIANCE
	vec3 suiWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
	${IRRADIANCE_LINE}
#endif
	` +
    begin.slice(hemi);
}
