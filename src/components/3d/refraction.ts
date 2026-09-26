import * as THREE from 'three';
import { WATER_BOX } from './interiorLights';
import { WAVE_NORMAL } from './waterEffects';

// The plunge seen through its flat surface. Cycles refracts the camera rays at the water (IOR
// 1.333), so the tub looks shallow and its inner walls nearly vanish; the browser surface is a
// blended layer that does not bend the view. Here each vertex under the water is drawn at its
// image instead: the ray from the camera meets the surface at P where Snell's law holds, and
// the point is seen along the camera ray through P. Placing the image on the vertical through
// the point puts it at the apparent depth b' = b·cosθ1 / (n·cosθ2) below the surface (b is the
// true depth, θ1 and θ2 the angles above and below the surface), which is b/n straight down and
// thins toward grazing views. Only gl_Position moves: lighting, probes and shadows keep the true
// position (the shadow passes use their own depth materials). Ripples and the rippled source
// surface are left out.
//
// The view through the water is tinted as in the source: once by the transmission color of the
// surface (its Base Color, transmission 1) and by the volume absorption (color (0.57, 0.84, 0.78),
// density 0.12: Cycles absorbs density·(1 − color) per meter) along the refracted path under the
// water, which the vertex stage passes on.
//
// The image is not linear in the position, so triangles in the water with long edges (the tub
// walls reach from the floor to the coping in one triangle) are cut at the surface and on a grid
// of axis-aligned planes. Planes cut shared edges at the same points on both sides, so the moved
// meshes stay closed. The individual tiles are already small and are left as they are.
//
// The sides of the source water are flat and meet air (the tiles and walls sit a few mm to cm
// behind them), so Cycles reflects most views that reach a side back into the pool: the refracted
// view goes down at least as steeply as the critical angle (|d.y| ≥ 0.66), so it meets a side at
// more than 48.6° and is totally reflected unless it runs nearly square to it, and it never
// reflects off the bottom. Across the tub it can reflect at most once off an x side and once off a
// z side before it reaches the bottom. A flat mirror shows the scene mirrored across its plane, so
// the underwater triangles are drawn eight more times, mirrored across each side and each corner,
// at the image of the mirrored point (the straight refracted ray reaches it). Each fragment follows
// its view through the flat surface and the source water's box and keeps only the image of the
// sides that view reflects off: the true tub walls behind a reflecting side and the mirrored
// images of the sides it passes are discarded. Lighting keeps the true point; only the view
// direction is mirrored.
//
// A view that leaves through the first side it meets (nearly square to it, at 41.4–48.6°) is
// still partly reflected: the water–air Fresnel reflectance there runs from 7% to 100% toward the
// critical angle. The only surface seen through a side is the tub's inner wall 6 mm behind it (its
// back is 0.3 m further). So the mirrored images of the first side are drawn wherever the view
// meets it, before that wall, and the wall is blended over them with its transmittance 1 − R. At a
// second side the view still either reflects fully or passes.

export const WATER_IOR = 1.333;
/** Spacing of the cutting planes, in meters. */
export const SLICE_SPACING = 0.1;
/** Meshes with an underwater edge longer than this are cut. */
const LONG_EDGE = 0.3;

/** Apparent depth below a flat surface of a point `depth` under it, seen from `height` above it at `distance` horizontally. */
export function apparentDepth(height: number, depth: number, distance: number, ior = WATER_IOR) {
  if (distance < 1e-6) return depth / ior;
  // Horizontal offset x of the surface point: x/√(x²+a²) = n·(D−x)/√((D−x)²+b²), increasing in x.
  let lo = 0;
  let hi = distance;
  for (let i = 0; i < 24; i++) {
    const x = (lo + hi) / 2;
    const rest = distance - x;
    if (x / Math.hypot(x, height) < (ior * rest) / Math.hypot(rest, depth)) lo = x;
    else hi = x;
  }
  const x = (lo + hi) / 2;
  const cos1 = height / Math.hypot(x, height);
  const sin2 = x / Math.hypot(x, height) / ior;
  return (depth * cos1) / (ior * Math.sqrt(1 - sin2 * sin2));
}

/** The water surface's transmission color and the volume absorption per meter (Cycles). */
export const WATER_TINT = [0.93, 0.985, 0.975] as const;
export const WATER_ABSORPTION = [0.57, 0.84, 0.78].map((c) => 0.12 * (1 - c));

/** Linear transmittance of the view through the surface and `path` meters of water. */
export const waterTransmittance = (path: number) =>
  WATER_TINT.map((tint, i) => tint * Math.exp(-WATER_ABSORPTION[i] * path));

/**
 * The source water volume (V4 rippled spring water volume, evaluated geometry) in glTF meters:
 * its flat sides and bottom (the top is the scene's flat level). The lighting WATER_BOX is wider (it holds the tiles and walls).
 */
export const WATER_VOLUME = new THREE.Box3(
  new THREE.Vector3(-0.155, 0.215, -4.095),
  new THREE.Vector3(2.515, 0.765, -0.905),
);
/** A refracted view meeting a side reflects fully while its component along the side's normal is below this. */
const SIDE_CRITICAL = Math.sqrt(1 - 1 / WATER_IOR ** 2);
/**
 * Surfaces this far behind a side are the only ones seen through it: the tub's inner wall stands
 * 6 mm behind each side of the source water, its back 0.3 m further.
 */
