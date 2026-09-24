import * as THREE from 'three';
import type { AmbientEnv } from '../../hooks/useAudioEngine';
import { directionalPenumbra, spotPenumbra } from './softShadows';
import { createInteriorLights } from './interiorLights';
import { createIrradianceUniforms } from './irradiance';

// The source sun (both scenes) is invisible to glossy rays: it lights the diffuse layer (still
// reduced by the specular Fresnel) but draws no highlights. Its browser specular doubled the
// sunlit deck of camera 07. The sun is the only directional light.
const DIRECTIONAL_START = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const DIRECT_CALL =
  'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
export const SUN_DIFFUSE_ONLY = 'reflectedLight.directSpecular = suiSpecularBeforeSun;';
const begin = THREE.ShaderChunk.lights_fragment_begin;
if (!begin.includes(SUN_DIFFUSE_ONLY)) {
  const start = begin.indexOf(DIRECTIONAL_START);
  const call = start < 0 ? -1 : begin.indexOf(DIRECT_CALL, start);
  // three 0.186 is pinned; a changed chunk fails loudly instead of giving the sun highlights.
  if (call < 0 || begin.indexOf('#pragma unroll_loop_end', start) < call)
    throw new Error('three lighting chunks changed; update lighting.ts');
  THREE.ShaderChunk.lights_fragment_begin =
    begin.slice(0, call) +
    `vec3 suiSpecularBeforeSun = reflectedLight.directSpecular;\n\t\t${DIRECT_CALL}\n\t\t${SUN_DIFFUSE_ONLY}` +
    begin.slice(call + DIRECT_CALL.length);
}

// Every spot light here stands for a Lambertian disk of the source (P/π candela on the axis), so
// its falloff is the exact cosine: a linear ramp between the 90° cone and the axis (penumbra 1).
// three's smoothstep gave half the Cycles light 70–90° off the axis (the lawn and deck grazed by
// the maple uplight) and up to 1.25x within 45° (V9 on the plunge).
const SPOT_SMOOTHSTEP = 'return smoothstep( coneCosine, penumbraCosine, angleCosine );';
export const SPOT_COSINE = 'return saturate( ( angleCosine - coneCosine ) / ( penumbraCosine - coneCosine ) );';
const pars = THREE.ShaderChunk.lights_pars_begin;
if (!pars.includes(SPOT_COSINE)) {
  if (pars.split(SPOT_SMOOTHSTEP).length !== 2) throw new Error('three lighting chunks changed; update lighting.ts');
  THREE.ShaderChunk.lights_pars_begin = pars.replace(SPOT_SMOOTHSTEP, SPOT_COSINE);
}

// AgX view exposure (stops) of the source Daylight and Blue hour scenes.
const DAY_EXPOSURE = 0.15,
  EVENING_EXPOSURE = 0.55;
export type LightingMode = 'auto' | 'day' | 'evening';

// Each round follows the same afternoon-to-evening progression.
export function eveningAmount(mode: LightingMode, stage: AmbientEnv): number {
  return mode === 'evening' ? 1 : mode === 'day' ? 0 : { sauna: 0, water: 0.5, totonou: 1 }[stage];
}

