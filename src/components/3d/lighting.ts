import * as THREE from 'three';
import type { AmbientEnv } from '../../hooks/useAudioEngine';

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
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.035;
  sun.shadow.autoUpdate = false;
  const warmth = new THREE.PointLight('#ffb96a', 10, 9, 2);
  warmth.position.set(-3.2, 2.9, -2.7);
  // Cycles 'V9 lounge patch of sunlight': a 950 W, 1.25 m disk above the lounge and plunge.
  // A Lambertian disk emits P/π candela on its axis; the full-penumbra 60° cone approximates
  // its cosine falloff. Its shadow is static, so it renders once per shadow size.
  const lounge = new THREE.SpotLight(
    new THREE.Color().setRGB(1, 0.84, 0.62, THREE.LinearSRGBColorSpace),
    0,
    0,
    Math.PI / 3,
    1,
    2,
  );
  lounge.position.set(3.8, 6.8, 1.5);
  lounge.target.position.set(3.8 + 0.13 * 7.4, 6.8 - 0.9176 * 7.4, 1.5 - 0.3757 * 7.4);
  lounge.shadow.camera.near = 1;
  lounge.shadow.camera.far = 20;
  lounge.shadow.bias = -0.0004;
  lounge.shadow.normalBias = 0.03;
  // Softens the edge toward the wide penumbra of the 1.25 m source.
  lounge.shadow.radius = 4;
  lounge.shadow.autoUpdate = false;
  scene.add(ambient, sun, warmth, lounge, lounge.target);
  // Sun direction of the Daylight scene's 'Late afternoon sunlight', and the earlier evening sun.
  const daySunPosition = new THREE.Vector3(-0.556, 0.6178, 0.556).multiplyScalar(20),
    duskSunPosition = new THREE.Vector3(-16, 6, 8);
  // Displayed sky pixels of the Daylight (07.png) and Blue hour (06.png) Cycles renders.
  const daySky = new THREE.Color('#4f616c'),
    duskSky = new THREE.Color('#283d54');
  const dayAmbient = new THREE.Color('#dceaff'),
    duskAmbient = new THREE.Color('#a6b9ee');
  const daySun = new THREE.Color('#fff1d5'),
    duskSun = new THREE.Color('#ffb477');
  let current = 0;
  let shadowAmount = NaN;
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
      // light; only it is balanced against the Cycles camera renders. The daytime sun and lounge
      // light use the source values; the Blue hour scene has no lounge light.
      ambient.intensity = THREE.MathUtils.lerp(0.7, 0.4, current);
      sun.color.copy(daySun).lerp(duskSun, current);
      sun.intensity = THREE.MathUtils.lerp(3.2, 0.7, current);
      lounge.intensity = THREE.MathUtils.lerp(950 / Math.PI, 0, current);
      // Quantize only the sun direction so the cached shadow always matches it.
      // Shadow rendering settles completely when the light stops changing.
      const nextShadowAmount = Math.round(current * 100) / 100;
      if (nextShadowAmount !== shadowAmount) {
        shadowAmount = nextShadowAmount;
        sun.position.lerpVectors(daySunPosition, duskSunPosition, shadowAmount);
        sun.shadow.needsUpdate = true;
      }
      warmth.intensity = THREE.MathUtils.lerp(10, 25, current);
      renderer.toneMappingExposure = 2 ** THREE.MathUtils.lerp(DAY_EXPOSURE, EVENING_EXPOSURE, current);
    },
  };
}
