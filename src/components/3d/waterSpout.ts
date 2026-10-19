import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { IRRADIANCE_PARS, type IrradianceUniforms } from './irradiance';
import { REFLECTION_PARS } from './reflection';
import { seeded } from './gardenDetails';

// The spout's water: a sheet that runs out along a short bronze trough, leaves its lip level and
// falls on a parabola into the pool, with aerated foam and a few drops where it lands. The source's
// `V4 flowing spring ribbon` hangs straight down from the `Spillway fixture` (the blackened bronze
// box 0.58 × 0.075 m on the wall, front face at blender y 4.15, bottom at z 1.102) through the pool
// coping (inner edge y 4.065, top z 1.035); the trough carries it out over the coping instead.
// glTF axes: blender (x, y, z) is (x, z, −y), so the pool lies toward +z.
export const SPOUT = {
  /** glTF z of the box's front face and of the trough's lip, 10 cm out over the coping. */
  face: -4.15,
  lip: -4.05,
  /** Top of the trough's floor and of the water running on it. */
  floor: 1.104,
  film: 0.006,
  /** Outer width of the trough; its walls are 6 mm bronze, 2.6 cm above the floor. */
  width: 0.3,
  wall: 0.006,
  rim: 0.026,
  /** Speed of the water along the trough (m/s), which it leaves the lip with. */
  speed: 0.25,
};
const GRAVITY = 9.81;
/** Time the water takes from the box to the lip (it starts 1 cm inside the box). */
const RUN = (SPOUT.lip - SPOUT.face + 0.01) / SPOUT.speed;
const SHEET_HALF_WIDTH = SPOUT.width / 2 - SPOUT.wall - 0.004;

/** Seconds to fall from the lip to the pool's surface at `level`. */
export const fallTime = (level: number) => Math.sqrt((2 * (SPOUT.floor + SPOUT.film - level)) / GRAVITY);

/** The sheet's middle at time `t` after it leaves the lip (negative: still in the trough), as [y, z]. */
export function sheetPoint(t: number): [number, number] {
  const top = SPOUT.floor + SPOUT.film;
  return [t > 0 ? top - 0.5 * GRAVITY * t * t : top, SPOUT.lip + SPOUT.speed * t];
}

/** Where the sheet meets the pool's surface at `level`, as glTF z. */
export const landing = (level: number) => sheetPoint(fallTime(level))[1];

/**
 * Adds the trough under the spout's box in the box's own material, so it takes the same light,
 * reflections and shadows as the rest of the model. Before the materials are prepared. Returns
 * the meshes added (0 without the bronze).
 */