export const SIDE_WALL_LAYER = 0.05;
/** The sides a mirrored image lies behind: [x, z], each −1 (min side), 0 or 1 (max side). */
export type Sides = [number, number];
/** The mirrored images drawn besides the true one: four sides and four corners. */
export const SIDE_IMAGES: Sides[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

/** Fresnel reflectance of unpolarized light in the water meeting air at `cos` to the normal. */
export function waterAirReflectance(cos: number, ior = WATER_IOR) {
  const sin = ior * Math.sqrt(Math.max(0, 1 - cos * cos));
  if (sin >= 1) return 1;
  const out = Math.sqrt(1 - sin * sin);
  const s = (ior * cos - out) / (ior * cos + out);
  const p = (ior * out - cos) / (ior * out + cos);
  return (s * s + p * p) / 2;
}

export interface SidePath {
  /** The sides the view reflects off: the first it meets (partly), a second only when fully. */
  sides: Sides;
  /** The first side it meets ([0, 0] when it reaches the bottom first). */
  first: Sides;
  /** Its reflectance at the first side: 1 past the critical angle, 0 without a side. */
  reflectance: number;
}

/**
 * The view from `camera` toward the underwater `image`, followed through the surface at `level`
 * (refracted about `normal` there, a function of the entry point) into WATER_VOLUME. No side
 * when it enters outside the volume.
 */
export function sidePath(
  camera: THREE.Vector3,
  image: THREE.Vector3,
  level: number,
  normal: (x: number, z: number) => THREE.Vector3 = () => new THREE.Vector3(0, 1, 0),
): SidePath {
  const view = image.clone().sub(camera).normalize();
  const path: SidePath = { sides: [0, 0], first: [0, 0], reflectance: 0 };
  if (camera.y <= level || view.y >= 0) return path;
  const p = camera.clone().addScaledVector(view, (camera.y - level) / -view.y);
  if (p.x < WATER_VOLUME.min.x || p.x > WATER_VOLUME.max.x || p.z < WATER_VOLUME.min.z || p.z > WATER_VOLUME.max.z)
    return path;
  // refract() as in GLSL with eta 1/n.
  const eta = 1 / WATER_IOR;
  const n = normal(p.x, p.z);
  const cos = -view.dot(n);
  const d = view
    .clone()
    .multiplyScalar(eta)
    .addScaledVector(n, eta * cos - Math.sqrt(1 - eta * eta * (1 - cos * cos)));
  const bounds = WATER_VOLUME;
  for (let i = 0; i < 2; i++) {
    const tx = ((d.x >= 0 ? bounds.max.x : bounds.min.x) - p.x) / (Math.abs(d.x) > 1e-6 ? d.x : 1e-6);
    const tz = ((d.z >= 0 ? bounds.max.z : bounds.min.z) - p.z) / (Math.abs(d.z) > 1e-6 ? d.z : 1e-6);
    const tb = (bounds.min.y - p.y) / d.y;
    if (tb <= Math.min(tx, tz)) break;
    const axis = tx < tz ? 'x' : 'z';
    const k = axis === 'x' ? 0 : 1;
    p.addScaledVector(d, Math.min(tx, tz));
    if (i === 0) {
      path.first[k] = Math.sign(d[axis]);
      path.reflectance = waterAirReflectance(Math.abs(d[axis]));
    } else if (Math.abs(d[axis]) >= SIDE_CRITICAL) break;
    path.sides[k] = Math.sign(d[axis]);
    d[axis] = -d[axis];
  }
  return path;
}

/** `point` mirrored across the given sides of WATER_VOLUME. */
export function mirrorAcross(point: THREE.Vector3, [x, z]: Sides) {
  const mirrored = point.clone();
  if (x) mirrored.x = 2 * (x > 0 ? WATER_VOLUME.max.x : WATER_VOLUME.min.x) - point.x;
  if (z) mirrored.z = 2 * (z > 0 ? WATER_VOLUME.max.z : WATER_VOLUME.min.z) - point.z;
  return mirrored;
}

/**
 * Whether a fragment at true position `point` of the image mirrored across `image` sides is kept
 * when its view reflects off `path` sides: the image of those sides, or of fewer sides for the
 * points inside the water, which the view reaches before it meets the next side. Nothing behind
 * a side the view reflects off is seen (the tub wall just behind it would stand in front of its
 * mirrored image).
 */
export function keepsImage(point: THREE.Vector3, image: Sides, path: Sides) {
  const along = image.every((side, i) => side === 0 || side === path[i]);
  const { min, max } = WATER_VOLUME;
  const behind = (side: number, value: number, low: number, high: number) =>
    (side > 0 && value > high) || (side < 0 && value < low);
  if (behind(image[0], point.x, min.x, max.x) || behind(image[1], point.z, min.z, max.z)) return false;
  const inside = point.x > min.x && point.x < max.x && point.z > min.z && point.z < max.z;
  return along && (inside || (image[0] === path[0] && image[1] === path[1]));
}

/**
 * The weight of a true surface at `point` on the view `path` (drawn over the mirrored images): 1
 * in the water or when the view meets no side, the transmittance of the first side for the wall
 * just behind it, and 0 for anything else behind a side.
 */
export function trueWeight(point: THREE.Vector3, path: SidePath) {
  const { min, max } = WATER_VOLUME;
  if (point.x > min.x && point.x < max.x && point.z > min.z && point.z < max.z) return 1;
  if (path.first[0] === 0 && path.first[1] === 0) return 1;
  const k = path.first[0] ? 0 : 1;
  const axis = k === 0 ? 'x' : 'z';
  const plane = path.first[k] > 0 ? max[axis] : min[axis];
  const behind = (point[axis] - plane) * path.first[k];
  return behind > 0 && behind <= SIDE_WALL_LAYER ? 1 - path.reflectance : 0;
}

const vec2 = (v: THREE.Vector3) => `vec2( ${v.x.toFixed(4)}, ${v.z.toFixed(4)} )`;

const glslVec3 = (v: readonly number[]) => `vec3( ${v.map((c) => c.toFixed(5)).join(', ')} )`;
const inBox = (p: string) =>
  `${p}.y >= ${WATER_BOX.min.y.toFixed(4)} && all( greaterThanEqual( ${p}.xz, ${vec2(WATER_BOX.min)} ) ) && all( lessThanEqual( ${p}.xz, ${vec2(WATER_BOX.max)} ) )`;

// Declarations for both stages. suiSide is the image's sides (0 for the true one).
const declarations = (level: string) => /* glsl */ `
#ifdef SUI_REFRACTION
varying float vSuiWaterPath;
varying vec3 vSuiImage;
uniform float suiWaterTime;
${WAVE_NORMAL}
#ifdef SUI_SIDE_IMAGE
uniform vec2 suiSide;
vec3 suiMirror( vec3 p ) {
	vec2 plane = mix( ${vec2(WATER_VOLUME.min)}, ${vec2(WATER_VOLUME.max)}, step( 0.0, suiSide ) );
	p.xz = mix( p.xz, 2.0 * plane - p.xz, abs( suiSide ) );
	return p;
}
#endif
// The view toward an underwater image (sidePath in refraction.ts), entering through the rippled
// surface: the images stay at the flat surface's, but which one is seen and how much of it
// follows the waves (closer to the source's reflecting region than a flat surface). Returns the
// sides it reflects off; first is the first side it meets and reflectance its Fresnel reflectance
// there.
// waterAirReflectance: unpolarized Fresnel of the water meeting air, 1 past the critical angle.
float suiWaterAirReflectance( float cosine ) {
	float sinOut = ${WATER_IOR} * sqrt( max( 0.0, 1.0 - cosine * cosine ) );
	if ( sinOut >= 1.0 ) return 1.0;
	float cosOut = sqrt( 1.0 - sinOut * sinOut );
	float rs = ( ${WATER_IOR} * cosine - cosOut ) / ( ${WATER_IOR} * cosine + cosOut );
	float rp = ( ${WATER_IOR} * cosOut - cosine ) / ( ${WATER_IOR} * cosOut + cosine );
	return 0.5 * ( rs * rs + rp * rp );
}
// refracted is the view just under the surface (zero when it enters outside the volume).
vec2 suiSidePath( vec3 image, out vec2 first, out float reflectance, out vec3 refracted ) {
	vec3 view = normalize( image - cameraPosition );
	vec2 sides = vec2( 0.0 );
	first = vec2( 0.0 );
	reflectance = 0.0;
	refracted = vec3( 0.0 );
	if ( cameraPosition.y <= ${level} || view.y >= 0.0 ) return sides;
	vec3 p = cameraPosition + view * ( ( cameraPosition.y - ${level} ) / - view.y );
	if ( any( lessThan( p.xz, ${vec2(WATER_VOLUME.min)} ) ) || any( greaterThan( p.xz, ${vec2(WATER_VOLUME.max)} ) ) ) return sides;
	vec3 d = refract( view, suiWaveNormal( p.xz, suiWaterTime ), ${(1 / WATER_IOR).toFixed(6)} );
	refracted = d;
	for ( int i = 0; i < 2; i ++ ) {
		vec2 wall = mix( ${vec2(WATER_VOLUME.min)}, ${vec2(WATER_VOLUME.max)}, step( 0.0, d.xz ) );
		vec2 t = ( wall - p.xz ) / mix( vec2( 1e-6 ), d.xz, step( 1e-6, abs( d.xz ) ) );
		float bottom = ( ${WATER_VOLUME.min.y.toFixed(4)} - p.y ) / d.y;
		if ( bottom <= min( t.x, t.y ) ) break;
		bool alongX = t.x < t.y;
		p += d * min( t.x, t.y );
		float across = abs( alongX ? d.x : d.z );
		if ( i == 0 ) {
			reflectance = suiWaterAirReflectance( across );
			first = alongX ? vec2( sign( d.x ), 0.0 ) : vec2( 0.0, sign( d.z ) );
		} else if ( across >= ${SIDE_CRITICAL.toFixed(6)} ) break;
		if ( alongX ) { sides.x = sign( d.x ); d.x = - d.x; }
		else { sides.y = sign( d.z ); d.z = - d.z; }
	}
	return sides;
}
#endif
`;

// Same bisection as apparentDepth (16 steps: under 0.1 mm across the plunge). A mirrored image
// is placed at the image of its mirrored point.
const refraction = (level: string) => /* glsl */ `
#ifdef SUI_REFRACTION
vSuiWaterPath = 0.0;
{
	vec3 suiWorld = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
	vec3 suiSeen = suiWorld;
	// mvPosition stays the true point: vViewPosition is set from it for the lighting.
	vec4 suiSeenView = mvPosition;
	#ifdef SUI_SIDE_IMAGE
	suiSeen = suiMirror( suiWorld );
	suiSeenView.xyz += ( viewMatrix * vec4( suiSeen - suiWorld, 0.0 ) ).xyz;
	gl_Position = projectionMatrix * suiSeenView;
	#endif
	vSuiImage = suiSeen;
	float suiHeight = cameraPosition.y - ${level};
	float suiDepth = ${level} - suiWorld.y;
	if ( suiHeight > 0.0 && suiDepth > 0.0 && ${inBox('suiWorld')} ) {
		float suiDistance = length( suiSeen.xz - cameraPosition.xz );
		float suiLo = 0.0;
		float suiHi = suiDistance;
		for ( int i = 0; i < 16; i ++ ) {
			float x = 0.5 * ( suiLo + suiHi );
			float rest = suiDistance - x;
			if ( x * length( vec2( rest, suiDepth ) ) < ${WATER_IOR} * rest * length( vec2( x, suiHeight ) ) ) suiLo = x;
			else suiHi = x;
		}
		float x = 0.5 * ( suiLo + suiHi );
		float suiCos1 = suiHeight / length( vec2( x, suiHeight ) );
		float suiSin2 = x / length( vec2( x, suiHeight ) ) / ${WATER_IOR};
		float suiCos2 = sqrt( 1.0 - suiSin2 * suiSin2 );
		float suiApparent = suiDepth * suiCos1 / ( ${WATER_IOR} * suiCos2 );
		vSuiWaterPath = suiDepth / suiCos2;
		vSuiImage.y += suiDepth - suiApparent;
		gl_Position = projectionMatrix * ( suiSeenView + viewMatrix * vec4( 0.0, suiDepth - suiApparent, 0.0, 0.0 ) );
	}
}
#endif
`;

// Keeps a fragment only on the image its view reaches (keepsImage in refraction.ts). Mirrored
// images show nothing above the water or for a camera under it. A true surface behind the first
// side is kept only for the inner wall there, weighted by the side's transmittance (trueWeight),
// and blended over the images drawn before it (SUI_SIDE_BLEND).
const sideImage = (level: string) => /* glsl */ `
#ifdef SUI_REFRACTION
float suiSideWeight = 1.0;
// The view in the water where it reaches this fragment, going down (zero when not seen through it).
vec3 suiWetView = vec3( 0.0 );
{
	vec3 suiTrue = ( ( vec4( - vViewPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	bool suiWet = cameraPosition.y > ${level} && suiTrue.y < ${level} && ${inBox('suiTrue')};
	#ifdef SUI_SIDE_IMAGE
	if ( ! suiWet ) discard;
	#endif
	if ( suiWet ) {
		vec2 suiFirst;
		float suiReflectance;
		vec3 suiRefracted;
		vec2 suiPath = suiSidePath( vSuiImage, suiFirst, suiReflectance, suiRefracted );
		suiWetView = suiRefracted;
		#ifdef SUI_SIDE_IMAGE
		suiWetView.xz *= 1.0 - 2.0 * abs( suiSide );
		#endif
		bool suiInside = all( greaterThan( suiTrue.xz, ${vec2(WATER_VOLUME.min)} ) ) && all( lessThan( suiTrue.xz, ${vec2(WATER_VOLUME.max)} ) );
		#ifdef SUI_SIDE_IMAGE
		bool suiAlong = all( equal( suiSide * ( suiSide - suiPath ), vec2( 0.0 ) ) );
		vec2 suiBelow = step( suiTrue.xz, ${vec2(WATER_VOLUME.min)} );
		vec2 suiAbove = step( ${vec2(WATER_VOLUME.max)}, suiTrue.xz );
		bool suiBehind = any( greaterThan( max( suiSide, 0.0 ) * suiAbove + max( - suiSide, 0.0 ) * suiBelow, vec2( 0.0 ) ) );
		if ( suiBehind || ! suiAlong || ! ( suiInside || all( equal( suiSide, suiPath ) ) ) ) discard;
		#else
		if ( ! suiInside && any( notEqual( suiFirst, vec2( 0.0 ) ) ) ) {
			vec2 suiPlane = mix( ${vec2(WATER_VOLUME.min)}, ${vec2(WATER_VOLUME.max)}, step( 0.0, suiFirst ) );
			float suiBeyond = dot( suiTrue.xz - suiPlane, suiFirst );
			if ( suiBeyond <= 0.0 || suiBeyond > ${SIDE_WALL_LAYER.toFixed(4)} || suiReflectance >= 1.0 ) discard;
			suiSideWeight = 1.0 - suiReflectance;
		}
		#endif
	}
}
#endif
`;

// The mirrored image is seen from the mirrored camera.
const sideView = /* glsl */ `
#ifdef SUI_SIDE_IMAGE
{
	vec3 suiTrue = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
	vec3 suiToCamera = cameraPosition - suiMirror( suiTrue );
	suiToCamera.xz *= 1.0 - 2.0 * abs( suiSide );
	geometryViewDir = normalize( ( viewMatrix * vec4( suiToCamera, 0.0 ) ).xyz );
}
#endif
`;

/** Starts the view tint in opaque_fragment (waterBottom.ts adds its reflection before it). */
export const VIEW_TINT = '// The view through the water: tint and absorption.';

// suiWorldPosition is the fragment's true position (interiorLights.ts, lights_fragment_begin).
const tint = (level: string) => /* glsl */ `
${VIEW_TINT}
#ifdef SUI_REFRACTION
if ( cameraPosition.y > ${level} && suiWorldPosition.y < ${level} && ${inBox('suiWorldPosition')} )
	gl_FragColor.rgb *= ${glslVec3(WATER_TINT)} * exp( - ${glslVec3(WATER_ABSORPTION)} * vSuiWaterPath );
gl_FragColor.a *= suiSideWeight;
#endif
`;

// Polygon corners as barycentric weights of the source triangle.
type Polygon = THREE.Vector3[];

function split(polygon: Polygon, corners: THREE.Vector3[], axis: 'x' | 'y' | 'z', plane: number): Polygon[] {
  const side = polygon.map((w) => corners[0][axis] * w.x + corners[1][axis] * w.y + corners[2][axis] * w.z - plane);
  if (side.every((s) => s >= -1e-7) || side.every((s) => s <= 1e-7)) return [polygon];
  const below: Polygon = [];
  const above: Polygon = [];
  polygon.forEach((w, i) => {
    const j = (i + 1) % polygon.length;
    if (side[i] <= 0) below.push(w);
    if (side[i] >= 0) above.push(w);
    if ((side[i] < 0 && side[j] > 0) || (side[i] > 0 && side[j] < 0)) {
      const cut = w.clone().lerp(polygon[j], side[i] / (side[i] - side[j]));
      below.push(cut);
      above.push(cut.clone());
    }
  });
  return [below, above].filter((p) => p.length >= 3);
}

/**
 * Cuts the triangles of `geometry` (world transform `matrix`) that reach under the water at the
 * surface and on the slicing grid. Returns the number of triangles added and the material indices
 * (0 without groups) that have triangles under the water.
 */
export function sliceUnderwater(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, level: number) {
  const wet = new Set<number>();
  const position = geometry.getAttribute('position');
  if (!position || Object.keys(geometry.morphAttributes).length) return { triangles: 0, materials: wet };
  const index = geometry.index ? Array.from(geometry.index.array) : [...Array(position.count).keys()];
  const world = Array.from({ length: position.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix),
  );
  const region = new THREE.Box3(WATER_BOX.min, new THREE.Vector3(WATER_BOX.max.x, level, WATER_BOX.max.z));
  const triangle = new THREE.Box3();
  const inWater = (t: number) =>
    triangle.setFromPoints([world[index[t]], world[index[t + 1]], world[index[t + 2]]]).intersectsBox(region) &&
    triangle.min.y < level;
  const grouped = geometry.groups.length > 0;
  const groups = grouped ? geometry.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
  let long = false;
  for (const group of groups)
    for (let t = group.start; t < Math.min(group.start + group.count, index.length); t += 3)
      if (inWater(t)) {
        wet.add(group.materialIndex ?? 0);
        for (let e = 0; e < 3; e++)
          if (world[index[t + e]].distanceTo(world[index[t + ((e + 1) % 3)]]) > LONG_EDGE) long = true;
      }
  if (!long) return { triangles: 0, materials: wet };

  const names = Object.keys(geometry.attributes);
  const values = names.map((name) => {
    const attribute = geometry.getAttribute(name);
    const list: number[] = [];
    for (let i = 0; i < attribute.count; i++)
      for (let c = 0; c < attribute.itemSize; c++) list.push(attribute.getComponent(i, c));
    return list;
  });
  let count = position.count;
  const add = (corners: number[], w: THREE.Vector3) => {
    names.forEach((name, a) => {
      const size = geometry.getAttribute(name).itemSize;
      const item = Array.from({ length: size }, (_, c) =>
        name === 'tangent' && c === 3
          ? values[a][corners[0] * size + c]
          : w.x * values[a][corners[0] * size + c] +
            w.y * values[a][corners[1] * size + c] +
            w.z * values[a][corners[2] * size + c],
      );
      if (name === 'normal' || name === 'tangent') {
        const length = Math.hypot(item[0], item[1], item[2]) || 1;
        for (let c = 0; c < 3; c++) item[c] /= length;
      }
      values[a].push(...item);
    });
    return count++;
  };

  const next: number[] = [];
  const nextGroups: typeof geometry.groups = [];
  let added = 0;
  for (const group of groups) {
    const start = next.length;
    for (let t = group.start; t < Math.min(group.start + group.count, index.length); t += 3) {
      const source = [index[t], index[t + 1], index[t + 2]];
      if (!inWater(t)) {
        next.push(...source);
        continue;
      }
      const corners = source.map((i) => world[i]);
      let pieces: Polygon[] = [[new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]];
      pieces = pieces.flatMap((p) => split(p, corners, 'y', level));
      const cut = (axis: 'x' | 'y' | 'z', from: number, to: number) => {
        for (let k = Math.ceil(from / SLICE_SPACING); k * SLICE_SPACING < to; k++)
          pieces = pieces.flatMap((p) => split(p, corners, axis, k * SLICE_SPACING));
      };
      const lo = triangle.setFromPoints(corners).min.clone().max(region.min);
      const hi = triangle.max.clone().min(region.max);
      // Only the part under the surface is cut on the grid.
      const under = pieces.filter((p) =>
        p.every((w) => corners[0].y * w.x + corners[1].y * w.y + corners[2].y * w.z <= level + 1e-7),
      );
      const over = pieces.filter((p) => !under.includes(p));
      pieces = under;
      cut('x', lo.x, hi.x);
      cut('y', lo.y, hi.y);
      cut('z', lo.z, hi.z);
      pieces.push(...over);
      if (pieces.length === 1 && pieces[0].length === 3) {
        next.push(...source);
        continue;
      }
      for (const piece of pieces) {
        const ids = piece.map((w) => {
          const corner = [w.x, w.y, w.z].findIndex((v) => v > 1 - 1e-9);
          return corner >= 0 ? source[corner] : add(source, w);
        });
        for (let i = 1; i + 1 < ids.length; i++) next.push(ids[0], ids[i], ids[i + 1]);
        added += ids.length - 2;
      }
      added -= 1;
    }
    nextGroups.push({ start, count: next.length - start, materialIndex: group.materialIndex });
  }

  names.forEach((name, a) => {
    const old = geometry.getAttribute(name) as THREE.BufferAttribute;
    const Typed = old.array.constructor as Float32ArrayConstructor;
    const attribute = new THREE.BufferAttribute(new Typed(count * old.itemSize), old.itemSize, old.normalized);
    for (let i = 0; i < count; i++)
      for (let c = 0; c < old.itemSize; c++) attribute.setComponent(i, c, values[a][i * old.itemSize + c]);
    geometry.setAttribute(name, attribute);
  });
  geometry.setIndex(next);
  geometry.clearGroups();
  if (grouped) for (const g of nextGroups) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { triangles: added, materials: wet };
}

/**
 * Draws the model's underwater surfaces at their refracted image below the water surface at
 * `level` (glTF y). Returns the materials drawn so and the triangles the cutting added.
 */
export function applyRefraction(root: THREE.Object3D, level: number) {
  const materials = new Set<THREE.MeshStandardMaterial>();
  const region = new THREE.Box3(WATER_BOX.min, new THREE.Vector3(WATER_BOX.max.x, level, WATER_BOX.max.z));
  const bounds = new THREE.Box3();
  let triangles = 0;
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    if (!bounds.setFromObject(object).intersectsBox(region)) return;
    const cut = sliceUnderwater(object.geometry, object.matrixWorld, level);
    triangles += cut.triangles;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of [...cut.materials].map((i) => list[i]))
      if (material instanceof THREE.MeshStandardMaterial) {
        material.defines = { ...material.defines, SUI_REFRACTION: level.toFixed(4) };
        material.needsUpdate = true;
        materials.add(material);
      }
  });
  return { materials: materials.size, triangles };
}

