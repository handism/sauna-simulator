import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  AUTO_SECONDS_PER_SCENE,
  AUTO_TRANSITION_SECONDS,
  createLighting,
  DRY_ONLY,
  sceneWeights,
  SPOT_COSINE,
  SUN_DIFFUSE_ONLY,
  timeOfDay,
} from './lighting';
import { directionalPenumbra, spotPenumbra } from './softShadows';

describe('3D lighting', () => {
  it('keeps the specular of the sun only out of the directional light loop', () => {
    const chunk = THREE.ShaderChunk.lights_fragment_begin;
    const start = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
    const end = chunk.indexOf('#pragma unroll_loop_end', start);
    const restore = chunk.indexOf(SUN_DIFFUSE_ONLY);
    expect(start).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(start);
    expect(restore).toBeLessThan(end);
    expect(chunk.split(SUN_DIFFUSE_ONLY)).toHaveLength(2);
    // Neither the sun nor the spot lights light the plunge below the water, which is declared
    // before the light loops.
    expect(chunk.slice(start, end)).toContain(`${DRY_ONLY}RE_Direct(`);
    const spotStart = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
    expect(chunk.slice(spotStart, chunk.indexOf('#pragma unroll_loop_end', spotStart))).toContain(
      `${DRY_ONLY}RE_Direct(`,
    );
    expect(chunk.split(DRY_ONLY)).toHaveLength(3);
    expect(chunk.indexOf('bool suiUnderwater')).toBeLessThan(spotStart);
    // Spot lights (V9 and the dusk accents) keep their highlights, as in the source.
    const spot = chunk.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )');
    expect(chunk.slice(spot, chunk.indexOf('#pragma unroll_loop_end', spot))).not.toContain('suiSpecular');
  });
  it('gives every spot light the cosine falloff of a Lambertian disk', () => {
    const pars = THREE.ShaderChunk.lights_pars_begin;
    expect(pars).toContain(SPOT_COSINE);
    expect(pars).not.toContain('smoothstep( coneCosine');
    // A 90° cone with full penumbra: 0 at 90°, 1 on the axis, linear in the cosine between.
    const light = new THREE.SpotLight('#fff', 1, 0, Math.PI / 2, 1, 2);
    expect(Math.cos(light.angle)).toBeCloseTo(0, 12);
    expect(Math.cos(light.angle * (1 - light.penumbra))).toBe(1);
  });
  it('moves the automatic progression on with the time since entering and honors fixed choices', () => {
    // Day for 12 minutes, dusk over the next 3, held until 27 minutes, night over the next 3, then
    // the night stays.
    const minutes = [0, 6, 12, 13.5, 15, 21, 27, 28.5, 30, 45, 120];
    const expected = [0, 0, 0, 0.5, 1, 1, 1, 1.5, 2, 2, 2];
    minutes.forEach((minute, i) => expect(timeOfDay('auto', minute * 60)).toBeCloseTo(expected[i], 12));
    expect([AUTO_SECONDS_PER_SCENE, AUTO_TRANSITION_SECONDS]).toEqual([900, 180]);
    // Continuous at the ends of each transition.
    for (const edge of [720, 900, 1620, 1800]) {
      expect(Math.abs(timeOfDay('auto', edge + 0.01) - timeOfDay('auto', edge - 0.01))).toBeLessThan(1e-3);
    }
    // A clock set back after entering does not run the day backwards past its start.
    expect(timeOfDay('auto', -60)).toBe(0);
    for (const seconds of [0, 1000, 5000]) {
      expect(timeOfDay('day', seconds)).toBe(0);
      expect(timeOfDay('evening', seconds)).toBe(1);
      expect(timeOfDay('night', seconds)).toBe(2);
    }
  });
  it('blends the two neighbouring source scenes', () => {
    expect(sceneWeights(0)).toEqual([1, 0, 0]);
    expect(sceneWeights(0.5)).toEqual([0.5, 0.5, 0]);
    expect(sceneWeights(1)).toEqual([0, 1, 0]);
    expect(sceneWeights(1.25)).toEqual([0, 0.75, 0.25]);
    expect(sceneWeights(2)).toEqual([0, 0, 1]);
    for (let t = 0; t <= 2; t += 0.1) {
      const weights = sceneWeights(t);
      expect(weights.reduce((a, b) => a + b)).toBeCloseTo(1, 12);
      expect(weights.filter((w) => w > 0).length).toBeLessThanOrEqual(2);
    }
  });
  it('smooths manual changes and snaps for reduced motion with a fixed set of lights', () => {
    const scene = new THREE.Scene();
    const renderer = { toneMappingExposure: 0 } as THREE.WebGLRenderer;
    const lighting = createLighting(scene, renderer);
    lighting.update(0, 0, true);
    expect(renderer.toneMappingExposure).toBeCloseTo(2 ** 0.15);
    lighting.update(1, 0.1, false);
    expect(renderer.toneMappingExposure).toBeGreaterThan(2 ** 0.15);
    expect(renderer.toneMappingExposure).toBeLessThan(2 ** 0.55);
    lighting.update(1, 0, true);
    expect(renderer.toneMappingExposure).toBeCloseTo(2 ** 0.55);
    lighting.update(2, 0, true);
    expect(renderer.toneMappingExposure).toBeCloseTo(2 ** 0.9);
    expect(lighting.time).toBe(2);
    lighting.update(1, 0, true);
    // Sky, sun, six sauna area lights, lounge spot light, five dusk spot lights, and targets; no
    // hemisphere light (the baked probes replace it) and the probes follow the time of day.
    expect(scene.children).toHaveLength(20);
    expect(scene.children.some((child) => child instanceof THREE.HemisphereLight)).toBe(false);
    expect(lighting.irradiance.suiIrradianceEvening.value).toBe(1);
    expect(lighting.irradiance.suiIrradianceNight.value).toBe(0);
    lighting.update(0, 0, true);
    expect(lighting.irradiance.suiIrradianceEvening.value).toBe(0);
    lighting.update(1.5, 0, true);
    expect(lighting.irradiance.suiIrradianceEvening.value).toBe(1);
    expect(lighting.irradiance.suiIrradianceNight.value).toBe(0.5);
    lighting.update(1, 0, true);
    expect(scene.fog).toBeNull();
  });
  it('draws the source sky as a mesh that follows the time of day', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    expect(scene.background).toBeNull();
    const sky = scene.getObjectByName('sky') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    for (const [time, dusk, night] of [
      [0, 0, 0],
      [0.25, 0.25, 0],
      [1, 1, 0],
      [1.75, 1, 0.75],
    ]) {
      lighting.update(time, 0, true);
      expect(sky.material.uniforms.suiSkyEvening.value).toBe(dusk);
      expect(sky.material.uniforms.suiSkyNight.value).toBe(night);
    }
  });
});

