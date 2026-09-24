import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INTERIOR_BOX, INTERIOR_SOURCES, createInteriorLights, diskBandArea, sourceRect } from './interiorLights';

describe('sauna interior lights', () => {
  it('places the source area lights inside the room with their power and orientation', () => {
    const lights = createInteriorLights();
    expect(lights.map((light) => light.name)).toEqual(INTERIOR_SOURCES.map(([name]) => name));
    for (const light of lights) expect(INTERIOR_BOX.containsPoint(light.position)).toBe(true);
    // 'Warm under-bench wash': Blender (-3.6, 3.72, 0.85), 4.35 × 0.1 m, shining down.
    const [strip] = lights;
    expect(strip.position.toArray()).toEqual([-3.6, 0.85, -3.72]);
    expect([strip.width, strip.height]).toEqual([4.35, 0.1]);
    const down = new THREE.Vector3(0, 0, -1).applyQuaternion(strip.quaternion);
    expect(down.y).toBeCloseTo(-1);
    // Radiance P / (π·A) times the unoccluded share.
    expect(strip.intensity).toBeCloseTo((0.64 * 95) / (Math.PI * 4.35 * 0.1));
    // The ceiling disk becomes the square of equal area and keeps its power.
    const ceiling = lights[2];
    expect(ceiling.width * ceiling.height).toBeCloseTo(Math.PI * 1.5 ** 2);
    expect((ceiling.intensity / 0.82) * Math.PI * ceiling.width * ceiling.height).toBeCloseTo(85);
  });

  it('keeps only the in-room band of the wall wash disk', () => {
    const r = 1.5;
    expect(diskBandArea(r, -r, r)).toBeCloseTo(Math.PI * r * r);
    const wash = INTERIOR_SOURCES.find(([name]) => name === 'Sauna wall wash')!;
    const { width, height, offset, radiance } = sourceRect(wash);
    expect(height).toBeCloseTo(0.992);
    expect((width * height) / (Math.PI * r * r)).toBeCloseTo(0.409, 3);
    expect(offset).toBeCloseTo(0.209);
    // Same radiance as the whole disk: the hidden part emits into the walls.
    expect(radiance).toBeCloseTo(48 / (Math.PI * Math.PI * r * r));
  });

  it('confines the area lights to the room', () => {
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    expect(begin).toContain('bool suiInterior');
    expect(begin).toContain('suiRectFormFactor( geometryNormal, geometryPosition, rectCoords )');
    expect(begin).not.toContain('RE_Direct_RectArea( rectAreaLight');
    expect(THREE.ShaderChunk.lights_physical_pars_fragment).toContain('float suiRectFormFactor(');
  });
});
