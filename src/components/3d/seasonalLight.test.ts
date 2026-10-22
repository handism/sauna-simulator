import { describe, expect, it } from 'vitest';
import calibration from './seasonal-light.json';
import bake from '../../../docs/3d-qa/seasonal-light/bake.json';
import probes from '../../../public/models/irradiance.json';
import { createSeasonLightUniforms, updateSeasonLight } from './seasonalLight';

describe('seasonal probe energy', () => {
  it('matches the paired bake without fitting the held-out last location', () => {
    expect(bake.input_sha256).toBe(probes.input_sha256);
    for (const season of ['spring', 'autumn', 'winter'] as const)
      for (const kind of ['irradiance', 'reflection'] as const)
        for (const [g, grid] of ['room', 'courtyard', 'outer', 'water'].entries())
          for (const [s, scene] of ['day', 'evening', 'night'].entries()) {
            const measured = bake.measurements as Record<
              string,
              Record<string, Record<string, Record<string, number[][]>>>
            >;
            const baseline = measured.summer[kind][scene][grid].slice(0, -1);
            const target = measured[season][kind][scene][grid].slice(0, -1);
            const sum = (rows: number[][], c: number) => rows.reduce((sum, row) => sum + row[c], 0);
            const expected = [0, 1, 2].map((c) =>
              Number(Math.min(1.8, Math.max(0.6, sum(target, c) / sum(baseline, c))).toFixed(6)),
            );
            expect(calibration.gains[season][kind][g * 3 + s]).toEqual(expected);
          }
  });
  it('ships bounded measured RGB gains for both kinds, four grids and all three times', () => {
    expect(calibration.version).toBe(1);
    expect(calibration.grids).toEqual(['room', 'courtyard', 'outer', 'water']);
    expect(calibration.scenes).toEqual(['day', 'evening', 'night']);
    for (const season of Object.values(calibration.gains))
      for (const rows of Object.values(season)) {
        expect(rows).toHaveLength(12);
        for (const rgb of rows) {
          expect(rgb).toHaveLength(3);
          for (const c of rgb) {
            expect(Number.isFinite(c)).toBe(true);
            expect(c).toBeGreaterThanOrEqual(0.6);
            expect(c).toBeLessThanOrEqual(1.8);
          }
        }
      }
  });
  it('changes existing vectors atomically, restores neutral summer, and keeps scenes independent', () => {
    const first = createSeasonLightUniforms(),
      second = createSeasonLightUniforms();
    const vector = first.suiSeasonIrradiance.value[4];
    expect(updateSeasonLight(first, 'winter')).toBe(true);
    expect(first.suiSeasonIrradiance.value[4]).toBe(vector);
    expect(vector.toArray()).toEqual(calibration.gains.winter.irradiance[4]);
    expect(updateSeasonLight(first, 'winter')).toBe(false);
    expect(second.suiSeasonIrradiance.value.every((v) => v.toArray().every((c) => c === 1))).toBe(true);
    updateSeasonLight(first, 'autumn');
    expect(first.suiSeasonReflection.value[11].toArray()).toEqual(calibration.gains.autumn.reflection[11]);
    updateSeasonLight(first, 'summer');
    for (const u of Object.values(first)) expect(u.value.every((v) => v.toArray().every((c) => c === 1))).toBe(true);
  });

  it('leaves the rebaked outdoor grids at 1 and keeps the calibrated light of the summer-baked deck patch', () => {
    const uniforms = createSeasonLightUniforms();
    expect(updateSeasonLight(uniforms, 'winter', true)).toBe(true);
    for (let i = 0; i < 12; i++) {
      // Grids in order room, courtyard, outer, water; three scenes each.
      const rebaked = i >= 3 && i < 9;
      for (const kind of ['irradiance', 'reflection'] as const) {
        const value = (kind === 'irradiance' ? uniforms.suiSeasonIrradiance : uniforms.suiSeasonReflection).value[i];
        expect(value.toArray()).toEqual(rebaked ? [1, 1, 1] : calibration.gains.winter[kind][i]);
      }
    }
    expect(uniforms.suiSeasonDeck.value.map((v) => v.toArray())).toEqual(
      calibration.gains.winter.irradiance.slice(4, 6),
    );
    // Until the files arrive, the calibrated gains.
    expect(updateSeasonLight(uniforms, 'winter', false)).toBe(true);
    expect(uniforms.suiSeasonIrradiance.value[4].toArray()).toEqual(calibration.gains.winter.irradiance[4]);
  });
});