/**
 * A copy of `material` that blends over the images by its alpha (the side's transmittance, 1
 * elsewhere), keeping the target's alpha. It stays in the opaque pass.
 */
function blendOverImages(material: THREE.Material) {
  const copy = material.clone();
  // MeshStandardMaterial.copy() resets the defines.
  copy.defines = { ...material.defines };
  copy.onBeforeCompile = (shader, renderer) => material.onBeforeCompile(shader, renderer);
  copy.customProgramCacheKey = () => `${material.customProgramCacheKey()}|behind-sides`;
  copy.blending = THREE.CustomBlending;
  copy.blendSrc = THREE.SrcAlphaFactor;
  copy.blendDst = THREE.OneMinusSrcAlphaFactor;
  copy.blendSrcAlpha = THREE.ZeroFactor;
  copy.blendDstAlpha = THREE.OneFactor;
  return copy;
}

/** The layer of the mirrored images: only the main camera draws them, not the water's mirror. */
export const SIDE_IMAGE_LAYER = 2;

type IndexedPart = { index: THREE.BufferAttribute; groups: { start: number; count: number; materialIndex: number }[] };

/**
 * The part of `geometry` under the water (as sliceUnderwater cuts it), or null when there is
 * none; of that, the `wall` part with a corner in the layer just behind a side (null when none),
 * and the `rest` of the geometry without it.
 */