export function addSpoutTrough(root: THREE.Object3D, x: number) {
  let bronze: THREE.Material | undefined;
  root.traverse((object) => {
    if (bronze || !(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    bronze = materials.find((material) => material.name === 'Blackened bronze');
  });
  if (!bronze) return 0;
  const { face, lip, floor, width, wall, rim } = SPOUT;
  // Each part reaches 3 cm into the box, so no seam shows at its face.
  const length = lip - face + 0.03;
  const box = (w: number, h: number, cx: number, cy: number) =>
    new THREE.BoxGeometry(w, h, length).translate(cx, cy, (lip + face - 0.03) / 2);
  const geometry = mergeGeometries([
    box(width, 0.006, x, floor - 0.003),
    box(wall, rim, x - (width - wall) / 2, floor + rim / 2 - 0.006),
    box(wall, rim, x + (width - wall) / 2, floor + rim / 2 - 0.006),
  ]);
  const trough = new THREE.Mesh(geometry, bronze);
  trough.name = 'Spillway trough';
  root.add(trough);
  return 1;
}

const NOISE = /* glsl */ `
float suiSpoutHash( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}
float suiSpoutNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( suiSpoutHash( i ), suiSpoutHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( suiSpoutHash( i + vec2( 0.0, 1.0 ) ), suiSpoutHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// Distance to the nearest of one jittered point per cell (bubbles).
float suiSpoutCells( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	float d = 1.0;
	for ( int j = - 1; j <= 1; j ++ ) for ( int k = - 1; k <= 1; k ++ ) {
		vec2 o = vec2( j, k );
		d = min( d, length( o + vec2( suiSpoutHash( i + o ), suiSpoutHash( i + o + 17.0 ) ) - f ) );
	}
	return d;
}
`;

/** Segments of the sheet along the flow (trough, fall) and across it. */
const RUN_STEPS = 6;
const FALL_STEPS = 40;
const ACROSS = 14;

function sheetGeometry(x: number, level: number) {
  const end = fallTime(level);
  const positions: number[] = [];
  const normals: number[] = [];
  const tangents: number[] = [];
  const flow: number[] = [];
  const indices: number[] = [];
  const rows = RUN_STEPS + FALL_STEPS + 1;
  for (let row = 0; row < rows; row++) {
    // Denser where the sheet curls over the lip.
    const t = row <= RUN_STEPS ? -RUN * (1 - row / RUN_STEPS) : end * ((row - RUN_STEPS) / FALL_STEPS) ** 1.4;
    const [y, z] = sheetPoint(t);
    const fall = Math.max(t, 0) / end;
    // The sheet draws in a little as it falls, and its edges gather into thicker cords.
    const half = SHEET_HALF_WIDTH * (1 - 0.1 * fall);
    const tangent = new THREE.Vector3(0, -GRAVITY * Math.max(t, 0), SPOUT.speed).normalize();
    // Across is +x: the normal faces up, and forward once the sheet falls.
    const normal = new THREE.Vector3(0, tangent.z, -tangent.y);
    for (let k = 0; k <= ACROSS; k++) {
      // Closer columns toward the edges for the cords.
      const s = (k / ACROSS) * 2 - 1;
      const across = Math.sign(s) * Math.sin((Math.abs(s) * Math.PI) / 2) * half;
      positions.push(x + across, y, z);
      normals.push(normal.x, normal.y, normal.z);
      tangents.push(tangent.x, tangent.y, tangent.z);
      flow.push(across, t, fall, Math.abs(s));
    }
  }
  for (let row = 0; row < rows - 1; row++)
    for (let k = 0; k < ACROSS; k++) {
      const a = row * (ACROSS + 1) + k;
      const b = a + ACROSS + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('sheetTangent', new THREE.Float32BufferAttribute(tangents, 3));
  // x: meters across from the middle, y: seconds after the lip, z: share of the fall, w: |across| / half.
  geometry.setAttribute('sheetFlow', new THREE.Float32BufferAttribute(flow, 4));
  geometry.setIndex(indices);
  return geometry;
}

/** Drops thrown up where the sheet lands; each one rises and falls back once a period. */
const DROPS = 56;

/**
 * The falling sheet (seen in the water's mirror too), and the foam and drops at its foot (for the
 * main camera only: `mainOnly`). `probes` are the shared probe uniforms; `time` is the water's
 * (0 with reduced motion, which also hides the drops).
 */
export function createSpoutWater(x: number, level: number, probes: IrradianceUniforms, time: { value: number }) {
  const foot = landing(level);
  const end = fallTime(level);
  const sheetMaterial = new THREE.ShaderMaterial({
    name: 'spout sheet',
    defines: { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: { ...probes, time },
    vertexShader: /* glsl */ `
      attribute vec3 sheetTangent;
      attribute vec4 sheetFlow;
      uniform float time;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vTangent;
      varying vec4 vFlow;
      void main() {
        vec3 p = position;
        // A slow sway of the falling sheet, growing from nothing at the lip.
        float sway = sin( sheetFlow.x * 19.0 + ( sheetFlow.y - time ) * 7.0 ) + 0.6 * sin( time * 2.3 + sheetFlow.x * 7.0 );
        p += normal * 0.0025 * sheetFlow.z * sway;
        vec4 world = modelMatrix * vec4( p, 1.0 );
        vWorld = world.xyz;
        vNormal = normal;
        vTangent = sheetTangent;
        vFlow = sheetFlow;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `#include <common>
      ${IRRADIANCE_PARS}
      ${REFLECTION_PARS}
      ${NOISE}
      uniform float time;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying vec3 vTangent;
      varying vec4 vFlow;
      // Ripples carried down with the water: the pattern moves with the flow's time, so it
      // stretches into long streaks as the water speeds up in the fall.
      float ripple( vec2 q ) {
        return suiSpoutNoise( q ) + 0.5 * suiSpoutNoise( q * vec2( 2.1, 1.7 ) + 5.3 );
      }
      void main() {
        float fall = vFlow.z;
        float edge = vFlow.w;
        vec2 q = vec2( vFlow.x * 42.0, ( vFlow.y - time ) * 8.0 );
        float h = ripple( q );
        float hx = ripple( q + vec2( 0.25, 0.0 ) );
        float hy = ripple( q + vec2( 0.0, 0.25 ) );
        // Calm on the trough and over the lip, rougher as the sheet falls.
        float amount = mix( 0.06, 0.32, smoothstep( 0.0, 0.7, fall ) );
        // Pulses of the flow cross the sheet as bands, which stretch as it speeds up.
        float band = sin( ( vFlow.y - time ) * 45.0 + 3.0 * h );
        vec3 normal = normalize( vNormal - amount * 4.0 * ( hx - h ) * vec3( 1.0, 0.0, 0.0 ) - ( amount * 1.6 * ( hy - h ) + 0.06 * band ) * vTangent );
        vec3 view = normalize( cameraPosition - vWorld );
        if ( dot( vNormal, view ) < 0.0 ) normal = - normal;
        float facing = clamp( dot( normal, view ), 0.0, 1.0 );
        float fresnel = 0.02 + 0.98 * pow( 1.0 - facing, 5.0 );
        // Two faces of a thin sheet; the cords at the edges are round and catch more of the sky.
        float cord = smoothstep( 0.72, 0.98, edge );
        float reflectance = min( 2.0 * fresnel / ( 1.0 + fresnel ) + 0.12 * cord, 1.0 );
        vec3 reflected = suiReflection( vWorld + normal * 0.02, normal, reflect( - view, normal ), 0.03, false, false );
        // Air drawn into the water whitens the lower sheet in streaks, and the cords first.
        float streak = smoothstep( 0.45, 0.85, suiSpoutNoise( vec2( vFlow.x * 70.0, ( vFlow.y - time ) * 12.0 ) + 3.1 ) );
        float air = smoothstep( 0.3, 1.0, fall ) * ( 0.35 * streak + 0.25 * cord );
        vec3 foam = 0.8 * suiIrradiance( vWorld, normal, false, false ) / PI;
        // The sheet bends the view behind it: where it is tilted the wall shows darker, in streaks.
        float lens = min( abs( hx - h ) * 4.0 + 0.5 * abs( band ) * ( 1.0 - fall ), 1.0 );
        float body = 0.02 + 0.03 * fall + 0.07 * lens;
        float alpha = reflectance + body + air;
        vec3 color = ( reflectance * reflected + ( 0.2 + 0.4 * h ) * body * reflected + air * foam ) / alpha;
        // Near the pool the sheet tears into strands.
        float tear = smoothstep( 0.6, 1.0, fall ) * smoothstep( 0.5, 0.8, suiSpoutNoise( vec2( vFlow.x * 24.0, ( vFlow.y - time ) * 5.0 ) + 11.0 ) );
        alpha = min( alpha, 1.0 ) * ( 1.0 - 0.85 * tear ) * ( 1.0 - smoothstep( 0.94, 1.0, edge ) );
        gl_FragColor = vec4( color, alpha );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sheet = new THREE.Mesh(sheetGeometry(x, level), sheetMaterial);
  sheet.name = 'spout sheet';
  // After the pool's surface and the foam under it.
  sheet.renderOrder = 2.5;

  // Foam spreading from the line where the sheet lands, a little more toward the pool.
  const reach = new THREE.Vector2(SHEET_HALF_WIDTH + 0.07, 0.11);
  const foamMaterial = new THREE.ShaderMaterial({
    name: 'spout foam',
    defines: { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: { ...probes, time },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4( position, 1.0 );
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `#include <common>
      ${IRRADIANCE_PARS}
      ${REFLECTION_PARS}
      ${NOISE}
      uniform float time;
      varying vec3 vWorld;
      void main() {
        vec2 offset = vWorld.xz - vec2( ${x.toFixed(4)}, ${foot.toFixed(4)} );
        // Distance outside the landing line, in the foam's reach.
        vec2 d = vec2( max( abs( offset.x ) - ${(SHEET_HALF_WIDTH * 0.85).toFixed(4)}, 0.0 ), offset.y > 0.0 ? offset.y : offset.y * 1.8 );
        float r = length( d / vec2( ${(reach.x - SHEET_HALF_WIDTH * 0.85).toFixed(4)}, ${reach.y.toFixed(4)} ) );
        // Clumps of foam drift out from the line; the bubbles in them fade where they are finer
        // than a pixel.
        vec2 q = vec2( offset.x, abs( offset.y ) - time * 0.04 );
        float clumps = 0.6 * suiSpoutNoise( q * 28.0 ) + 0.4 * suiSpoutNoise( q * 70.0 + 3.0 );
        float density = 1.0 - smoothstep( 0.0, 1.0, r );
        float foam = density * smoothstep( 0.9 - density, 1.4 - density, clumps );
        float fine = 1.0 - smoothstep( 0.4, 1.0, length( fwidth( q ) ) * 150.0 );
        foam *= mix( 0.8, 0.55 + 0.45 * smoothstep( 0.15, 0.45, suiSpoutCells( q * 150.0 ) ), fine );
        // Churned white along the line itself.
        float core = 1.0 - smoothstep( 0.0, 0.35, r );
        foam = max( foam, core * ( 0.45 + 0.35 * suiSpoutNoise( vec2( offset.x * 40.0, time * 4.0 ) ) ) );
        vec3 color = 0.85 * suiIrradiance( vWorld, vec3( 0.0, 1.0, 0.0 ), false, false ) / PI;
        gl_FragColor = vec4( color, 0.8 * foam );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const foamPlane = new THREE.Mesh(new THREE.PlaneGeometry(2 * reach.x, 2.8 * reach.y), foamMaterial);
  foamPlane.name = 'spout foam';
  foamPlane.rotation.x = -Math.PI / 2;
  foamPlane.position.set(x, level + 0.0015, foot + 0.2 * reach.y);
  foamPlane.renderOrder = 2.4;

  const seeds = new Float32Array(DROPS * 4);
  const random = seeded(7);
  for (let i = 0; i < DROPS; i++) seeds.set([random() * 2 - 1, random(), random(), random()], i * 4);
  const dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPS * 3), 3));
  dropGeometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  dropGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, level, foot), 0.4);
  const dropUniforms = { ...probes, time, suiDropViewport: { value: 1 } };
  const dropMaterial = new THREE.ShaderMaterial({
    name: 'spout drops',
    defines: { SUI_IRRADIANCE: '', SUI_REFLECTION: '' },
    uniforms: dropUniforms,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float time;
      uniform float suiDropViewport;
      varying vec3 vWorld;
      varying float vFade;
      void main() {
        // Each drop leaves the landing line once a period, up to about 6 cm, and falls back.
        float period = 0.35 + 0.35 * seed.z;
        float t = fract( time / period + seed.w ) * period;
        vec2 out2 = vec2( seed.x * 0.5, 0.35 + seed.y );
        vec3 start = vec3( ${x.toFixed(4)} + seed.x * ${SHEET_HALF_WIDTH.toFixed(4)}, ${level.toFixed(4)}, ${foot.toFixed(4)} + 0.01 * ( seed.y - 0.3 ) );
        float rise = 0.55 + 0.55 * seed.y * seed.z;
        vec3 p = start + vec3( out2.x * 0.35, 0.0, out2.y * 0.3 ) * t + vec3( 0.0, rise * t - 4.905 * t * t, 0.0 );
        vWorld = p;
        vFade = step( ${level.toFixed(4)}, p.y ) * smoothstep( 0.0, 0.03, t );
        vec4 view = viewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * view;
        // 3–5 mm drops; under 1.5 pixels they stay that size and fade, keeping their light.
        float size = ( 0.003 + 0.002 * seed.z ) * projectionMatrix[ 1 ][ 1 ] * suiDropViewport * 0.5 / - view.z;
        vFade *= min( size / 1.5, 1.0 );
        gl_PointSize = max( size, 1.5 );
      }`,
    fragmentShader: /* glsl */ `#include <common>
      ${IRRADIANCE_PARS}
      ${REFLECTION_PARS}
      varying vec3 vWorld;
      varying float vFade;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot( c, c );
        if ( r2 > 1.0 || vFade <= 0.0 ) discard;
        // A clear drop shows the sky over it and a highlight.
        vec3 sky = suiReflection( vWorld, vec3( 0.0, 1.0, 0.0 ), vec3( 0.0, 1.0, 0.0 ), 0.2, false, false );
        gl_FragColor = vec4( sky * ( 0.6 + 0.8 * ( 1.0 - r2 ) ), vFade * ( 1.0 - r2 ) * 0.6 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
  const drops = new THREE.Points(dropGeometry, dropMaterial);
  drops.name = 'spout drops';
  drops.renderOrder = 2.6;
  const viewport = new THREE.Vector4();
  drops.onBeforeRender = (renderer) => {
    dropUniforms.suiDropViewport.value = Math.max(1, renderer.getCurrentViewport(viewport).w);
  };
  return {
    sheet,
    /** Seen by the main camera only: the mirror would redraw every frame for them. */
    mainOnly: [foamPlane, drops] as THREE.Object3D[],
    /** Where the sheet lands (glTF x, z) and how long it falls. */
    foot: [x, foot] as const,
    fallSeconds: end,
    update(reducedMotion: boolean) {
      drops.visible = !reducedMotion;
    },
  };
}
