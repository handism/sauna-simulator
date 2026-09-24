import * as THREE from 'three';

// The Cycles sauna room is lit by six area lights that keep the same power in both source
// scenes. They are RectAreaLights here (a disk becomes the square of equal area) with the source
// radiance P / (π·A), the same watt-to-candela mapping as the spot lights (P/π on the axis).
//
// Only the Lambertian term is evaluated (the source lights are invisible to glossy rays), so none
// of the LTC lookup tables (about 300 KB) are needed. three's diffuse term approximates the
// horizon-clipped form factor by that of a sphere, (l² + z) / (l + 1), which over the camera 02
// view overstated the ceiling light by about 8% and the backrest wash by about 30%; the
// rectangle is instead clipped to the receiver's horizon and its form factor summed exactly.
//
// The lights cast no shadow, so each is scaled by its share of unoccluded light: the Cycles
// direct light over the unshadowed browser light, summed over the room pixels of camera 02 with
// that light alone (the benches and their light-shielding lips hide most of the strips). The
// room is bounded by cedar walls and glass that passes no direct light in Cycles, so these lights
// reach only fragments inside the room box, and the unshadowed hemisphere light (sky and bounce)
// is scaled there by INTERIOR_SKY.

/** The room's inner volume in glTF axes, to the glass planes on the entry and plunge sides. */
export const INTERIOR_BOX = new THREE.Box3(new THREE.Vector3(-6.15, 0, -4.59), new THREE.Vector3(-0.5, 3.36, -0.25));
/**
 * Share of the hemisphere light that reaches the room. With the interior lights off, the light
 * entering through the glass in Cycles (sky, courtyard and bounce, linear, camera 02) equals the
 * browser hemisphere at 0.66; this keeps that for the daytime hemisphere of 0.8.
 */
export const INTERIOR_SKY = 0.83;

// Blender name, W, linear color, location, local X and local Z (the light shines along -Z), size
// in meters ([width, height] for rectangles, [diameter] for disks, or [diameter, from, to] for a
// disk of which only the band from..to along local Y lies inside the room), and visible share.
type Source = [string, number, [number, number, number], number[], number[], number[], number[], number];
export const INTERIOR_SOURCES: Source[] = [
  ['Warm under-bench wash', 95, [1, 0.6, 0.3], [-3.6, 3.72, 0.85], [1, 0, 0], [0, 0, 1], [4.35, 0.1], 0.64],
  ['Warm under-bench wash.001', 95, [1, 0.6, 0.3], [-3.6, 2.87, 0.38], [1, 0, 0], [0, 0, 1], [4.35, 0.1], 0.63],
  ['Sauna ceiling soft amber', 85, [1, 0.67, 0.36], [-3.2, 2.7, 3.15], [1, 0, 0], [0, 0, 1], [3], 0.82],
  // Centered 0.21 m from the rear cedar boards (Blender y 4.51) and 0.48 m below the ceiling
  // boards (z 3.28); about 60% of the disk lies behind them and lights nothing in the room.
  ['Sauna wall wash', 48, [1, 0.57, 0.27], [-3.6, 4.3, 2.8], [-1, 0, 0], [0, 0.6805, 0.7328], [3, -0.287, 0.705], 0.94],
  [
    'Steam soft backlight',
    85,
    [1, 0.8, 0.56],
    [-0.72, 2.15, 2.85],
    [-0.7766, 0.6299, 0],
    [0.4769, 0.588, 0.6533],
    [0.8],
    0.74,
  ],
  [
    'V7 concealed backrest wash',
    16,
    [1, 0.57, 0.26],
    [-3.6, 4.44, 1.5],
    [1, 0, 0],
    [0, -0.249, -0.9685],
    [4.35, 0.16],
    0.76,
  ],
];

const gltf = ([x, y, z]: number[]) => new THREE.Vector3(x, z, -y);

/** Area of the disk of radius r between chords at local y = a and b. */
export function diskBandArea(r: number, a: number, b: number): number {
  const f = (y: number) => y * Math.sqrt(r * r - y * y) + r * r * Math.asin(y / r);
  return f(b) - f(a);
}

/** The rectangle (width, height, offset along local Y) of equal area and the radiance P/(π·A). */
export function sourceRect([, watts, , , , , size]: Source): {
  width: number;
  height: number;
  offset: number;
  radiance: number;
} {
  if (size.length === 2)
    return { width: size[0], height: size[1], offset: 0, radiance: watts / (Math.PI * size[0] * size[1]) };
  const r = size[0] / 2;
  const [from, to] = size.length === 3 ? [size[1], size[2]] : [-r, r];
  const area = diskBandArea(r, from, to);
  return {
    width: area / (to - from),
    height: to - from,
    offset: (from + to) / 2,
    radiance: watts / (Math.PI * Math.PI * r * r),
  };
}

export function createInteriorLights(): THREE.RectAreaLight[] {
  return INTERIOR_SOURCES.map((source) => {
    const [name, , color, location, axisX, axisZ, , visible] = source;
    const { width, height, offset, radiance } = sourceRect(source);
    const light = new THREE.RectAreaLight(
      new THREE.Color().setRGB(...color, THREE.LinearSRGBColorSpace),
      visible * radiance,
      width,
      height,
    );
    light.name = name;
    const x = gltf(axisX).normalize(),
      z = gltf(axisZ).normalize(),
      y = z.clone().cross(x);
    light.position.copy(gltf(location)).addScaledVector(y, offset);
    light.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    return light;
  });
}

