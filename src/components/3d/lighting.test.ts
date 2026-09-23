import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createLighting, eveningAmount } from './lighting';

describe('3D lighting', () => {
  it('repeats the automatic progression and honors fixed choices in every stage', () => {
    expect(['sauna', 'water', 'totonou', 'sauna'].map(stage => eveningAmount('auto', stage as 'sauna' | 'water' | 'totonou'))).toEqual([0, .5, 1, 0]);
    for (const stage of ['sauna', 'water', 'totonou'] as const) {
      expect(eveningAmount('day', stage)).toBe(0);
      expect(eveningAmount('evening', stage)).toBe(1);
    }
  });
  it('smooths manual changes and snaps for reduced motion without adding lights', () => {
    const scene = new THREE.Scene();
    const renderer = { toneMappingExposure: 0 } as THREE.WebGLRenderer;
    const lighting = createLighting(scene, renderer);
    lighting.update(0, 0, true);
    expect(renderer.toneMappingExposure).toBe(1.2);
    lighting.update(1, .1, false);
    expect(renderer.toneMappingExposure).toBeGreaterThan(1.1);
    expect(renderer.toneMappingExposure).toBeLessThan(1.2);
    lighting.update(1, 0, true);
    expect(renderer.toneMappingExposure).toBe(1.1);
    expect(scene.children).toHaveLength(3);
    expect((scene.fog as THREE.Fog).color.equals(scene.background as THREE.Color)).toBe(true);
  });
});

describe('cached sun shadows', () => {
  it('updates only when the sun direction or quality changes and releases shadow targets', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const sun = scene.children.find(child => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    lighting.setShadowSize(1024);
    lighting.update(0, 0, true);
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.autoUpdate).toBe(false);
    expect(sun.shadow.mapSize.x).toBe(1024);
    sun.shadow.needsUpdate = false;
    lighting.update(0, .016, false);
    expect(sun.shadow.needsUpdate).toBe(false);
    lighting.update(1, 0, true);
    expect(sun.shadow.needsUpdate).toBe(true);
    expect(sun.position.y).toBe(6);
    lighting.setShadowSize(2048);
    expect(sun.shadow.mapSize.x).toBe(2048);
    const target = new THREE.WebGLRenderTarget(16, 16);
    let disposed = false;
    target.addEventListener('dispose', () => { disposed = true; });
    sun.shadow.map = target;
    lighting.setShadowSize(0);
    expect(sun.castShadow).toBe(false);
    expect(sun.shadow.map).toBeNull();
    expect(disposed).toBe(true);
    lighting.dispose();
  });
});