describe('Cycles lounge light', () => {
  it('uses the source power and direction by day and fades out at dusk', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const lounge = scene.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    lighting.update(0, 0, true);
    expect(lounge.intensity).toBeCloseTo(950 / Math.PI);
    // Blender (0.13, 0.3757, -0.9176) in glTF axes.
    const direction = lounge.target.position.clone().sub(lounge.position).normalize();
    expect(direction.toArray().map((v) => +v.toFixed(3))).toEqual([0.13, -0.918, -0.376]);
    // The daytime sun shines along the source sun direction.
    const toSun = sun.position.clone().normalize();
    expect(toSun.toArray().map((v) => +v.toFixed(3))).toEqual([-0.556, 0.618, 0.556]);
    lighting.update(1, 0, true);
    expect(lounge.intensity).toBe(0);
    // A 90° full-penumbra cone approximates the disk's cosine falloff.
    expect(lounge.angle).toBeCloseTo(Math.PI / 2);
    expect(lounge.penumbra).toBe(1);
  });

  it('sizes the soft shadows from the source sun angle and lounge disk', () => {
    const scene = new THREE.Scene();
    createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const lounge = scene.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    expect(sun.shadow.radius).toBeCloseTo(directionalPenumbra(sun.shadow.camera, 0.085));
    expect(lounge.shadow.focus * 2 * THREE.MathUtils.radToDeg(lounge.angle)).toBeCloseTo(144);
    expect(lounge.shadow.radius).toBeCloseTo(spotPenumbra(1, 20, 144, 1.25));
    // The sun shadow covers the garden the Cycles cameras frame.
    expect(sun.shadow.camera.right - sun.shadow.camera.left).toBe(60);
  });
});