export function createLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  // Cycles renders the courtyard without mist, so distant trees keep their color.
  const sky = new THREE.Color();
  scene.background = sky;
  // Sky, the remaining Cycles area lights and all bounce light, baked per scene (irradiance.ts).
  const irradiance = createIrradianceUniforms();
  const sun = new THREE.DirectionalLight('#fff1d5', 5.5);
  // Covers the garden and the slope the Cycles cameras see; beyond it everything was sunlit.
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 110;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.035;
  // Penumbra of the source sun's 0.085 rad disk (see softShadows.ts).
  sun.shadow.radius = directionalPenumbra(sun.shadow.camera, 0.085);
  sun.shadow.autoUpdate = false;
  // The sauna room's source area lights, confined to the room (see interiorLights.ts). They keep
  // the same power in both source scenes.
  const interior = createInteriorLights();
  // Cycles 'V9 lounge patch of sunlight': a 950 W, 1.25 m disk above the lounge and plunge.
  // A Lambertian disk emits P/π candela on its axis with a cosine falloff (a 90° cone with full
  // penumbra, see SPOT_COSINE). Its shadow is static, so it renders once per shadow size.
  const lounge = new THREE.SpotLight(
    new THREE.Color().setRGB(1, 0.84, 0.62, THREE.LinearSRGBColorSpace),
    0,
    0,
    Math.PI / 2,
    1,
    2,
  );
  // A 180° shadow frustum is impossible; 144° covers the lit courtyard.
  lounge.shadow.focus = 0.8;
  lounge.position.set(3.8, 6.8, 1.5);
  lounge.target.position.set(3.8 + 0.13 * 7.4, 6.8 - 0.9176 * 7.4, 1.5 - 0.3757 * 7.4);
  lounge.shadow.camera.near = 1;
  lounge.shadow.camera.far = 20;
  lounge.shadow.bias = -0.0004;
  lounge.shadow.normalBias = 0.03;
  // Penumbra of the 1.25 m disk (see softShadows.ts).
  lounge.shadow.radius = spotPenumbra(1, 20, 144, 1.25);
  lounge.shadow.autoUpdate = false;
  // Blue-hour accent lights of the source (Blender W, position, direction in glTF axes), all
  // 180° spread disks: P/π candela on the axis with a cosine falloff (SPOT_COSINE). The Daylight
  // scene keeps them near zero.
  const duskColor = new THREE.Color().setRGB(1, 0.7, 0.39, THREE.LinearSRGBColorSpace);
  const dusk = (
    [
      // 'V10 lounge dusk fill': 2 m disk over the loungers.
      [42, [5.9, 2.8, 1.4], [-0.3142, -0.6569, -0.6854]],
      // 'V10 path grazing light 1/4/7': low disks beside the stepping stones.
      [8, [-0.9754, -0.1338, 8.89], [0.9661, -0.1255, -0.2258]],
      [8, [-0.7056, -0.0702, 7.06], [0.9661, -0.1255, -0.2258]],
      [8, [-1.2998, -0.0486, 5.23], [0.9661, -0.1255, -0.2258]],
      // 'V10 specimen uplight' under the garden maple.
      [35, [0.5, 0.04, 5.7], [0.3186, 0.9344, 0.1593]],
    ] as const
  ).map(([watts, position, direction]) => {
    const light = new THREE.SpotLight(duskColor, 0, 0, Math.PI / 2, 1, 2);
    light.position.fromArray(position);
    light.target.position.fromArray(direction).add(light.position);
    light.userData.candela = watts / Math.PI;
    return light;
  });
  // The lounge fill is below/among the pergola beams: cache their occlusion instead of
  // letting its direct light pass through them.
  const duskLounge = dusk[0];
  duskLounge.shadow.focus = 0.8;
  duskLounge.shadow.camera.near = 0.1;
  duskLounge.shadow.camera.far = 20;
  duskLounge.shadow.bias = -0.0001;
  duskLounge.shadow.normalBias = 0.015;
  duskLounge.shadow.radius = spotPenumbra(0.1, 20, 144, 2);
  duskLounge.shadow.autoUpdate = false;
  // The maple uplight must not shine through the trunk and canopy. The source is a 0.6 m
  // disk; its center-based shadow is an approximation of the disk's visibility.
  const maple = dusk[4];
  maple.shadow.focus = 0.8;
  maple.shadow.camera.near = 0.1;
  maple.shadow.camera.far = 20;
  maple.shadow.bias = -0.0001;
  maple.shadow.normalBias = 0.015;
  maple.shadow.radius = spotPenumbra(0.1, 20, 144, 0.6);
  maple.shadow.autoUpdate = false;
  const shadowLights = [sun, lounge, duskLounge, maple];
  scene.add(sun, ...interior, lounge, lounge.target);
  for (const light of dusk) scene.add(light, light.target);
  // Both source scenes light the courtyard along the 'Late afternoon sunlight' direction; the
  // Blue hour one is a faint blue 0.045. A fixed direction keeps the cached shadow valid.
  sun.position.set(-0.556, 0.6178, 0.556).multiplyScalar(50);
  // Displayed sky pixels of the Daylight (07.png) and Blue hour (06.png) Cycles renders.
  const daySky = new THREE.Color('#4f616c'),
    duskSky = new THREE.Color('#283d54');
  const daySun = new THREE.Color('#fff1d5'),
    duskSun = new THREE.Color().setRGB(0.47, 0.62, 1, THREE.LinearSRGBColorSpace);
  let current = 0;
  return {
    irradiance,
    setShadowSize(size: number) {
      for (const light of shadowLights) {
        light.castShadow = size > 0;
        if (size) light.shadow.mapSize.setScalar(size);
        else {
          light.shadow.dispose();
          light.shadow.map = null;
          light.shadow.mapPass = null;
        }
        light.shadow.needsUpdate = true;
      }
    },
    // Light count is part of every shader, so this recompiles; only the quality setting calls it.
    setDuskLights(enabled: boolean) {
      for (const light of dusk) light.visible = enabled;
    },
    dispose() {
      for (const light of shadowLights) light.shadow.dispose();
    },
    update(target: number, delta: number, immediate: boolean) {
      // Exponential smoothing is independent of frame rate; reduced motion snaps.
      current = immediate ? target : THREE.MathUtils.lerp(current, target, 1 - Math.exp(-delta / 1.4));
      sky.copy(daySky).lerp(duskSky, current);
      // Every light uses the source values of each scene; the probes mix the two bakes.
      irradiance.suiIrradianceEvening.value = current;
      sun.color.copy(daySun).lerp(duskSun, current);
      sun.intensity = THREE.MathUtils.lerp(3.2, 0.045, current);
      lounge.intensity = THREE.MathUtils.lerp(950 / Math.PI, 0, current);
      for (const light of dusk) light.intensity = light.userData.candela * current;
      renderer.toneMappingExposure = 2 ** THREE.MathUtils.lerp(DAY_EXPOSURE, EVENING_EXPOSURE, current);
    },
  };
}
