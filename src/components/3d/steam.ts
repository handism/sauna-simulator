import * as THREE from 'three';

const PLUME_BASE_Y = -0.32;
const PLUME_HEIGHT = 2.18;

// Keep the complete particle shape still when reduced motion is requested.
// Opacity and the six-second lifetime are controlled by the scene.
export function updateSteamPositions(positions: Float32Array, age: number, reducedMotion: boolean) {
  const count = positions.length / 3;
  const time = reducedMotion ? 0 : age;
  // At the start of a normal puff the steam surges up from the stones; reduced motion holds the full plume.
  const reach = reducedMotion ? 1 : 0.36 + 0.64 * (1 - Math.exp(-Math.max(0, age) * 1.45));
  const clusters = 9;
  for (let i = 0; i < count; i++) {
    const cluster = i % clusters;
    const member = Math.floor(i / clusters);
    const radialSeed = (i * 0.61803398875) % 1;
    const waveSeed = (i * 0.38196601125) % 1;
    const speedSeed = (i * 0.7548776662) % 1;
    const azimuth0 = i * 2.39996323;

    // Group particles into rising convective billows with wispy trails between them.
    const clusterBase = (cluster + 0.5) / clusters;
    const memberJitter = ((member * 0.61803398875) % 1) - 0.5;
    const u = (((clusterBase + memberJitter * 0.1) % 1) + 1) % 1;
    const speed = 0.25 + 0.05 * ((cluster * 0.61803398875) % 1) + 0.03 * speedSeed;
    const phase = (((u + time * speed) % 1) + 1) % 1;

    // Power > 1 keeps dense vapor nestled among the hot stones where water flashes to steam.
    const heightFrac = Math.pow(phase, 1.32) * reach;
    const rise = PLUME_BASE_Y + heightFrac * PLUME_HEIGHT;

    // Cluster center spirals and meanders horizontally so rising puffs form distinct curling lobes.
    const clusterAngle = cluster * 2.39996323 + heightFrac * 2.2 * (((cluster * 0.381966) % 1) - 0.5) + time * 0.32;
    const clusterOffset = (0.045 + heightFrac * 0.31) * (0.4 + 0.6 * ((cluster * 0.754877) % 1));
    const rFrac = Math.sqrt(radialSeed);
    const localRadius = (0.02 + 0.14 * rFrac) * (1 + heightFrac * 1.35 + heightFrac * heightFrac * 0.55);
    const swirl = azimuth0 + heightFrac * 2.1 * (waveSeed - 0.5) + time * 0.55 * (speedSeed - 0.5);
    const eddyPhase = heightFrac * 6.8 + waveSeed * 6.2831853 - time * 1.4;
    const eddy = (0.022 + heightFrac * 0.13) * (0.35 + 0.65 * rFrac);

    // Gentle thermal convection toward the center of the sauna room as the plume approaches the ceiling.
    const driftX = -0.17 * heightFrac * heightFrac;
    const driftZ = -0.13 * heightFrac * heightFrac;

    positions[i * 3] =
      Math.sin(clusterAngle) * clusterOffset + Math.sin(swirl) * localRadius + Math.sin(eddyPhase) * eddy + driftX;
    positions[i * 3 + 1] = rise;
    positions[i * 3 + 2] =
      Math.cos(clusterAngle) * clusterOffset +
      Math.cos(swirl) * localRadius +
      Math.cos(eddyPhase * 0.87 + 1.1) * eddy +
      driftZ;
  }
}

const PARTICLES = 160;
export const LIFETIME_SECONDS = 6;
const PEAK_OPACITY = 0.24;

const STEAM_NOISE_GLSL = /* glsl */ `
float suiSteamHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float suiSteamValueNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( suiSteamHash( i ), suiSteamHash( i + vec2( 1.0, 0.0 ) ), u.x ),
		mix( suiSteamHash( i + vec2( 0.0, 1.0 ) ), suiSteamHash( i + vec2( 1.0, 1.0 ) ), u.x ),
		u.y
	);
}
float suiSteamFbm( vec2 p ) {
	float v = 0.54 * suiSteamValueNoise( p );
	p = mat2( 1.6, -1.2, 1.2, 1.6 ) * p + vec2( 1.7, 9.2 );
	v += 0.30 * suiSteamValueNoise( p );
	p = mat2( 1.6, -1.2, 1.2, 1.6 ) * p + vec2( 8.3, 2.8 );
	v += 0.16 * suiSteamValueNoise( p );
	return v;
}
`;

