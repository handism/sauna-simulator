import * as THREE from 'three';
import { FBM_GLSL } from './noiseColor';

// The source fakes the light patterns under the water with emission on the tiles and the inner
// walls ("V10 | submerged light" materials): the edges of a Voronoi pattern (scale 5.2, distance
// to edge, the position warped by 0.2 × a noise color of scale 3.6) mapped 0.008..0.065 →
// 0.28..0, times an irregular visibility (noise of scale 1.7 and detail 3 mapped 0.3..0.7 →
// 0.04..0.48), inside a box below the waterline, with the color (0.46, 0.77, 0.66). At blue hour
// most of what Cycles shows under the water is this light; the exporter drops the linked
// emission strength. The node values are the source's (scripts/blender_caustic_reference.py
// evaluates those nodes in Blender for e2e/caustics.e2e.ts). Light that the emission casts on
// other surfaces is already in the probes. The pattern is static, as in the source.

const PREFIX = 'V10 | submerged light';
export const CAUSTIC_COLOR = [0.46, 0.77, 0.66] as const;

const COMMON_INCLUDE = '#include <common>';
const MAIN = 'void main() {';
const PROJECT_INCLUDE = '#include <project_vertex>';
const EMISSIVE_INCLUDE = '#include <emissivemap_fragment>';

// Blender's float hashes (Jenkins lookup3 on the float bits). Needs FBM_GLSL before it (sui_rot).
export const BLENDER_HASH_GLSL = /* glsl */ `
void sui_final( inout uint a, inout uint b, inout uint c ) {
	c ^= b; c -= sui_rot( b, 14u ); a ^= c; a -= sui_rot( c, 11u );
	b ^= a; b -= sui_rot( a, 25u ); c ^= b; c -= sui_rot( b, 16u );
	a ^= c; a -= sui_rot( c, 4u ); b ^= a; b -= sui_rot( a, 14u );
	c ^= b; c -= sui_rot( b, 24u );
}
float sui_hash2f( vec2 k ) {
	uvec2 u = floatBitsToUint( k );
	uint a = 0xdeadbeefu + 21u, b = a, c = a;
	b += u.y; a += u.x;
	sui_final( a, b, c );
	return float( c ) / float( 0xFFFFFFFFu );
}
float sui_hash3f( vec3 k ) {
	uvec3 u = floatBitsToUint( k );
	uint a = 0xdeadbeefu + 25u, b = a, c = a;
	c += u.z; b += u.y; a += u.x;
	sui_final( a, b, c );
	return float( c ) / float( 0xFFFFFFFFu );
}
float sui_hash4f( vec4 k ) {
	uvec4 u = floatBitsToUint( k );
	uint a = 0xdeadbeefu + 29u, b = a, c = a;
	a += u.x; b += u.y; c += u.z;
	a -= c; a ^= sui_rot( c, 4u ); c += b;
	b -= a; b ^= sui_rot( a, 6u ); a += c;
	c -= b; c ^= sui_rot( b, 8u ); b += a;
	a -= c; a ^= sui_rot( c, 16u ); c += b;
	b -= a; b ^= sui_rot( a, 19u ); a += c;
	c -= b; c ^= sui_rot( b, 4u ); b += a;
	a += u.w;
	sui_final( a, b, c );
	return float( c ) / float( 0xFFFFFFFFu );
}
vec3 sui_hash3v( vec3 k ) {
	return vec3( sui_hash3f( k ), sui_hash4f( vec4( k, 1.0 ) ), sui_hash4f( vec4( k, 2.0 ) ) );
}
`;

const rot = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
function final(a: number, b: number, c: number) {
  c = ((c ^ b) - rot(b, 14)) >>> 0;
  a = ((a ^ c) - rot(c, 11)) >>> 0;
  b = ((b ^ a) - rot(a, 25)) >>> 0;
  c = ((c ^ b) - rot(b, 16)) >>> 0;
  a = ((a ^ c) - rot(c, 4)) >>> 0;
  b = ((b ^ a) - rot(a, 14)) >>> 0;
  return ((c ^ b) - rot(b, 24)) >>> 0;
}
const bits = new Uint32Array(1);
const floats = new Float32Array(bits.buffer);
const floatBits = (v: number) => ((floats[0] = v), bits[0]);
// float( c ) / float( 0xFFFFFFFFu ) in float32: the divisor rounds to 2³².
const unit = (c: number) => Math.fround(Math.fround(c) / 4294967296);
function hash3f(x: number, y: number, z: number) {
  const seed = (0xdeadbeef + 25) >>> 0;
  return unit(final((seed + floatBits(x)) >>> 0, (seed + floatBits(y)) >>> 0, (seed + floatBits(z)) >>> 0));
}
function hash4f(x: number, y: number, z: number, w: number) {
  let a = (0xdeadbeef + 29 + floatBits(x)) >>> 0;
  let b = (0xdeadbeef + 29 + floatBits(y)) >>> 0;
  let c = (0xdeadbeef + 29 + floatBits(z)) >>> 0;
  a = ((a - c) >>> 0) ^ rot(c, 4);
  c = (c + b) >>> 0;
  b = ((b - a) >>> 0) ^ rot(a, 6);
  a = (a + c) >>> 0;
  c = ((c - b) >>> 0) ^ rot(b, 8);
  b = (b + a) >>> 0;
  a = ((a - c) >>> 0) ^ rot(c, 16);
  c = (c + b) >>> 0;
  b = ((b - a) >>> 0) ^ rot(a, 19);
  a = (a + c) >>> 0;
  c = ((c - b) >>> 0) ^ rot(b, 4);
  b = (b + a) >>> 0;
  a = (a + floatBits(w)) >>> 0;
  return unit(final(a >>> 0, b >>> 0, c >>> 0));
}
/** sui_hash3v of BLENDER_HASH_GLSL: a Voronoi cell's feature point (randomness 1). */
export const hash3v = (x: number, y: number, z: number) => [hash3f(x, y, z), hash4f(x, y, z, 1), hash4f(x, y, z, 2)];

