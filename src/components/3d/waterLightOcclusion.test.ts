import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { canopyBlocks, WATER_LIGHT_CANOPY } from './waterLightOcclusion';

const { beams, louvers: l } = WATER_LIGHT_CANOPY;
const box = (min: readonly number[], max: readonly number[]) =>
  new THREE.Box3(new THREE.Vector3().fromArray(min), new THREE.Vector3().fromArray(max));
const boxes = [
  ...beams.map(([min, max]) => box(min, max)),
  ...Array.from({ length: l.count }, (_, i) =>
    box([l.min[0] + i * l.spacing, l.min[1], l.min[2]], [l.min[0] + i * l.spacing + l.width, l.max[1], l.max[2]]),
  ),
];

describe('water light canopy occlusion', () => {
  it('blocks the slats and beams, leaves gaps open, and does not block lights in front of the canopy', () => {
    const up = new THREE.Vector3(0, 1, 0);
    expect(canopyBlocks(new THREE.Vector3(4, 0.765, 0.65), up, 4)).toBe(true);
    const slat = new THREE.Vector3(l.min[0] + 8 * l.spacing + l.width / 2, 0.765, -2);
    expect(canopyBlocks(slat, up, 4)).toBe(true);
    expect(canopyBlocks(slat, up, 2)).toBe(false);
    expect(canopyBlocks(slat.clone().add(new THREE.Vector3(l.spacing / 2, 0, 0)), up, 4)).toBe(false);
    expect(canopyBlocks(slat, up.clone().negate(), 4)).toBe(false);
    expect(canopyBlocks(new THREE.Vector3(7, 0.765, -2), up, 4)).toBe(false);
  });

  it('matches individual box ray intersections across both directions and partial light distances', () => {
    let seed = 23041;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const hit = new THREE.Vector3();
    let blocked = 0;
    for (let i = 0; i < 4000; i++) {
      const origin = new THREE.Vector3(random() * 9, 0.765, random() * 8 - 5);
      const target = new THREE.Vector3(random() * 9, 2.5 + random() * 5, random() * 8 - 5);
      const direction = target.clone().sub(origin).normalize();
      const end = target.distanceTo(origin);
      const ray = new THREE.Ray(origin, direction);
      const expected = boxes.some((b) => ray.intersectBox(b, hit) !== null && hit.distanceTo(origin) < end);
      if (expected) blocked++;
      expect(canopyBlocks(origin, direction, end), `ray ${i}`).toBe(expected);
    }
    expect(blocked).toBeGreaterThan(100);
    expect(blocked).toBeLessThan(3900);
  });
});