describe('Cycles Blue hour lights', () => {
  it('dims the sun to the source value and brings up the accent lights', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    const [lounge, ...dusk] = scene.children.filter((child) => child instanceof THREE.SpotLight);
    expect(dusk).toHaveLength(5);
    lighting.update(0, 0, true);
    for (const light of dusk) expect(light.intensity).toBe(0);
    lighting.update(1, 0, true);
    expect(sun.intensity).toBeCloseTo(0.045);
    expect(lounge.intensity).toBe(0);
    // Source watts over π on the axis: lounge fill, three path lights and the maple uplight.
    expect(dusk.map((light) => +(light.intensity * Math.PI).toFixed(3))).toEqual([42, 8, 8, 8, 35]);
    // 'V10 lounge dusk fill' points along Blender (-0.3142, 0.6854, -0.6569).
    const direction = dusk[0].target.position.clone().sub(dusk[0].position).normalize();
    expect(direction.toArray().map((v) => +v.toFixed(3))).toEqual([-0.314, -0.657, -0.685]);
    for (const light of dusk) {
      expect(light.angle).toBeCloseTo(Math.PI / 2);
      expect(light.penumbra).toBe(1);
      expect(light.castShadow).toBe(false);
    }
    // The low quality setting leaves them out of every shader.
    lighting.setDuskLights(false);
    expect(dusk.every((light) => !light.visible)).toBe(true);
    lighting.setDuskLights(true);
    expect(dusk.every((light) => light.visible)).toBe(true);
  });

  it("lends another quality's light and shadow counts to a compile and restores them", () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const dusk = scene.children.filter((child) => child instanceof THREE.SpotLight).slice(1);
    const casters = scene.children.filter(
      (child) => child instanceof THREE.DirectionalLight || child instanceof THREE.SpotLight,
    ) as (THREE.DirectionalLight | THREE.SpotLight)[];
    lighting.setShadowSize(1024);
    const map = new THREE.WebGLRenderTarget(16, 16);
    casters[0].shadow.map = map;
    const seen = lighting.withQuality(0, false, () => ({
      casts: casters.some((light) => light.castShadow),
      dusk: dusk.some((light) => light.visible),
    }));
    expect(seen).toEqual({ casts: false, dusk: false });
    expect(casters.every((light) => light.castShadow)).toBe(true);
    expect(dusk.every((light) => light.visible)).toBe(true);
    // The cached shadow is kept for the quality still drawn.
    expect(casters[0].shadow.map).toBe(map);
    // Restored when the compile throws too.
    lighting.setShadowSize(0);
    lighting.setDuskLights(false);
    expect(() =>
      lighting.withQuality(2048, true, () => {
        throw Error('compile');
      }),
    ).toThrow('compile');
    expect(casters.some((light) => light.castShadow)).toBe(false);
    expect(dusk.some((light) => light.visible)).toBe(false);
  });
});