// The pattern is static, so the Voronoi cells it can reach keep their feature points in a small
// float texture instead of three Jenkins hashes per cell per pixel, twice over the 27 neighbours
// (most of the caustics' cost). Those cells: the box of sui_caustic_strength (below the
// submerged materials, which start 0.18 m up in Blender z, down to −0.5 m), warped by 0.2 × a noise
// color in [0, 1] (a margin of 0.05 m around it), at scale 5.2 with one neighbour on each side.
const CAUSTIC_BOX = { min: [-0.17, 0.89, -0.5], max: [2.53, 4.11, 0.755] };
const VORONOI_SCALE = 5.2;
export const CELLS = (() => {
  const min = CAUSTIC_BOX.min.map((v) => Math.floor((v - 0.05) * VORONOI_SCALE) - 1);
  const max = CAUSTIC_BOX.max.map((v) => Math.floor((v + 0.25) * VORONOI_SCALE) + 1);
  return { min, size: max.map((v, i) => v - min[i] + 1) };
})();

/** The feature points of CELLS, for SUI_CAUSTIC_CELLS (RGBA float, one texel per cell). */
export function causticCells() {
  const [nx, ny, nz] = CELLS.size;
  const data = new Float32Array(nx * ny * nz * 4);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++)
        data.set(hash3v(x + CELLS.min[0], y + CELLS.min[1], z + CELLS.min[2]), ((z * ny + y) * nx + x) * 4);
  const texture = new THREE.Data3DTexture(data, nx, ny, nz);
  texture.type = THREE.FloatType;
  texture.format = THREE.RGBAFormat;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// Blender's 3D Voronoi distance to edge with randomness 1, in the order of Blender's loops. The
// noise color adds two more FBM channels at Blender's fixed random offsets. Needs FBM_GLSL before it.
export const CAUSTIC_GLSL = /* glsl */ `${BLENDER_HASH_GLSL}
vec3 sui_random_offset( float seed ) {
	return 100.0 + 100.0 * vec3( sui_hash2f( vec2( seed, 0.0 ) ), sui_hash2f( vec2( seed, 1.0 ) ), sui_hash2f( vec2( seed, 2.0 ) ) );
}
vec3 sui_noise_color( vec3 p, float detail, float footprint ) {
	return vec3(
		sui_fbm( p, detail, 0.5, 2.0, footprint ),
		sui_fbm( p + sui_random_offset( 3.0 ), detail, 0.5, 2.0, footprint ),
		sui_fbm( p + sui_random_offset( 4.0 ), detail, 0.5, 2.0, footprint ) );
}
#ifdef SUI_CAUSTIC_CELLS
uniform highp sampler3D suiCausticCells;
// The feature point of a cell the caustics can reach, kept by causticCells().
vec3 sui_cell_point( vec3 cell ) {
	return texelFetch( suiCausticCells, ivec3( cell ) - ivec3( ${CELLS.min.join(', ')} ), 0 ).xyz;
}
#else
vec3 sui_cell_point( vec3 cell ) { return sui_hash3v( cell ); }
#endif
float sui_voronoi_edge( vec3 coord ) {
	vec3 cellPosition = floor( coord );
	vec3 localPosition = coord - cellPosition;
	vec3 vectorToClosest = vec3( 0.0 );
	float minDistance = 3.4e38;
	for ( int k = - 1; k <= 1; k ++ ) for ( int j = - 1; j <= 1; j ++ ) for ( int i = - 1; i <= 1; i ++ ) {
		vec3 cellOffset = vec3( i, j, k );
		vec3 vectorToPoint = cellOffset + sui_cell_point( cellPosition + cellOffset ) - localPosition;
		float distanceToPoint = dot( vectorToPoint, vectorToPoint );
		if ( distanceToPoint < minDistance ) {
			minDistance = distanceToPoint;
			vectorToClosest = vectorToPoint;
		}
	}
	minDistance = 3.4e38;
	for ( int k = - 1; k <= 1; k ++ ) for ( int j = - 1; j <= 1; j ++ ) for ( int i = - 1; i <= 1; i ++ ) {
		vec3 cellOffset = vec3( i, j, k );
		vec3 vectorToPoint = cellOffset + sui_cell_point( cellPosition + cellOffset ) - localPosition;
		vec3 perpendicularToEdge = vectorToPoint - vectorToClosest;
		if ( dot( perpendicularToEdge, perpendicularToEdge ) > 0.0001 )
			minDistance = min( minDistance, dot( ( vectorToClosest + vectorToPoint ) / 2.0, normalize( perpendicularToEdge ) ) );
	}
	return minDistance;
}
// Integral of the clamped ramp 1 → 0 over 0.008..0.065, to box-filter the thin edges over a pixel.
float sui_edge_integral( float x ) {
	float a = 0.008, b = 0.065;
	if ( x < a ) return x;
	if ( x > b ) return 0.5 * ( a + b );
	float t = ( b - x ) / ( b - a );
	return a + 0.5 * ( b - a ) * ( 1.0 - t * t );
}
// p in Blender world axes (z up); footprint > 0 filters the pattern over a pixel.
float sui_caustic_strength( vec3 p, float footprint ) {
	if ( p.x <= - 0.17 || p.x >= 2.53 || p.y <= 0.89 || p.y >= 4.11 || p.z <= - 0.5 || p.z >= 0.755 ) return 0.0;
	vec3 warp = p + 0.2 * sui_noise_color( p * 3.6, 2.0, footprint * 3.6 );
	float edge = sui_voronoi_edge( warp * 5.2 );
	float width = footprint > 0.0 ? footprint * 5.2 : 0.0;
	float lines = width > 1e-4
		? ( sui_edge_integral( edge + 0.5 * width ) - sui_edge_integral( edge - 0.5 * width ) ) / width
		: clamp( ( 0.065 - edge ) / 0.057, 0.0, 1.0 );
	float visibility = mix( 0.04, 0.48, clamp( ( sui_fbm( p * 1.7, 3.0, 0.5, 2.0, footprint * 1.7 ) - 0.3 ) / 0.4, 0.0, 1.0 ) );
	return 0.28 * lines * visibility;
}
`;