/**
 * The löyly's puff of steam above the stove: a six-second rise from each `start`. It stays visible
 * until the first `update` or `stop`, so the scene's compile includes its program.
 */
export function createSteam() {
  const positions = new Float32Array(PARTICLES * 3);
  const seeds = new Float32Array(PARTICLES * 4);
  for (let i = 0; i < PARTICLES; i++) {
    const u = (i + 0.5) / PARTICLES;
    const rFrac = Math.sqrt((i * 0.61803398875) % 1);
    const angle = (i * 2.39996323) % (Math.PI * 2);
    // Mix fuller core billows with smaller curling edge wisps for visible vapor texture.
    const isWisp = i % 3 === 0;
    const scale = isWisp ? 0.56 + 0.28 * ((i * 0.38196601125) % 1) : 0.85 + 0.52 * ((i * 0.38196601125) % 1);
    seeds.set([u, rFrac, angle, scale], i * 4);
  }
  updateSteamPositions(positions, 0, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSteamSeed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), 2.5);

  const puff = document.createElement('canvas');
  puff.width = puff.height = 64;
  const ctx = puff.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);

  const uniforms = {
    uSteamTime: { value: 0 },
    uSteamAge: { value: 3 },
  };

  const material = new THREE.PointsMaterial({
    color: '#eff4f5',
    size: 0.48,
    map: new THREE.CanvasTexture(puff),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });

  material.customProgramCacheKey = () => 'sui-steam-v4';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSteamTime = uniforms.uSteamTime;
    shader.uniforms.uSteamAge = uniforms.uSteamAge;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec4 aSteamSeed;
uniform float uSteamTime;
uniform float uSteamAge;
varying float vSteamAlpha;
varying float vSteamHeight;
varying float vSteamRadial;
varying vec2 vSteamRot;
varying vec2 vSteamSeed;`,
      )
      .replace(
        'gl_PointSize = size;',
        /* glsl */ `float suiHeight = clamp( ( position.y - ${PLUME_BASE_Y.toFixed(4)} ) / ${PLUME_HEIGHT.toFixed(4)}, 0.0, 1.0 );
	// Emerge compactly right among the stones, then billow wider as the vapor rises.
	gl_PointSize = size * aSteamSeed.w * mix( 0.42, 1.48, smoothstep( 0.0, 0.82, suiHeight ) );
	float suiBottomFade = smoothstep( 0.0, 0.04, suiHeight );
	float suiTopFade = 1.0 - smoothstep( 0.50, 0.98, suiHeight );
	float suiTailLift = smoothstep( 0.0, 0.30, suiHeight - max( 0.0, uSteamAge - 3.8 ) * 0.17 );
	float suiRadialWeight = mix( 1.25, 0.64, aSteamSeed.y );
	float suiBurstBoost = 1.0 + 0.48 * exp( - max( 0.0, uSteamAge - 0.55 ) * 1.25 ) * smoothstep( 0.0, 0.25, uSteamAge );
	vSteamAlpha = suiBottomFade * suiTopFade * suiTailLift * suiRadialWeight * suiBurstBoost;
	vSteamHeight = suiHeight;
	vSteamRadial = aSteamSeed.y;
	float suiSpinDir = fract( aSteamSeed.x * 37.0 ) > 0.5 ? 1.0 : - 1.0;
	float suiAngle = aSteamSeed.z + suiSpinDir * ( suiHeight * 2.0 + uSteamTime * 0.40 );
	vSteamRot = vec2( cos( suiAngle ), sin( suiAngle ) );
	vSteamSeed = aSteamSeed.xz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uSteamTime;
