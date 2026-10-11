import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createRain, dropPosition, FALLS, RAIN_DROPS, RAIN_SPAN, RAIN_SPEED, rainReaches } from './rain';
import { INTERIOR_BOX } from './interiorLights';

describe('rain', () => {
  it('keeps every drop in the box around the camera, falling and wrapping in place', () => {
    for (const center of [
      [0, 0],
      [4.3, -2],
      [-37.2, 81.5],
    ] as [number, number][]) {
      for (const seed of [
        [0, 0, 0],
        [0.3, 0.9, 0.5],
        [0.999, 0.01, 0.99],
      ]) {
        const [x, , z] = dropPosition(seed, center, 0);
        // The wind's drift moves a drop at most a couple of meters upwind.
        expect(Math.abs(x - center[0])).toBeLessThanOrEqual(RAIN_SPAN / 2 + 2);
        expect(Math.abs(z - center[1])).toBeLessThanOrEqual(RAIN_SPAN / 2 + 2);
      }
    }
    // A drop falls at the rain's speed and comes back to the top once it reaches the bottom.
    const seed = [0.2, 0.4, 0.7];
    const a = dropPosition(seed, [0, 0], 0);
    const b = dropPosition(seed, [0, 0], 0.1);
    expect(a[1] - b[1]).toBeCloseTo(RAIN_SPEED * 0.1);
    const later = dropPosition(seed, [0, 0], 100);
    expect(later[1]).toBeGreaterThanOrEqual(-0.5);
    expect(later[1]).toBeLessThan(7.5);
    // A drop stays where it is in the world while the camera moves less than the box's half.
    const moved = dropPosition(seed, [1, -1], 0);
    expect(moved[0]).toBeCloseTo(a[0]);
    expect(moved[2]).toBeCloseTo(a[2]);
  });
  it('lets the snow fall slowly and sway around its place', () => {
    const seed = [0.2, 0.4, 0.7, 0.3];
    const a = dropPosition(seed, [0, 0], 0, 'snow');
    const b = dropPosition(seed, [0, 0], 1, 'snow');
    expect(a[1] - b[1]).toBeCloseTo(FALLS.snow.speed);
    expect(FALLS.snow.speed).toBeLessThan(RAIN_SPEED / 5);
    // Over a sway the flake stays within its amplitude of the wind's line.
    const base = dropPosition([0.2, 0.4, 0.7, 0], [0, 0], 0, 'rain');
    for (let t = 0; t < 1; t += 0.1) {
      const flake = dropPosition([0.2, 0.4, 0.7, t], [0, 0], 0, 'snow');
      const windShift =
        (FALLS.snow.wind[0] / FALLS.snow.speed - FALLS.rain.wind[0] / FALLS.rain.speed) * (flake[1] + 0.5);
      expect(Math.abs(flake[0] - (base[0] - windShift))).toBeLessThanOrEqual(FALLS.snow.sway + 1e-9);
    }
  });
  it('keeps out of the sauna room', () => {
    expect(
      rainReaches(INTERIOR_BOX.getCenter(new THREE.Vector3()).x, INTERIOR_BOX.getCenter(new THREE.Vector3()).z),
    ).toBe(false);
    expect(rainReaches(4.3, -2)).toBe(true);
  });
  it('is one transparent mesh, hidden while the sky is clear', () => {
    const rain = createRain();
    const geometry = rain.mesh.geometry;
    expect(geometry.getAttribute('seed').count).toBe(RAIN_DROPS * 4);
    expect(geometry.getIndex()!.count).toBe(RAIN_DROPS * 6);
    const material = rain.mesh.material as THREE.ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(rain.mesh.castShadow).toBe(false);
    // Drawn at first, so the scene's compile includes the program.
    expect(rain.mesh.visible).toBe(true);
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(4, 1.5, -2);
    rain.update(0, new THREE.Color(), camera, 1);
    expect(rain.mesh.visible).toBe(false);
    rain.update(0.5, new THREE.Color(0.2, 0.2, 0.2), camera, 1);
    expect(rain.mesh.visible).toBe(true);
    expect(material.uniforms.suiRainAmount.value).toBe(0.5);
    expect(material.uniforms.suiRainCenter.value.toArray()).toEqual([4, -2]);
  });
  it('makes the snow a separate mesh of round flakes', () => {
    const snow = createRain('snow');
    expect(snow.mesh.name).toBe('snow');
    expect(snow.mesh.geometry.getAttribute('seed').count).toBe(FALLS.snow.count * 4);
    const material = snow.mesh.material as THREE.ShaderMaterial;
    expect(material.fragmentShader).toContain('A soft round flake');
    expect((createRain('rain').mesh.material as THREE.ShaderMaterial).fragmentShader).not.toContain('flake');
  });
});
