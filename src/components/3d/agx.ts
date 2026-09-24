import * as THREE from 'three';

// Blender 4.x forms its AgX view with a 57³ LUT over a 25-stop E-Gamut log encoding. three's
// AgXToneMapping is an earlier formulation: for the same scene-linear input it maps 18% grey to
// 0.50 instead of 0.46 and rendered the Cycles camera 02 image about 4 L* brighter. This keeps
// three's structure (matrix, log2 over [-12.47, +4.03] stops, a per-channel curve, matrix, power
// 2.4, matrix to linear Rec.709) with constants fitted to Blender's OCIO transform by
// scripts/fit_blender_agx.py: held-out display error mean 0.00105, 99th percentile 0.01271 (the
// largest errors are saturated colors near the gamut edge), greys within 0.003.

// Columns, as GLSL mat3 arguments.
export const AGX_INSET = [
  [0.3442168, 0.0703652, 0.0564098],
  [0.197235, 0.4568419, 0.1155636],
  [0.0568873, 0.0716971, 0.4279824],
];
export const AGX_OUTSET = [
  [0.9345885, 0.0216478, 0.0002959],
  [0.021601, 0.8814323, 0.0202587],
  [-0.0033396, -0.0271871, 1.1180483],
];
export const AGX_TO_709 = [
  [1.008257, -0.1310528, -0.099401],
  [-0.4652626, 0.8353469, -0.1946355],
  [-0.0584589, -0.0084817, 0.5197809],
];
export const AGX_CURVE = [
  0.007249, 0.019341, 0.028537, 0.03917, 0.051489, 0.065487, 0.081668, 0.100314, 0.12204, 0.147431, 0.177433, 0.212651,
  0.255191, 0.305979, 0.366897, 0.439, 0.52428, 0.621993, 0.725513, 0.823997, 0.912355, 0.991313, 1.059548, 1.118682,
  1.170604, 1.21531, 1.253959, 1.287992, 1.317252, 1.342989, 1.364353, 1.392348,
];
export const AGX_MIN_EV = -12.47393,
  AGX_MAX_EV = 4.026069;

const mul = (m: number[][], v: number[]) => [0, 1, 2].map((r) => m[0][r] * v[0] + m[1][r] * v[1] + m[2][r] * v[2]);

/** The tone mapping in linear Rec.709 for a scene-linear color, as the shader evaluates it. */
export function agx(color: number[], exposure = 1): number[] {
  const n = AGX_CURVE.length - 1;
  const curve = (x: number) => {
    const u = Math.min(Math.max((Math.log2(Math.max(x, 2 ** -24)) - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV), 0), 1) * n;
    const i = Math.min(Math.floor(u), n - 1);
    return AGX_CURVE[i] + (AGX_CURVE[i + 1] - AGX_CURVE[i]) * (u - i);
  };
  const formed = mul(
    AGX_OUTSET,
    mul(
      AGX_INSET,
      color.map((c) => c * exposure),
    ).map(curve),
  );
  return mul(
    AGX_TO_709,
    formed.map((c) => Math.max(c, 0) ** 2.4),
  ).map((c) => Math.min(Math.max(c, 0), 1));
}

/**
 * The scene-linear color that agx() maps to a displayed color (linear Rec.709, inside the view's
 * gamut), for exposures of the output pass. Newton's method in log2 space with a numeric Jacobian.
 */
export function agxInverse(display: number[], exposure = 1): number[] {
  const residual = (u: number[]) =>
    agx(
      u.map((v) => 2 ** v),
      exposure,
    ).map((c, i) => c - display[i]);
  let u = [0, 1, 2].map(() => Math.log2(0.18 / exposure));
  for (let iteration = 0; iteration < 40; iteration++) {
    const r = residual(u);
    if (Math.max(...r.map(Math.abs)) < 1e-7) break;
    // Columns of the Jacobian.
    const j = [0, 1, 2].map((k) => {
      const step = u.map((v, i) => (i === k ? v + 1e-4 : v));
      return residual(step).map((c, i) => (c - r[i]) / 1e-4);
    });
    const det = (a: number[], b: number[], c: number[]) =>
      a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
    const d = det(j[0], j[1], j[2]);
    // Cramer's rule; steps are limited to two stops.
    const delta = [det(r, j[1], j[2]), det(j[0], r, j[2]), det(j[0], j[1], r)].map((v) =>
      Math.min(Math.max(v / d, -2), 2),
    );
    u = u.map((v, i) => v - delta[i]);
  }
  return u.map((v) => 2 ** v);
}

const glslMat = (m: number[][]) => `mat3( ${m.map((c) => `vec3( ${c.join(', ')} )`).join(', ')} )`;
const shader = /* glsl */ `vec3 AgXToneMapping( vec3 color ) {
	const float curve[ ${AGX_CURVE.length} ] = float[]( ${AGX_CURVE.map((v) => v.toFixed(6)).join(', ')} );
	color = ${glslMat(AGX_INSET)} * ( color * toneMappingExposure );
	color = clamp( ( log2( max( color, 5.96e-8 ) ) - ( ${AGX_MIN_EV} ) ) / ${(AGX_MAX_EV - AGX_MIN_EV).toFixed(6)}, 0.0, 1.0 ) * ${(AGX_CURVE.length - 1).toFixed(1)};
	ivec3 i = min( ivec3( color ), ivec3( ${AGX_CURVE.length - 2} ) );
	color = mix( vec3( curve[ i.x ], curve[ i.y ], curve[ i.z ] ), vec3( curve[ i.x + 1 ], curve[ i.y + 1 ], curve[ i.z + 1 ] ), color - vec3( i ) );
	color = ${glslMat(AGX_OUTSET)} * color;
	return clamp( ${glslMat(AGX_TO_709)} * pow( max( color, 0.0 ), vec3( 2.4 ) ), 0.0, 1.0 );
}
`;

// Replaces three's AgX function in the shared chunk (three 0.186 is pinned); a changed chunk
// fails loudly instead of silently keeping the other curve.
const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
const start = chunk.indexOf('vec3 AgXToneMapping( vec3 color ) {');
const end = chunk.indexOf('vec3 NeutralToneMapping(');
if (!chunk.includes('float curve[')) {
  if (start < 0 || end < start) throw new Error('three tonemapping_pars_fragment changed; update agx.ts');
  THREE.ShaderChunk.tonemapping_pars_fragment = chunk.slice(0, start) + shader + chunk.slice(end);
}
