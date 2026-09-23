import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createLighting, eveningAmount } from './lighting';

describe('3D lighting', () => {
  it('repeats the automatic progression and honors fixed choices in every stage', () => {
    expect(
      ['sauna', 'water', 'totonou', 'sauna'].map((stage) =>
        eveningAmount('auto', stage as 'sauna' | 'water' | 'totonou'),
      ),
    ).toEqual([0, 0.5, 1, 0]);
    for (const stage of ['sauna', 'water', 'totonou'] as const) {
      expect(eveningAmount('day', stage)).toBe(0);
      expect(eveningAmount('evening', stage)).toBe(1);
    }
  });
  it('smooths manual changes and snaps for reduced motion with a fixed set of lights', () => {
    const scene = new THREE.Scene();
    const renderer = { toneMappingExposure: 0 } as THREE.WebGLRenderer;
    const lighting = createLighting(scene, renderer);
    lighting.update(0, 0, true);
    expect(renderer.toneMappingExposure).toBeCloseTo(2 ** 0.15);
    lighting.update(1, 0.1, false);
    expect(renderer.toneMappingExposure).toBeGreaterThan(2 ** 0.15);
    expect(renderer.toneMappingExposure).toBeLessThan(2 ** 0.55);
    lighting.update(1, 0, true);
    expect(renderer.toneMappingExposure).toBeCloseTo(2 ** 0.55);
    // Hemisphere, sun, sauna point light, lounge spot light and its target.
    expect(scene.children).toHaveLength(5);
    expect(scene.fog).toBeNull();
    expect((scene.background as THREE.Color).getHexString(THREE.SRGBColorSpace)).toBe('283d54');
  });
});

describe('Cycles lounge light', () => {
  it('uses the source power and direction by day and fades out at dusk', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const lounge = scene.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    lighting.update(0, 0, true);
    expect(lounge.intensity).toBeCloseTo(950 / Math.PI);
    // Blender (0.13, 0.3757, -0.9176) in glTF axes.
    const direction = lounge.target.position.clone().sub(lounge.position).normalize();
    expect(direction.toArray().map((v) => +v.toFixed(3))).toEqual([0.13, -0.918, -0.376]);
    // The daytime sun shines along the source sun direction.
    const toSun = sun.position.clone().normalize();
    expect(toSun.toArray().map((v) => +v.toFixed(3))).toEqual([-0.556, 0.618, 0.556]);
    lighting.update(1, 0, true);
    expect(lounge.intensity).toBe(0);
  });
});

describe('cached shadows', () => {
  it('updates only when the sun direction or quality changes and releases shadow targets', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    const lounge = scene.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    lighting.setShadowSize(1024);
    lighting.update(0, 0, true);
    for (const light of [sun, lounge]) {
      expect(light.castShadow).toBe(true);
      expect(light.shadow.autoUpdate).toBe(false);
      expect(light.shadow.mapSize.x).toBe(1024);
      light.shadow.needsUpdate = false;
    }
    lighting.update(0, 0.016, false);
    expect(sun.shadow.needsUpdate).toBe(false);
    lighting.update(1, 0, true);
    expect(sun.shadow.needsUpdate).toBe(true);
    expect(sun.position.y).toBe(6);
    // The lounge light never moves, so lighting changes keep its cached shadow.
    expect(lounge.shadow.needsUpdate).toBe(false);
    lighting.setShadowSize(2048);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(lounge.shadow.needsUpdate).toBe(true);
    const disposed: boolean[] = [];
    for (const light of [sun, lounge]) {
      const target = new THREE.WebGLRenderTarget(16, 16);
      target.addEventListener('dispose', () => disposed.push(true));
      light.shadow.map = target;
    }
    lighting.setShadowSize(0);
    for (const light of [sun, lounge]) {
      expect(light.castShadow).toBe(false);
      expect(light.shadow.map).toBeNull();
    }
    expect(disposed).toHaveLength(2);
    lighting.dispose();
  });
});