function underwaterPart(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, level: number, wet: Set<number>) {
  const position = geometry.getAttribute('position');
  const index = geometry.index ? Array.from(geometry.index.array) : [...Array(position.count).keys()];
  const region = new THREE.Box3(WATER_BOX.min, new THREE.Vector3(WATER_BOX.max.x, level, WATER_BOX.max.z));
  const triangle = new THREE.Box3();
  const corners = [0, 1, 2].map(() => new THREE.Vector3());
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
  const { min, max } = WATER_VOLUME;
  const beyond = (p: THREE.Vector3) => Math.max(min.x - p.x, p.x - max.x, min.z - p.z, p.z - max.z);
  const parts = { under: [] as number[], wall: [] as number[], rest: [] as number[] };
  const partGroups = { under: [], wall: [], rest: [] } as Record<keyof typeof parts, IndexedPart['groups']>;
  for (const group of groups) {
    const materialIndex = group.materialIndex ?? 0;
    const starts = { under: parts.under.length, wall: parts.wall.length, rest: parts.rest.length };
    for (let t = group.start; t < Math.min(group.start + group.count, index.length); t += 3) {
      const ids = [index[t], index[t + 1], index[t + 2]];
      let wall = false;
      if (wet.has(materialIndex)) {
        corners.forEach((c, e) => c.fromBufferAttribute(position, ids[e]).applyMatrix4(matrix));
        triangle.setFromPoints(corners);
        // Wholly under the surface: the slicing cut every wet triangle there.
        if (triangle.intersectsBox(region) && triangle.max.y <= level + 1e-6) {
          parts.under.push(...ids);
          wall = corners.some((c) => beyond(c) > 0 && beyond(c) <= SIDE_WALL_LAYER);
        }
      }
      parts[wall ? 'wall' : 'rest'].push(...ids);
    }
    for (const key of ['under', 'wall', 'rest'] as const)
      if (parts[key].length > starts[key])
        partGroups[key].push({ start: starts[key], count: parts[key].length - starts[key], materialIndex });
  }
  if (!parts.under.length) return null;
  const indexed = (key: keyof typeof parts): IndexedPart => ({
    index: new THREE.BufferAttribute(new Uint32Array(parts[key]), 1),
    groups: partGroups[key],
  });
  return { ...indexed('under'), wall: parts.wall.length ? indexed('wall') : null, rest: indexed('rest') };
}

