import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLOSSY_SOURCES, areaRadiance, createGlossyLights, sourceArea } from './glossyLights';
import { MIRROR_LAYER } from './planarReflection';

describe('glossy-only area lights', () => {
  it('gives each source its Lambertian radiance P·color / (π·A)', () => {
    // V9: 950 W over a 1.25 m disk.
    const v9 = areaRadiance(950, [1, 0.84, 0.62], sourceArea([1.25]));
    expect(v9[0]).toBeCloseTo(950 / (Math.PI * Math.PI * 0.625 ** 2), 6);
    expect(v9[1] / v9[0]).toBeCloseTo(0.84, 6);
    // The water strip: 65 W over 2.2 × 1.6 m.
    expect(areaRadiance(65, [1, 1, 1], sourceArea([2.2, 1.6]))[0]).toBeCloseTo(65 / (Math.PI * 3.52), 6);
  });

  it('draws the shapes only for the mirror, with the source area, facing where they shine', () => {
    const { mesh, update } = createGlossyLights();
    expect(mesh.layers.mask).toBe(1 << MIRROR_LAYER);
    expect(mesh.castShadow).toBe(false);
    const position = mesh.geometry.attributes.position;
    const day = mesh.geometry.attributes.dayRadiance;
    const evening = mesh.geometry.attributes.eveningRadiance;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      normal = new THREE.Vector3();
    let triangle = 0;
    for (const [, size, color, dayWatts, eveningWatts, center, , direction] of GLOSSY_SOURCES) {
      const area = sourceArea(size);
      let summed = 0;
      const centroid = new THREE.Vector3();
      const count = size.length === 2 ? 2 : 32;
      for (let i = 0; i < count; i++, triangle++) {
        a.fromBufferAttribute(position, 3 * triangle);
        b.fromBufferAttribute(position, 3 * triangle + 1);
        c.fromBufferAttribute(position, 3 * triangle + 2);
        normal.subVectors(b, a).cross(c.clone().sub(a));
        summed += normal.length() / 2;
        centroid.add(a).add(b).add(c);
        // Counterclockwise toward the lit side, so the front face is the emitting one.
        expect(normal.normalize().dot(new THREE.Vector3().fromArray(direction).normalize())).toBeCloseTo(1, 3);
        expect(day.getX(3 * triangle)).toBeCloseTo(areaRadiance(dayWatts, color, area)[0], 4);
        expect(evening.getZ(3 * triangle + 2)).toBeCloseTo(areaRadiance(eveningWatts, color, area)[2], 4);
      }
      expect(summed).toBeCloseTo(area, 5);
      expect(centroid.divideScalar(3 * count).distanceTo(new THREE.Vector3().fromArray(center))).toBeLessThan(1e-4);
    }
    expect(triangle * 3).toBe(position.count);
    update(0.25);
    expect(mesh.material.uniforms.evening.value).toBe(0.25);
  });

  it('lies on a layer the mirror camera renders and the main camera does not', () => {
    const { mesh } = createGlossyLights();
    const main = new THREE.PerspectiveCamera();
    const mirror = new THREE.PerspectiveCamera();
    mirror.layers.enable(MIRROR_LAYER);
    expect(mesh.layers.test(main.layers)).toBe(false);
    expect(mesh.layers.test(mirror.layers)).toBe(true);
  });
});