describe('Cycles Night lights', () => {
  it('turns the sun into the pale moon and keeps the Blue hour accent lights', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    const [lounge, ...dusk] = scene.children.filter((child) => child instanceof THREE.SpotLight);
    lighting.update(2, 0, true);
    // scripts/build_night_scene.py: 0.1 W/m² of linear (0.62, 0.74, 1).
    expect(sun.intensity).toBeCloseTo(0.1);
    expect(sun.color.toArray().map((v) => +v.toFixed(3))).toEqual([0.62, 0.74, 1]);
    expect(lounge.intensity).toBe(0);
    expect(dusk.map((light) => +(light.intensity * Math.PI).toFixed(3))).toEqual([42, 8, 8, 8, 35]);
    // The moon's 0.0093 rad disk casts sharper shadows than the sun's.
    expect(sun.shadow.radius).toBeCloseTo(directionalPenumbra(sun.shadow.camera, 0.0093));
    // Between the scenes the sun's colored power blends linearly, like the probes.
    lighting.update(1.5, 0, true);
    expect(sun.intensity).toBeCloseTo(0.5 * 0.045 + 0.5 * 0.1);
    expect(sun.color.r * sun.intensity).toBeCloseTo(0.5 * 0.47 * 0.045 + 0.5 * 0.62 * 0.1);
    lighting.update(0, 0, true);
    expect(sun.intensity).toBeCloseTo(3.2);
    expect(sun.shadow.radius).toBeCloseTo(directionalPenumbra(sun.shadow.camera, 0.085));
  });
});

describe('cached shadows', () => {
  it('updates only when quality changes and releases shadow targets', () => {
    const scene = new THREE.Scene();
    const lighting = createLighting(scene, { toneMappingExposure: 1 } as THREE.WebGLRenderer);
    const sun = scene.children.find((child) => child instanceof THREE.DirectionalLight) as THREE.DirectionalLight;
    const lounge = scene.children.find((child) => child instanceof THREE.SpotLight) as THREE.SpotLight;
    const spots = scene.children.filter((child) => child instanceof THREE.SpotLight);
    const duskLounge = spots[1];
    const maple = spots[5];
    const shadowLights = [sun, ...spots];
    for (const light of spots.slice(2, 5)) {
      expect(light.shadow.radius).toBeCloseTo(spotPenumbra(0.1, 20, 144, 0.28));
    }
    expect(duskLounge.shadow.radius).toBeCloseTo(spotPenumbra(0.1, 20, 144, 2));
    expect(maple.shadow.radius).toBeCloseTo(spotPenumbra(0.1, 20, 144, 0.6));
    lighting.setShadowSize(1024);
    lighting.update(0, 0, true);
    for (const light of shadowLights) {
      expect(light.castShadow).toBe(true);
      expect(light.shadow.autoUpdate).toBe(false);
      expect(light.shadow.mapSize.x).toBe(1024);
      light.shadow.needsUpdate = false;
    }
    lighting.update(0, 0.016, false);
    expect(sun.shadow.needsUpdate).toBe(false);
    // None of these lights move, so lighting changes keep the cached shadows.
    lighting.update(1, 0, true);
    lighting.update(0.5, 0.016, false);
    lighting.update(2, 0, true);
    for (const light of shadowLights) expect(light.shadow.needsUpdate).toBe(false);
    lighting.setShadowSize(2048);
    expect(sun.shadow.mapSize.x).toBe(2048);
    expect(lounge.shadow.needsUpdate).toBe(true);
    const disposed: boolean[] = [];
    for (const light of shadowLights) {
      const target = new THREE.WebGLRenderTarget(16, 16);
      target.addEventListener('dispose', () => disposed.push(true));
      light.shadow.map = target;
    }
    lighting.setShadowSize(0);
    for (const light of shadowLights) {
      expect(light.castShadow).toBe(false);
      expect(light.shadow.map).toBeNull();
    }
    expect(disposed).toHaveLength(7);
    // Re-enable after low quality, then release every allocated shadow on scene teardown.
    lighting.setShadowSize(1024);
    for (const light of shadowLights) {
      expect(light.castShadow).toBe(true);
      expect(light.shadow.needsUpdate).toBe(true);
      const target = new THREE.WebGLRenderTarget(16, 16);
      target.addEventListener('dispose', () => disposed.push(true));
      light.shadow.map = target;
    }
    lighting.dispose();
    expect(disposed).toHaveLength(14);
  });
});
