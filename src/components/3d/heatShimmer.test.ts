import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createShimmerUniforms, SHIMMER_IDLE, SHIMMER_LOYLY, updateShimmer } from './heatShimmer';

const stove = new THREE.Vector3(-3.2, 0.95, -0.4);
const size = new THREE.Vector2(1200, 800);

function camera(lookAt: THREE.Vector3) {
  const view = new THREE.PerspectiveCamera(65, 1.5, 0.05, 250);
  view.position.set(-3.2, 1.65, -2.78);
  view.lookAt(lookAt);
  view.updateMatrixWorld();
  return view;
}

describe('heat shimmer over the stove', () => {
  it('places an upright column over the stove on the image', () => {
    const uniforms = createShimmerUniforms();
    const strength = updateShimmer(uniforms, camera(stove), stove, size, 10, Infinity, false);
    expect(strength).toBeCloseTo(SHIMMER_IDLE);
    const base = uniforms.suiShimmerBase.value;
    const top = uniforms.suiShimmerTop.value;
    expect(base.x).toBeCloseTo(0.5, 1);
    expect(top.y).toBeGreaterThan(base.y);
    expect(Math.abs(top.x - base.x)).toBeLessThan(0.01);
    // About 0.3 m at 2.4 m: a sixth of the 800-pixel height.
    expect(uniforms.suiShimmerRadius.value).toBeGreaterThan(60);
    expect(uniforms.suiShimmerRadius.value).toBeLessThan(160);
    expect(uniforms.suiShimmerSize.value.toArray()).toEqual([1200, 800]);
  });

  it('wavers more while a löyly steams, then returns to the idle shimmer', () => {
    const uniforms = createShimmerUniforms();
    const view = camera(stove);
    expect(updateShimmer(uniforms, view, stove, size, 0, 1, false)).toBeGreaterThan(SHIMMER_IDLE + SHIMMER_LOYLY * 0.7);
    expect(updateShimmer(uniforms, view, stove, size, 0, 5.9, false)).toBeLessThan(SHIMMER_IDLE + SHIMMER_LOYLY * 0.05);
    expect(updateShimmer(uniforms, view, stove, size, 0, 7, false)).toBeCloseTo(SHIMMER_IDLE);
  });

  it('stays still with reduced motion and when the column is behind the camera', () => {
    const uniforms = createShimmerUniforms();
    expect(updateShimmer(uniforms, camera(stove), stove, size, 0, 1, true)).toBe(0);
    expect(uniforms.suiShimmerStrength.value).toBe(0);
    const away = camera(new THREE.Vector3(-3.2, 1.65, -10));
    expect(updateShimmer(uniforms, away, stove, size, 0, 1, false)).toBe(0);
  });
});
