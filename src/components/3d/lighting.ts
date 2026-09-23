import * as THREE from 'three';
import type { AmbientEnv } from '../../hooks/useAudioEngine';

// AgX view exposure (stops) of the source Daylight and Blue hour scenes.
const DAY_EXPOSURE = .15, EVENING_EXPOSURE = .55;
export type LightingMode = 'auto' | 'day' | 'evening';

// Each round follows the same afternoon-to-evening progression.
export function eveningAmount(mode: LightingMode, stage: AmbientEnv): number {
  return mode === 'evening' ? 1 : mode === 'day' ? 0 : { sauna: 0, water: .5, totonou: 1 }[stage];
}

export function createLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  // Cycles renders the courtyard without mist, so distant trees keep their color.
  const sky = new THREE.Color();
  scene.background = sky;
  const ambient = new THREE.HemisphereLight('#dceaff', '#826044', .9);
  const sun = new THREE.DirectionalLight('#fff1d5', 5.5);
  sun.shadow.camera.left = -14; sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 14; sun.shadow.camera.bottom = -14;
  sun.shadow.camera.near = .1; sun.shadow.camera.far = 60;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -.00015;
  sun.shadow.normalBias = .035;
  sun.shadow.autoUpdate = false;
  const warmth = new THREE.PointLight('#ffb96a', 10, 9, 2);
  warmth.position.set(-3.2, 2.9, -2.7);
  scene.add(ambient, sun, warmth);
  // Displayed sky pixels of the Daylight (07.png) and Blue hour (06.png) Cycles renders.
  const daySky = new THREE.Color('#4f616c'), duskSky = new THREE.Color('#283d54');
  const dayAmbient = new THREE.Color('#dceaff'), duskAmbient = new THREE.Color('#a6b9ee');
  const daySun = new THREE.Color('#fff1d5'), duskSun = new THREE.Color('#ffb477');
  let current = 0;
  let shadowAmount = NaN;
  return {
    setShadowSize(size: number) {
      sun.castShadow = size > 0;
      if (size) sun.shadow.mapSize.setScalar(size);
      else { sun.shadow.dispose(); sun.shadow.map = null; sun.shadow.mapPass = null; }
      sun.shadow.needsUpdate = true;
    },
    dispose() { sun.shadow.dispose(); },
    update(target: number, delta: number, immediate: boolean) {
      // Exponential smoothing is independent of frame rate; reduced motion snaps.
      current = immediate ? target : THREE.MathUtils.lerp(current, target, 1 - Math.exp(-delta / 1.4));
      sky.copy(daySky).lerp(duskSky, current);
      ambient.color.copy(dayAmbient).lerp(duskAmbient, current);
      // The hemisphere light is unshadowed and brightens the sauna interior, so the sun carries
      // the contrast the Cycles area lights give. Balanced against the Cycles camera renders.
      ambient.intensity = THREE.MathUtils.lerp(.9, .4, current);
      sun.color.copy(daySun).lerp(duskSun, current);
      sun.intensity = THREE.MathUtils.lerp(5.5, .7, current);
      // Quantize only the sun direction so the cached shadow always matches it.
      // Shadow rendering settles completely when the light stops changing.
      const nextShadowAmount = Math.round(current * 100) / 100;
      if (nextShadowAmount !== shadowAmount) {
        shadowAmount = nextShadowAmount;
        sun.position.set(-3 - shadowAmount * 5, 10 - shadowAmount * 7, 4).multiplyScalar(2);
        sun.shadow.needsUpdate = true;
      }
      warmth.intensity = THREE.MathUtils.lerp(10, 25, current);
      renderer.toneMappingExposure = 2 ** THREE.MathUtils.lerp(DAY_EXPOSURE, EVENING_EXPOSURE, current);
    },
  };
}
