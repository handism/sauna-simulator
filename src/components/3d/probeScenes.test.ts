import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROBE_KINDS, PROBE_SCENES, placeProbeScene, probeValues, scenesBetween, splitProbeScene } from './probeScenes';

const shipped = (kind: string) => {
  const file = readFileSync(`public/models/${kind}.bin`);
  return {
    header: JSON.parse(readFileSync(`public/models/${kind}.json`, 'utf8')),
    values: new Uint16Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)),
  };
};

describe('probe files split by scene', () => {
  it.each(PROBE_KINDS)('rebuilds the shipped %s file exactly from its scenes', (kind) => {
    const { header, values } = shipped(kind);
    expect(probeValues(header)).toBe(values.length);
    const rebuilt = new Uint16Array(probeValues(header));
    const sizes = PROBE_SCENES.map((scene) => {
      const file = splitProbeScene(header, values, scene);
      placeProbeScene(header, rebuilt, scene, file.slice().buffer);
      return file.length;
    });
    expect(rebuilt).toEqual(values);
    // Each scene is a third of the file.
    expect(sizes.reduce((a, b) => a + b)).toBe(values.length);
    expect(new Set(sizes).size).toBe(1);
  });

  it('leaves the scenes not placed at zero', () => {
    const { header, values } = shipped('irradiance');
    const partial = new Uint16Array(probeValues(header));
    placeProbeScene(header, partial, 'day', splitProbeScene(header, values, 'day').slice().buffer);
    for (const grid of header.grids) {
      const length = grid.resolution.reduce((a: number, b: number) => a * b) * 27;
      expect(partial.subarray(grid.offset.day, grid.offset.day + length)).toEqual(
        values.subarray(grid.offset.day, grid.offset.day + length),
      );
      expect(partial.subarray(grid.offset.night, grid.offset.night + length).every((v) => v === 0)).toBe(true);
    }
  });

  it('rejects a scene file of the wrong size', () => {
    const { header } = shipped('irradiance');
    expect(() => placeProbeScene(header, new Uint16Array(probeValues(header)), 'day', new ArrayBuffer(16))).toThrow();
  });

  it('names the scenes a change of the time of day passes through', () => {
    expect(scenesBetween(0, 0)).toEqual(['day']);
    expect(scenesBetween(1, 1)).toEqual(['evening']);
    expect(scenesBetween(1.5, 1.5)).toEqual(['evening', 'night']);
    expect(scenesBetween(0, 2)).toEqual(['day', 'evening', 'night']);
    expect(scenesBetween(2, 0.999)).toEqual(['day', 'evening', 'night']);
    expect(scenesBetween(0.2, 0.9)).toEqual(['day', 'evening']);
  });
});
