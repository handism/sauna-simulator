import * as THREE from 'three';

// Bounds of V8 canopy timber beam[.001] and the 17 V8 slender shade louvers in
// SUI_Retreat.blend, converted to glTF axes. Like the area-light geometry, these are
// static scene data. Only the sharp water-bottom light rays use this approximation;
// it does not replace the ordinary shadow maps or dim the reflection probes.
// The boxes omit the timber's small bevels. See docs/3d-qa/water-light-occlusion/.
export const WATER_LIGHT_CANOPY = {
  beams: [
    [
      [3.125, 2.86, 0.5975],
      [6.975, 3.02, 0.7025],
    ],
    [
      [3.125, 2.86, -4.6325],
      [6.975, 3.02, -4.5275],
    ],
  ],
  louvers: {
    min: [3.1975, 2.97, -4.675],
    max: [6.9105, 3.11, 0.745],
    spacing: 0.228,
    width: 0.065,
    count: 17,
  },
} as const;

type Bounds = readonly [readonly number[], readonly number[]];
const EPSILON = 1e-7;

function interval(origin: THREE.Vector3, direction: THREE.Vector3, end: number, [low, high]: Bounds) {
  let enter = 0;
  let leave = end;
  for (const [i, axis] of (['x', 'y', 'z'] as const).entries()) {
    const d = (direction[axis] < 0 ? -1 : 1) * Math.max(Math.abs(direction[axis]), EPSILON);
    const a = (low[i] - origin[axis]) / d;
    const b = (high[i] - origin[axis]) / d;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
  }
  return enter < leave ? [enter, leave] : null;
}

/** A ray after leaving the water, up to (not beyond) its intersection with an area light.
 * Clip against the louver bank, then intersect its x interval with the periodic solid slats.
 * This takes constant work rather than testing all 17 slats on every water ray. */
export function canopyBlocks(origin: THREE.Vector3, direction: THREE.Vector3, end: number) {
  const { beams, louvers: l } = WATER_LIGHT_CANOPY;
  if (beams.some((box) => interval(origin, direction, end, box))) return true;
  const span = interval(origin, direction, end, [l.min, l.max]);
  if (!span) return false;
  const x0 = origin.x + direction.x * span[0];
  const x1 = origin.x + direction.x * span[1];
  const low = (Math.min(x0, x1) - l.min[0]) / l.spacing;
  const high = (Math.max(x0, x1) - l.min[0]) / l.spacing;
  return Math.ceil(low - l.width / l.spacing) <= Math.floor(high);
}

const vec = (v: readonly number[]) => `vec3( ${v.map((n) => n.toFixed(7)).join(', ')} )`;
const { beams, louvers: l } = WATER_LIGHT_CANOPY;
export const CANOPY_GLSL = /* glsl */ `
bool suiCanopyInterval( vec3 p, vec3 inverseDirection, vec3 low, vec3 high, float end, out float enter, out float leave ) {
  vec3 a = ( low - p ) * inverseDirection, b = ( high - p ) * inverseDirection;
  vec3 near = min( a, b ), far = max( a, b );
  enter = max( max( near.x, near.y ), max( near.z, 0.0 ) );
  leave = min( min( far.x, far.y ), min( far.z, end ) );
  return enter < leave;
}
bool suiCanopyBlocks( vec3 p, vec3 d, float end ) {
  vec3 inverseDirection = 1.0 / ( mix( vec3( -1.0 ), vec3( 1.0 ), step( vec3( 0.0 ), d ) ) * max( abs( d ), vec3( ${EPSILON.toFixed(7)} ) ) );
  float enter, leave;
  ${beams.map(([min, max]) => `if ( suiCanopyInterval( p, inverseDirection, ${vec(min)}, ${vec(max)}, end, enter, leave ) ) return true;`).join('\n  ')}
  if ( ! suiCanopyInterval( p, inverseDirection, ${vec(l.min)}, ${vec(l.max)}, end, enter, leave ) ) return false;
  float x0 = p.x + d.x * enter, x1 = p.x + d.x * leave;
  float low = ( min( x0, x1 ) - ${l.min[0]} ) / ${l.spacing};
  float high = ( max( x0, x1 ) - ${l.min[0]} ) / ${l.spacing};
  return ceil( low - ${l.width} / ${l.spacing} ) <= floor( high );
}
`;