const DIFFUSE_TARGET =
  'RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const HEMI_START = '#if ( NUM_HEMI_LIGHTS > 0 )';
const HEMI_END = '#pragma unroll_loop_end';
const vec3 = (v: THREE.Vector3) =>
  `vec3( ${v
    .toArray()
    .map((c) => c.toFixed(4))
    .join(', ')} )`;

// The world position is recovered from the view-space one as three's probe grid does.
const interior = /* glsl */ `
vec3 suiWorldPosition = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
bool suiInterior = all( greaterThanEqual( suiWorldPosition, ${vec3(INTERIOR_BOX.min)} ) ) && all( lessThanEqual( suiWorldPosition, ${vec3(INTERIOR_BOX.max)} ) );
`;
const diffuse = /* glsl */ `if ( suiInterior ) {
			vec3 rectCoords[ 4 ];
			rectCoords[ 0 ] = rectAreaLight.position + rectAreaLight.halfWidth - rectAreaLight.halfHeight;
			rectCoords[ 1 ] = rectAreaLight.position - rectAreaLight.halfWidth - rectAreaLight.halfHeight;
			rectCoords[ 2 ] = rectAreaLight.position - rectAreaLight.halfWidth + rectAreaLight.halfHeight;
			rectCoords[ 3 ] = rectAreaLight.position + rectAreaLight.halfWidth + rectAreaLight.halfHeight;
			reflectedLight.directDiffuse += rectAreaLight.color * material.diffuseContribution * suiRectFormFactor( geometryNormal, geometryPosition, rectCoords );
		}`;

// Sutherland-Hodgman clipping of the quad against the receiver's tangent plane; a convex quad
// leaves the horizon once and enters it once, and the horizon segment closes the polygon.
const formFactor = /* glsl */ `
float suiRectFormFactor( const in vec3 N, const in vec3 P, const in vec3 rect[ 4 ] ) {

	vec3 lightNormal = cross( rect[ 1 ] - rect[ 0 ], rect[ 3 ] - rect[ 0 ] );
	if ( dot( lightNormal, P - rect[ 0 ] ) < 0.0 ) return 0.0;

	vec3 T1 = normalize( cross( N, abs( N.x ) < 0.9 ? vec3( 1.0, 0.0, 0.0 ) : vec3( 0.0, 1.0, 0.0 ) ) );
	mat3 toTangent = transpose( mat3( T1, cross( N, T1 ), N ) );
	vec3 c[ 4 ];
	for ( int i = 0; i < 4; i ++ ) c[ i ] = toTangent * ( rect[ i ] - P );

	vec3 f = vec3( 0.0 );
	vec3 exitPoint = vec3( 0.0 );
	vec3 entryPoint = vec3( 0.0 );
	bool clipped = false;
	for ( int i = 0; i < 4; i ++ ) {

		vec3 a = c[ i ];
		vec3 b = c[ ( i + 1 ) % 4 ];
		if ( a.z > 0.0 && b.z > 0.0 ) {

			f += LTC_EdgeVectorFormFactor( normalize( a ), normalize( b ) );

		} else if ( a.z > 0.0 ) {

			exitPoint = mix( a, b, a.z / ( a.z - b.z ) );
			f += LTC_EdgeVectorFormFactor( normalize( a ), normalize( exitPoint ) );
			clipped = true;

		} else if ( b.z > 0.0 ) {

			entryPoint = mix( a, b, a.z / ( a.z - b.z ) );
			f += LTC_EdgeVectorFormFactor( normalize( entryPoint ), normalize( b ) );

		}

	}
	if ( clipped ) f += LTC_EdgeVectorFormFactor( normalize( exitPoint ), normalize( entryPoint ) );
	return abs( f.z );

}
`;

// three 0.186 is pinned; a changed chunk fails loudly instead of lighting the courtyard.
const chunk = THREE.ShaderChunk.lights_fragment_begin;
if (!chunk.includes('suiInterior')) {
  const hemiStart = chunk.indexOf(HEMI_START);
  const hemiEnd = hemiStart < 0 ? -1 : chunk.indexOf(HEMI_END, hemiStart);
  const light = chunk.indexOf('IncidentLight directLight;');
  const pars = THREE.ShaderChunk.lights_physical_pars_fragment;
  if (!chunk.includes(DIFFUSE_TARGET) || hemiEnd < 0 || light < 0 || !pars.includes('vec3 LTC_EdgeVectorFormFactor('))
    throw new Error('three lighting chunks changed; update interiorLights.ts');
  THREE.ShaderChunk.lights_physical_pars_fragment = pars + formFactor;
  const end = hemiEnd + HEMI_END.length;
  THREE.ShaderChunk.lights_fragment_begin =
    chunk.slice(0, light) +
    interior +
    chunk.slice(light, hemiStart).replace(DIFFUSE_TARGET, diffuse) +
    `vec3 suiBeforeSky = irradiance;\n\t${chunk.slice(hemiStart, end)}\n\t\tif ( suiInterior ) irradiance = suiBeforeSky + ${INTERIOR_SKY.toFixed(3)} * ( irradiance - suiBeforeSky );` +
    chunk.slice(end);
}
