import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { pathAt, paintWingAtlas, planVisit, WING_TEXELS, type Species } from './butterflies';

describe('garden butterflies', () => {
  it('paints each wing opaque inside its outline and clear around it', () => {
    const atlas = paintWingAtlas();
    const { data, width } = atlas.image as { data: Uint8Array; width: number };
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3];
    for (let region = 0; region < 8; region++) {
      const x0 = (region % 4) * WING_TEXELS,
        y0 = Math.floor(region / 4) * WING_TEXELS;
      expect(alpha(x0, y0)).toBe(0);
      expect(alpha(x0 + WING_TEXELS - 1, y0 + WING_TEXELS - 1)).toBe(0);
      let opaque = 0;
      for (let y = 0; y < WING_TEXELS; y++)
        for (let x = 0; x < WING_TEXELS; x++) if (alpha(x0 + x, y0 + y) === 255) opaque++;
      // A wing fills a good part of its box, but not all of it.
      expect(opaque / WING_TEXELS ** 2).toBeGreaterThan(0.35);
      expect(opaque / WING_TEXELS ** 2).toBeLessThan(0.9);
    }
    atlas.dispose();
  });

  it('plans a visit that starts and ends far away, lands on the blooms and fits its cycle', () => {
    const blooms = [new THREE.Vector3(-3, 0.5, 4), new THREE.Vector3(4, 0.6, 6)];
    const kind = { speed: 1.05, perch: [3.5, 7] } as unknown as Species;
    const plan = planVisit(kind, 7, blooms, () => 0, 60);
    expect(plan.duration).toBeLessThanOrEqual(60 + 1e-9);
    const centre = new THREE.Vector3(2, 0, 6);
    expect(pathAt(plan, 0).distanceTo(centre)).toBeGreaterThan(20);
    expect(pathAt(plan, plan.duration).distanceTo(centre)).toBeGreaterThan(20);
    const perches = plan.stops.filter((stop) => stop.hold);
    expect(perches).toHaveLength(2);
    for (const stop of perches) {
      expect(blooms.some((bloom) => bloom.equals(stop.at))).toBe(true);
      // Still on the flower while it holds, and slowing to it on the approach.
      expect(pathAt(plan, (stop.arrive + stop.leave) / 2).equals(stop.at)).toBe(true);
      expect(pathAt(plan, stop.arrive - 0.05).distanceTo(stop.at)).toBeLessThan(0.02);
    }
  });
});
