import * as THREE from 'three';
import type { AmbientEnv } from '../../hooks/useAudioEngine';
import { directionalPenumbra, spotPenumbra } from './softShadows';

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
  const ambient = new THREE.HemisphereLight('#dceaff', '#826044', 0.9);
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
  // Stands in for the sauna interior lights, which keep the same power in both source scenes.
  const warmth = new THREE.PointLight('#ffb96a', 10, 9, 2);
  warmth.position.set(-3.2, 2.9, -2.7);
  // Cycles 'V9 lounge patch of sunlight': a 950 W, 1.25 m disk above the lounge and plunge.
  // A Lambertian disk emits P/π candela on its axis; a 90° cone with full penumbra approximates
  // its cosine falloff (a 60° cone gave the plaster walls 35° off the axis only 0.65 of the
  // Cycles light). Its shadow is static, so it renders once per shadow size.
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
  // 180° spread disks: P/π candela on the axis, and a 90° cone with full penumbra approximates
  // the cosine falloff. Unshadowed; the Daylight scene keeps them near zero.
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
  scene.add(ambient, sun, warmth, lounge, lounge.target);
  for (const light of dusk) scene.add(light, light.target);
  // Both source scenes light the courtyard along the 'Late afternoon sunlight' direction; the
  // Blue hour one is a faint blue 0.045. A fixed direction keeps the cached shadow valid.
  sun.position.set(-0.556, 0.6178, 0.556).multiplyScalar(50);
  // Displayed sky pixels of the Daylight (07.png) and Blue hour (06.png) Cycles renders.
  const daySky = new THREE.Color('#4f616c'),
    duskSky = new THREE.Color('#283d54');
  const dayAmbient = new THREE.Color('#dceaff'),
    duskAmbient = new THREE.Color('#a6b9ee');
  const daySun = new THREE.Color('#fff1d5'),
    duskSun = new THREE.Color().setRGB(0.47, 0.62, 1, THREE.LinearSRGBColorSpace);
  let current = 0;
  return {
    setShadowSize(size: number) {
      for (const light of [sun, lounge]) {
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
      sun.shadow.dispose();
      lounge.shadow.dispose();
    },
    update(target: number, delta: number, immediate: boolean) {
      // Exponential smoothing is independent of frame rate; reduced motion snaps.
      current = immediate ? target : THREE.MathUtils.lerp(current, target, 1 - Math.exp(-delta / 1.4));
      sky.copy(daySky).lerp(duskSky, current);
      ambient.color.copy(dayAmbient).lerp(duskAmbient, current);
      // The unshadowed hemisphere light stands in for the remaining Cycles area lights and bounce
      // light; it and the interior light are balanced against the Cycles camera renders. The sun,
      // lounge and dusk accent lights use the source values of each scene.
      ambient.intensity = THREE.MathUtils.lerp(0.6, 0.45, current);
      sun.color.copy(daySun).lerp(duskSun, current);
      sun.intensity = THREE.MathUtils.lerp(3.2, 0.045, current);
      lounge.intensity = THREE.MathUtils.lerp(950 / Math.PI, 0, current);
      for (const light of dusk) light.intensity = light.userData.candela * current;
      renderer.toneMappingExposure = 2 ** THREE.MathUtils.lerp(DAY_EXPOSURE, EVENING_EXPOSURE, current);
    },
  };
}