/** A geometry drawing `part` of `source`'s attributes. */
function sharing(source: THREE.BufferGeometry, part: IndexedPart) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(part.index);
  for (const group of part.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  return geometry;
}

/**
 * Adds the underwater surfaces mirrored across the sides and corners of the source water (see
 * above), after applyRefraction and the other material changes. They are drawn on
 * SIDE_IMAGE_LAYER and cast no shadow, before the triangles of the wall just behind the sides,
 * which move to meshes of their own blended by their alpha (the side's transmittance). `waterTime` is the waves' time
 * uniform (waterEffects.ts), which the underwater materials now read. Returns the meshes added and
 * their triangles each.
 */
export function addSideImages(root: THREE.Object3D, level: number, waterTime: { value: number }) {
  const region = new THREE.Box3(WATER_BOX.min, new THREE.Vector3(WATER_BOX.max.x, level, WATER_BOX.max.z));
  const bounds = new THREE.Box3();
  const sources: THREE.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.visible && bounds.setFromObject(object).intersectsBox(region))
      sources.push(object);
  });
  let meshes = 0;
  let triangles = 0;
  const timed = new Set<THREE.Material>();
  const images: { mesh: THREE.Mesh; sides: Sides }[] = [];
  for (const source of sources) {
    const list: THREE.Material[] = Array.isArray(source.material) ? source.material : [source.material];
    const wet = new Set(
      list.flatMap((material, i) =>
        material instanceof THREE.MeshStandardMaterial && material.defines?.SUI_REFRACTION !== undefined ? [i] : [],
      ),
    );
    if (!wet.size) continue;
    for (const i of wet) {
      const material = list[i];
      if (timed.has(material)) continue;
      timed.add(material);
      const previous = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        shader.uniforms.suiWaterTime = waterTime;
      };
    }
    const part = underwaterPart(source.geometry, source.matrixWorld, level, wet);
    if (!part) continue;
    const toLocal = source.matrixWorld.clone().invert();
    for (const sides of SIDE_IMAGES) {
      const geometry = sharing(source.geometry, part);
      // Culled by the mirrored region, where its image lies (the lift keeps it under the surface).
      const mirrored = new THREE.Box3().setFromPoints(
        [region.min, region.max].map((p) => mirrorAcross(p, sides).applyMatrix4(toLocal)),
      );
      geometry.boundingBox = mirrored;
      geometry.boundingSphere = mirrored.getBoundingSphere(new THREE.Sphere());
      // One mirror reverses the winding: swap the culled side and undo the normal flip that
      // brings (FLIP_SIDED), or flip the facing of double-sided materials.
      const flipped = sides[0] * sides[1] === 0;
      const side = { value: new THREE.Vector2(...sides) };
      const materials = list.map((material, i) => {
        if (!wet.has(i)) return material;
        const copy = material.clone();
        copy.defines = { ...material.defines, SUI_SIDE_IMAGE: '', ...(flipped ? { SUI_SIDE_FLIPPED: '' } : {}) };
        if (flipped && material.side !== THREE.DoubleSide)
          copy.side = material.side === THREE.FrontSide ? THREE.BackSide : THREE.FrontSide;
        copy.onBeforeCompile = (shader, renderer) => {
          material.onBeforeCompile(shader, renderer);
          shader.uniforms.suiSide = side;
        };
        // clone() keeps neither callback; without the source's key, copies of materials that
        // differ only in their onBeforeCompile (the tiles' caustics, the bronze) share a program.
        copy.customProgramCacheKey = () => `${material.customProgramCacheKey()}|side-image`;
        return copy;
      });
      const mesh = new THREE.Mesh(geometry, Array.isArray(source.material) ? materials : materials[0]);
      mesh.name = `${source.name} side image ${sides.join(',')}`;
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(source.matrixWorld);
      mesh.castShadow = false;
      mesh.receiveShadow = source.receiveShadow;
      mesh.layers.set(SIDE_IMAGE_LAYER);
      // After the true surfaces, so the coping and the tub in front reject its hidden fragments by
      // depth, but before the wall behind the sides, which is blended over it.
      mesh.renderOrder = 1;
      root.add(mesh);
      images.push({ mesh, sides });
      meshes++;
      triangles += part.index.count / 3;
    }
    if (part.wall) {
      // The wall just behind the sides moves to a mesh of its own, drawn after the images and
      // blended over them. The rest keeps its place in the opaque pass, where the pool floor
      // hides what lies below it by depth.
      const grouped = source.geometry.groups.length > 0;
      const wall = new THREE.Mesh(
        sharing(source.geometry, part.wall),
        Array.isArray(source.material)
          ? list.map((material, i) => (wet.has(i) ? blendOverImages(material) : material))
          : blendOverImages(list[0]),
      );
      source.geometry.setIndex(part.rest.index);
      source.geometry.clearGroups();
      if (grouped)
        for (const group of part.rest.groups) source.geometry.addGroup(group.start, group.count, group.materialIndex);
      wall.geometry.boundingBox = source.geometry.boundingBox;
      wall.geometry.boundingSphere = source.geometry.boundingSphere;
      wall.name = `${source.name} behind the sides`;
      wall.matrixAutoUpdate = false;
      wall.matrix.copy(source.matrixWorld);
      wall.castShadow = source.castShadow;
      wall.receiveShadow = source.receiveShadow;
      wall.layers.mask = source.layers.mask;
      wall.renderOrder = 2;
      root.add(wall);
    }
  }
  const surface = new THREE.Box3(
    new THREE.Vector3(WATER_VOLUME.min.x, level, WATER_VOLUME.min.z),
    new THREE.Vector3(WATER_VOLUME.max.x, level, WATER_VOLUME.max.z),
  );
  const frustum = new THREE.Frustum();
  const matrix = new THREE.Matrix4();
  return {
    meshes,
    triangles,
    /**
     * Shows only the images `camera` can see: none while it is under the surface or the surface is
     * out of view, and none of a side it is behind. The refracted view keeps its horizontal
     * direction, so from beyond a side every view moves away from it. Returns the meshes shown.
     */
    update(camera: THREE.Camera) {
      camera.updateMatrixWorld();
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      const { x, y, z } = camera.getWorldPosition(new THREE.Vector3());
      const seen = y > level && frustum.intersectsBox(surface);
      const facing = (side: number, value: number, low: number, high: number) =>
        side === 0 || (side > 0 ? value < high : value > low);
      let shown = 0;
      for (const { mesh, sides } of images) {
        mesh.visible =
          seen &&
          facing(sides[0], x, WATER_VOLUME.min.x, WATER_VOLUME.max.x) &&
          facing(sides[1], z, WATER_VOLUME.min.z, WATER_VOLUME.max.z);
        if (mesh.visible) shown++;
      }
      return shown;
    },
  };
}