varying float vSteamAlpha;
varying float vSteamHeight;
varying float vSteamRadial;
varying vec2 vSteamRot;
varying vec2 vSteamSeed;
${STEAM_NOISE_GLSL}`,
      )
      .replace(
        '#include <map_particle_fragment>',
        /* glsl */ `#include <map_particle_fragment>
	vec2 suiCentered = gl_PointCoord * 2.0 - 1.0;
	float suiDist2 = dot( suiCentered, suiCentered );
	if ( suiDist2 >= 1.0 ) discard;
	vec2 suiRotP = vec2(
		suiCentered.x * vSteamRot.x - suiCentered.y * vSteamRot.y,
		suiCentered.x * vSteamRot.y + suiCentered.y * vSteamRot.x
	);
	vec2 suiNoiseUv = suiRotP * 2.25 + vSteamSeed * 15.3 + vec2( 0.0, - uSteamTime * 0.38 );
	float suiWarp = suiSteamFbm( suiNoiseUv );
	float suiBillow = suiSteamFbm( suiNoiseUv * 1.95 + vec2( suiWarp * 1.75 - 0.85, - suiWarp * 1.45 + 0.65 ) );
	float suiFilaments = smoothstep( 0.24, 0.68, suiBillow ) * ( 0.45 + 0.55 * smoothstep( 0.32, 0.76, suiWarp ) );
	// Perturb the boundary strongly so individual puffs curl into organic vapor tendrils rather than round discs.
	float suiEdgeRadius = sqrt( suiDist2 ) + ( 0.54 - suiBillow ) * 0.48 + ( 0.50 - suiWarp ) * 0.22;
	float suiMask = 1.0 - smoothstep( 0.08, 0.86, suiEdgeRadius );
	float suiCloudShape = suiMask * mix( 0.35, 1.32, suiFilaments );
	// 3D billow relief: backlit upper-right crest, warm amber glow from the hot stones below, and soft inner fold.
	float suiCrest = clamp( ( - suiCentered.y * 0.78 + suiCentered.x * 0.42 ) * 0.5 + 0.5, 0.0, 1.0 );
	float suiStoneGlow = ( 1.0 - smoothstep( 0.0, 0.45, vSteamHeight ) ) * smoothstep( - 0.45, 0.65, suiCentered.y );
	float suiRimScatter = smoothstep( 0.16, 0.76, suiEdgeRadius ) * suiCrest;
	vec3 suiWarmBase = vec3( 1.06, 0.78, 0.48 );
	vec3 suiBacklitCrest = vec3( 1.04, 0.96, 0.86 );
	vec3 suiCoreShade = vec3( 0.74, 0.78, 0.82 );
	vec3 suiMistBody = mix( suiCoreShade, diffuseColor.rgb * 1.07, smoothstep( 0.22, 0.78, suiBillow * 0.62 + suiCrest * 0.38 ) );
	diffuseColor.rgb = mix( suiMistBody, suiBacklitCrest, suiRimScatter * 0.58 );
	diffuseColor.rgb = mix( diffuseColor.rgb, suiWarmBase, suiStoneGlow * 0.68 );
	diffuseColor.a = opacity * vSteamAlpha * suiCloudShape;`,
      );
  };

  const points = new THREE.Points(geometry, material);
  let started = -Infinity;
  let lastNow = -Infinity;
  let carryOpacity = 0;
  let flowTime = 0;
  return {
    points,
    /** Starts a puff at `now` (performance.now() milliseconds). */
    start(now: number) {
      if (now > started && now - started < LIFETIME_SECONDS * 1000) {
        const prevAge = (now - started) / 1000;
        carryOpacity = Math.max(
          carryOpacity * Math.exp(-prevAge * 0.9),
          PEAK_OPACITY * Math.sin(Math.min(1, prevAge / LIFETIME_SECONDS) * Math.PI),
        );
      } else {
        carryOpacity = 0;
      }
      started = now;
    },
    /** Ends any puff at once. */
    stop() {
      started = -Infinity;
      lastNow = -Infinity;
      carryOpacity = 0;
      points.visible = false;
    },
    /** Shows the puff while it lasts and `active` holds (the sauna stage). */
    update(now: number, active: boolean, reducedMotion: boolean) {
      const age = (now - started) / 1000;
      points.visible = active && age >= 0 && age < LIFETIME_SECONDS;
      if (!points.visible) return;
      const dt = lastNow > -Infinity && now > lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      flowTime = carryOpacity > 0 ? flowTime + dt : age;
      const envelope = PEAK_OPACITY * Math.sin(Math.min(1, age / LIFETIME_SECONDS) * Math.PI);
      const carried = carryOpacity * Math.exp(-age * 1.1);
      material.opacity = Math.max(envelope, carried);
      uniforms.uSteamAge.value = age;
      uniforms.uSteamTime.value = reducedMotion ? 2.4 : flowTime;
      updateSteamPositions(positions, carryOpacity > 0 ? flowTime : age, reducedMotion);
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
