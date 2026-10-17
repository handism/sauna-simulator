import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { apparentDepth, REFRACTION_SWAY, WATER_IOR, WATER_VOLUME, waveImageOffset } from './refraction';
import { waveHeight, waveNormal } from './waterEffects';

describe('wave image displacement', () => {
  it('uses the analytic normal of the same surface wave, including its moving phase', () => {
    const e = 1e-5;
    for (const t of [0, 0.3, 1.2]) {
      const x = 1.2,
        z = -2.7;
      const normal = waveNormal(x, z, t);
      const dx = (waveHeight(x + e, z, t) - waveHeight(x - e, z, t)) / (2 * e);
      const dz = (waveHeight(x, z + e, t) - waveHeight(x, z - e, t)) / (2 * e);
      expect(normal.distanceTo(new THREE.Vector3(-dx, 1, -dz).normalize())).toBeLessThan(1e-7);
    }
  });
  it('freezes at a fixed time, vanishes for a flat normal and at/outside the rim, and stays bounded', () => {
    const camera = new THREE.Vector3(1.2, 2.2, -2.5),
      point = new THREE.Vector3(1.2, 0.2, -2.5);
    const flat = () => new THREE.Vector3(0, 1, 0);
    expect(waveImageOffset(camera, point, 0.765, 0, flat).length()).toBe(0);
    expect(waveImageOffset(camera, point, 0.765, 0)).toEqual(waveImageOffset(camera, point, 0.765, 0));
    expect(
      waveImageOffset(camera, point, 0.765, 0).distanceTo(waveImageOffset(camera, point, 0.765, 0.5)),
    ).toBeGreaterThan(1e-5);
    for (const x of [WATER_VOLUME.min.x, WATER_VOLUME.max.x, 5]) {
      camera.x = point.x = x;
      expect(waveImageOffset(camera, point, 0.765, 1).length()).toBe(0);
    }
    for (let x = 0; x < 2.5; x += 0.1)
      for (let z = -4; z < -0.9; z += 0.1) {
        camera.set(x, 1.3, z);
        point.set(x, 0.202, z);
        const offset = waveImageOffset(camera, point, 0.765, x + z);
        expect(Number.isFinite(offset.length())).toBe(true);
        expect(offset.length()).toBeLessThanOrEqual(REFRACTION_SWAY);
      }
    expect(waveImageOffset(new THREE.Vector3(1, 0.5, -2), point, 0.765, 0).length()).toBe(0);
  });
  it('agrees with an independent tilted-plane Snell solve at small slopes', () => {
    const camera = new THREE.Vector3(0.6, 2, -2.8),
      point = new THREE.Vector3(1.2, 0.202, -2.2),
      level = 0.765;
    const h = camera.y - level,
      d = level - point.y;
    const apparent = apparentDepth(h, d, Math.hypot(point.x - camera.x, point.z - camera.z));
    const entry = camera.clone().lerp(new THREE.Vector3(point.x, level - apparent, point.z), h / (h + apparent));
    const gx = 0.002,
      gz = -0.003;
    const residual = (x: number, z: number) => {
      const q = new THREE.Vector3(x, level + gx * (x - entry.x) + gz * (z - entry.z), z);
      const air = q.clone().sub(camera).normalize(),
        water = point.clone().sub(q).normalize();
      return new THREE.Vector2(
        air.x - WATER_IOR * water.x + (air.y - WATER_IOR * water.y) * gx,
        air.z - WATER_IOR * water.z + (air.y - WATER_IOR * water.y) * gz,
      );
    };
    let x = entry.x,
      z = entry.z;
    for (let i = 0; i < 8; i++) {
      const f = residual(x, z),
        e = 1e-5;
      const dx = residual(x + e, z)
          .sub(f)
          .divideScalar(e),
        dz = residual(x, z + e)
          .sub(f)
          .divideScalar(e);
      const determinant = dx.x * dz.y - dz.x * dx.y;
      x -= (dz.y * f.x - dz.x * f.y) / determinant;
      z -= (-dx.y * f.x + dx.x * f.y) / determinant;
    }
    const y = level + gx * (x - entry.x) + gz * (z - entry.z);
    const ratio = (camera.y - level + apparent) / (camera.y - y);
    const exact = new THREE.Vector2(
      camera.x + (x - camera.x) * ratio - point.x,
      camera.z + (z - camera.z) * ratio - point.z,
    );
    const linear = waveImageOffset(camera, point, level, 0, () => new THREE.Vector3(-gx, 1, -gz).normalize());
    expect(linear.distanceTo(exact)).toBeLessThan(2e-5);
  });
});