// three 0.186 is pinned: project_vertex ends with gl_Position from mvPosition, opaque_fragment
// with gl_FragColor from the outgoing light, and interiorLights.ts has defined suiWorldPosition.
const PROJECT = 'gl_Position = projectionMatrix * mvPosition;';
const OPAQUE = 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );';
const VIEW_DIR = 'vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );';
const FACING = 'float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;';
if (!THREE.ShaderChunk.project_vertex.includes('SUI_REFRACTION')) {
  if (
    !THREE.ShaderChunk.project_vertex.trimEnd().endsWith(PROJECT) ||
    !THREE.ShaderChunk.opaque_fragment.trimEnd().endsWith(OPAQUE) ||
    !THREE.ShaderChunk.lights_fragment_begin.includes('vec3 suiWorldPosition') ||
    !THREE.ShaderChunk.lights_fragment_begin.includes(VIEW_DIR) ||
    !THREE.ShaderChunk.normal_fragment_begin.includes(FACING) ||
    !THREE.ShaderChunk.defaultnormal_vertex.includes('#ifdef FLIP_SIDED')
  )
    throw new Error('three shader chunks changed; update refraction.ts');
  const level = 'float( SUI_REFRACTION )';
  THREE.ShaderChunk.common += declarations(level);
  THREE.ShaderChunk.project_vertex += refraction(level);
  THREE.ShaderChunk.clipping_planes_fragment = sideImage(level) + THREE.ShaderChunk.clipping_planes_fragment;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(
    VIEW_DIR,
    VIEW_DIR + sideView,
  );
  THREE.ShaderChunk.defaultnormal_vertex +=
    '\n#if defined( SUI_SIDE_FLIPPED ) && ! defined( DOUBLE_SIDED )\ntransformedNormal = - transformedNormal;\n#endif\n';
  THREE.ShaderChunk.normal_fragment_begin = THREE.ShaderChunk.normal_fragment_begin.replace(
    FACING,
    FACING + '\n#if defined( SUI_SIDE_FLIPPED ) && defined( DOUBLE_SIDED )\nfaceDirection = - faceDirection;\n#endif',
  );
  THREE.ShaderChunk.opaque_fragment += tint(level);
}
