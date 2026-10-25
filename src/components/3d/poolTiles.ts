import * as THREE from 'three';

// The plunge's floor tiles. The source material is one flat teal (0.12, 0.32, 0.28) on every tile, so
// the floor read as an even, brightly lit swimming-pool grid. Glazed tiles vary: each tile gets its
// own tone (on average 15% darker than the source, then muted, TILE_SATURATION) and a slight hue shift, the glaze pools a little darker toward the tile's edges, and a soft mottle runs
// through it; the roughness varies a little from tile to tile. The grid (separate tiles with 8 mm
// joints between them) is the source's, read from the exported tiles' corners. Within 35 cm of the
// tub's walls the floor darkens (no baked occlusion reaches the tiles' color there). No texture: the
// floor's materials already use all 16 texture units (waterBottom.ts, caustics.ts).

export const TILE_MATERIAL = 'V10 | submerged light / Teal glazed pool tile';
/** The first tile's outer corner (x, z) and the pitch of the grid (m), from the exported tiles. */
export const TILE_GRID = { origin: [-0.169, -4.067], pitch: [0.2045, 0.1998] } as const;
/** The far corner (x, z) of the tiled floor: 13 × 16 tiles. */
export const TILE_BOUNDS = [
  TILE_GRID.origin[0] + 13 * TILE_GRID.pitch[0],
  TILE_GRID.origin[1] + 16 * TILE_GRID.pitch[1],
];

/**
 * Not in the source: the glaze's saturation and brightness, and how wide (m) and how dark the glaze
 * pools along each tile's edge. Even after the tones and the water's absorption, the bright teal
 * tiles with a dark band of pooled glaze on every edge drew a bold grid and still read as a swimming
 * pool; a plunge's glaze is a quieter green-grey and the joints a fine line.
 */
export const TILE_SATURATION = 0.62;
export const TILE_DARKEN = 0.86;
export const TILE_POOL_WIDTH = 0.013;
export const TILE_POOL_SHADE = 0.84;

const f = (value: number) => value.toFixed(4);
const COMMON = '#include <common>';
const PROJECT = '#include <project_vertex>';
const COLOR = '#include <color_fragment>';
const ROUGHNESS = '#include <roughnessmap_fragment>';

const PARS = /* glsl */ `
varying vec3 vSuiTilePosition;
float suiTileHash( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}
float suiTileNoise( vec2 p ) {
	vec2 cell = floor( p ), t = fract( p );
	t = t * t * ( 3.0 - 2.0 * t );
	return mix( mix( suiTileHash( cell ), suiTileHash( cell + vec2( 1.0, 0.0 ) ), t.x ),
		mix( suiTileHash( cell + vec2( 0.0, 1.0 ) ), suiTileHash( cell + vec2( 1.0, 1.0 ) ), t.x ), t.y );
}
`;

// After the base color; the place in the grid gives the tile.
const GLAZE = /* glsl */ `
	vec2 suiTileCell = ( vSuiTilePosition.xz - vec2( ${f(TILE_GRID.origin[0])}, ${f(TILE_GRID.origin[1])} ) ) / vec2( ${f(TILE_GRID.pitch[0])}, ${f(TILE_GRID.pitch[1])} );
	vec2 suiTileId = floor( suiTileCell );
	float suiTileTone = suiTileHash( suiTileId );
	float suiTileHue = suiTileHash( suiTileId + 17.0 );
	// Distance to the tile's edge in meters; the glaze pools within about 2 cm of it.
	vec2 suiTileEdge = min( fract( suiTileCell ), 1.0 - fract( suiTileCell ) ) * vec2( ${f(TILE_GRID.pitch[0])}, ${f(TILE_GRID.pitch[1])} );
	float suiTilePool = 1.0 - smoothstep( 0.002, ${f(TILE_POOL_WIDTH)}, min( suiTileEdge.x, suiTileEdge.y ) );
	vec2 suiTileMottleP = vSuiTilePosition.xz * 26.0 + suiTileId * 3.7;
	float suiTileMottle = mix( suiTileNoise( suiTileMottleP ), 0.5, smoothstep( 0.4, 1.2, fwidth( suiTileMottleP.x ) ) );
	// Toward the tub's walls less of the sky above reaches the floor.
	vec2 suiTileWall = min( vSuiTilePosition.xz - vec2( ${f(TILE_GRID.origin[0])}, ${f(TILE_GRID.origin[1])} ), vec2( ${f(TILE_BOUNDS[0])}, ${f(TILE_BOUNDS[1])} ) - vSuiTilePosition.xz );
	float suiTileCorner = mix( 0.62, 1.0, smoothstep( 0.0, 0.35, suiTileWall.x ) * smoothstep( 0.0, 0.35, suiTileWall.y ) );
	diffuseColor.rgb *= ( 0.68 + 0.34 * suiTileTone ) * mix( vec3( 1.1, 1.0, 0.88 ), vec3( 0.88, 1.0, 1.1 ), suiTileHue )
		* mix( 1.0, ${f(TILE_POOL_SHADE)}, suiTilePool ) * ( 0.88 + 0.24 * suiTileMottle ) * suiTileCorner;
	// A muted, deeper green-grey glaze instead of the pool's bright teal.
	diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, ${f(TILE_SATURATION)} ) * ${f(TILE_DARKEN)};
`;

export function patchPoolTileShader(shader: { vertexShader: string; fragmentShader: string }) {
  if (
    !shader.vertexShader.includes(COMMON) ||
    !shader.vertexShader.includes(PROJECT) ||
    !shader.fragmentShader.includes(COLOR) ||
    !shader.fragmentShader.includes(ROUGHNESS)
  )
    throw Error('Unsupported three.js shader chunks for pool tiles');
  shader.vertexShader = shader.vertexShader
    .replace(COMMON, `${COMMON}\nvarying vec3 vSuiTilePosition;`)
    // The true position: refraction.ts moves only gl_Position, after this.
    .replace(PROJECT, `${PROJECT}\nvSuiTilePosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace(COMMON, `${COMMON}\n${PARS}`)
    .replace(COLOR, `${COLOR}\n${GLAZE}`)
    .replace(
      ROUGHNESS,
      `${ROUGHNESS}\nroughnessFactor = clamp( roughnessFactor + ( suiTileTone - 0.5 ) * 0.12, 0.05, 1.0 );`,
    );
}

/** Lets the plunge's floor tiles under `root` vary as glazed tiles do. Returns the materials patched. */
export function applyPoolTiles(root: THREE.Object3D): number {
  const materials = new Set<THREE.MeshStandardMaterial>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (
        material instanceof THREE.MeshStandardMaterial &&
        material.name === TILE_MATERIAL &&
        !material.userData.suiPoolTiles
      )
        materials.add(material);
  });
  for (const material of materials) {
    material.userData.suiPoolTiles = true;
    const previous = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      patchPoolTileShader(shader);
    };
    material.customProgramCacheKey = () => `${previousKey.call(material)}|pool-tiles`;
    material.needsUpdate = true;
  }
  return materials.size;
}