const FRAGMENT = /* glsl */ `
	vec3 suiCausticPoint = vec3( vSuiCausticPosition.x, - vSuiCausticPosition.z, vSuiCausticPosition.y );
	float suiCausticFootprint = max( length( dFdx( suiCausticPoint ) ), length( dFdy( suiCausticPoint ) ) );
	totalEmissiveRadiance += vec3( ${CAUSTIC_COLOR.map((c) => c.toFixed(2)).join(', ')} ) * sui_caustic_strength( suiCausticPoint, suiCausticFootprint );`;

export const isCausticMaterial = (material: THREE.Material): material is THREE.MeshStandardMaterial =>
  material instanceof THREE.MeshStandardMaterial && material.name.startsWith(PREFIX);

/** `cells` (causticCells()) replaces the hashes of the Voronoi cells. */
export function patchCausticShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms?: Record<string, THREE.IUniform> },
  cells?: THREE.Data3DTexture,
) {
  const { vertexShader, fragmentShader } = shader;
  if (
    !vertexShader.includes(COMMON_INCLUDE) ||
    !vertexShader.includes(PROJECT_INCLUDE) ||
    !fragmentShader.includes(MAIN) ||
    !fragmentShader.includes(EMISSIVE_INCLUDE)
  )
    throw Error('Unsupported three.js shader chunks for caustics');
  shader.vertexShader = vertexShader
    .replace(COMMON_INCLUDE, `${COMMON_INCLUDE}\nvarying vec3 vSuiCausticPosition;`)
    .replace(
      PROJECT_INCLUDE,
      `${PROJECT_INCLUDE}\n\tvSuiCausticPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
    );
  // After every earlier addition; a noise color patch may already have defined the FBM.
  const fbm = fragmentShader.includes('float sui_fbm(') ? '' : FBM_GLSL;
  shader.fragmentShader = fragmentShader
    .replace(
      MAIN,
      `varying vec3 vSuiCausticPosition;\n${cells ? '#define SUI_CAUSTIC_CELLS\n' : ''}${fbm}${CAUSTIC_GLSL}\n${MAIN}`,
    )
    .replace(EMISSIVE_INCLUDE, `${EMISSIVE_INCLUDE}${FRAGMENT}`);
  if (cells && shader.uniforms) shader.uniforms.suiCausticCells = { value: cells };
}

/** Adds the source's fake caustics to the submerged materials (composes with earlier hooks). */
export function applyCaustics(root: THREE.Object3D): number {
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (isCausticMaterial(material)) materials.add(material);
  });
  if (!materials.size) return 0;
  // Shared by the materials and freed with them.
  const cells = causticCells();
  for (const material of materials) {
    material.addEventListener('dispose', () => cells.dispose());
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      patchCausticShader(shader, cells);
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}|caustics`;
    material.needsUpdate = true;
  }
  return materials.size;
}
