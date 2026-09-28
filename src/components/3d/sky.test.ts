import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MIRROR_LAYER } from './planarReflection';
import { createSky, SKY, SKY_BLEND_SHA256, SKY_GLSL, skyFunction } from './sky';

const header = (name: string) => JSON.parse(readFileSync(`public/models/${name}.json`, 'utf8'));

describe('source sky', () => {
  it('comes from the blend the probes were baked from', () => {
    expect(header('irradiance').input_sha256).toBe(SKY_BLEND_SHA256);
    expect(header('reflection').input_sha256).toBe(SKY_BLEND_SHA256);
  });

  it('keeps the flat colour of the source worlds for diffuse rays only', () => {
    // The probes hold the flat colours; build_sky_world.py records them for reference.
    const record = JSON.parse(readFileSync('src/components/3d/sky.json', 'utf8'));
    expect(record.scenes.day.flat.map((v: number) => +v.toFixed(4))).toEqual([0.0748, 0.1088, 0.136]);
    expect(record.scenes.evening.flat.map((v: number) => +v.toFixed(4))).toEqual([0.02, 0.034, 0.066]);
    expect(record.scenes.night.flat.map((v: number) => +v.toFixed(4))).toEqual([0.003, 0.0051, 0.0099]);
  });

  it('shows the sun disk by day and the moon disk at night, with the source lamp radiance', () => {
    expect(SKY.day.disk).toBe(true);
    expect(SKY.evening.disk).toBe(false);
    expect(SKY.night.disk).toBe(true);
    // The moon: 0.1 W/m² over its 0.0093 rad disk, in the sun's direction.
    const moon = 2 * Math.PI * (1 - Math.cos(0.0093 / 2));
    expect(SKY.night.disk_radiance![2] / (0.1 / moon)).toBeCloseTo(1, 3);
    expect(SKY.night.sun_direction).toEqual(SKY.day.sun_direction);
    expect(skyFunction('night', SKY.night)).toContain('sui_sky_disk(');
    expect(skyFunction('night', SKY.night)).toContain('sui_sky_star(');
    // 3.2 W/m² over the solid angle of the lamp's 0.085 rad disk.
    const solid = 2 * Math.PI * (1 - Math.cos(0.085 / 2));
    expect(SKY.day.disk_radiance![0]).toBeCloseTo(3.2 / solid, 0);
    expect(skyFunction('day', SKY.day)).toContain('sui_sky_disk(');
    expect(skyFunction('evening', SKY.evening)).not.toContain('sui_sky_disk(');
    // No stars by day: the day function does not evaluate the Voronoi at all.
    expect(skyFunction('day', SKY.day)).not.toContain('sui_sky_star(');
    expect(skyFunction('evening', SKY.evening)).toContain('sui_sky_star(');
  });

  it('writes numbers as GLSL floats', () => {
    for (const [name, sky] of Object.entries(SKY)) expect(skyFunction(name, sky)).not.toMatch(/[\s(,]-?\d+ [),]/);
    expect(SKY_GLSL).toContain(skyFunction('day', SKY.day));
    expect(() => skyFunction('bad', { ...SKY.day, gradient_power: NaN })).toThrow();
  });

  it('is a tone-mapped background at the far plane that the mirror sees without the disk', () => {
    const sky = createSky();
    const material = sky.mesh.material as THREE.ShaderMaterial;
    expect(material.depthWrite).toBe(false);
    expect(material.fragmentShader).toContain('#include <tonemapping_fragment>');
    expect(material.vertexShader).toContain('gl_Position.z = gl_Position.w');
    expect(sky.mesh.frustumCulled).toBe(false);
    expect(sky.mesh.layers.isEnabled(0)).toBe(true);
    const main = new THREE.PerspectiveCamera();
    const mirror = new THREE.PerspectiveCamera();
    mirror.layers.enable(MIRROR_LAYER);
    const render = (camera: THREE.Camera) =>
      sky.mesh.onBeforeRender(
        {} as THREE.WebGLRenderer,
        new THREE.Scene(),
        camera,
        sky.mesh.geometry,
        material,
        null as unknown as THREE.Group,
      );
    render(mirror);
    expect(material.uniforms.suiSkyDisk.value).toBe(0);
    render(main);
    expect(material.uniforms.suiSkyDisk.value).toBe(1);
    sky.update(1, 0.4);
    expect(material.uniforms.suiSkyEvening.value).toBe(1);
    expect(material.uniforms.suiSkyNight.value).toBe(0.4);
    // Only skies with a weight are evaluated.
    expect(SKY_GLSL).toContain('if ( night > 0.0 ) sky += night * sui_sky_night( d );');
  });
});
