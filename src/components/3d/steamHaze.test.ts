import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { INTERIOR_BOX } from './interiorLights';
import {
  createHazeUniforms,
  forwardTaps,
  HAZE_FORWARD,
  HAZE_GLSL,
  createSteamHaze,
  HAZE_DECAY_SECONDS,
  HAZE_PER_LOYLY,
  hazeAmount,
  hazeColor,
  hazeLight,
  HAZE_LIGHT,
  HAZE_SOURCES,
  HAZE_COLOR,
  HAZE_SCENES,
} from './steamHaze';

// The seat (scene definition stageViews.sauna) and the stove's steam origin.
const seat = new THREE.Vector3(-3.2, 1.65, -2.78);

describe('room steam haze', () => {
  it('hazes the part of a view ray inside the room only, from a camera in the room', () => {
    const toWall = new THREE.Vector3(0, 0, -1.5);
    const throughGlass = new THREE.Vector3(0, 0, 30);
    expect(hazeAmount(seat, toWall, 0)).toBe(0);
    expect(hazeAmount(seat, toWall, 1)).toBeGreaterThan(0);
    // The garden 30 m out is hazed only up to the glass: like a ray that ends there.
    const toGlass = new THREE.Vector3(0, 0, INTERIOR_BOX.max.z - seat.z);
    expect(hazeAmount(seat, throughGlass, 1)).toBeCloseTo(hazeAmount(seat, toGlass, 1), 10);
    // A camera outside the room (the water's mirror, the other stages) sees none.
    expect(hazeAmount(new THREE.Vector3(1, 1.5, -2), new THREE.Vector3(-5, 0, 0), 1)).toBe(0);
  });

  it('is denser under the ceiling than over the floor', () => {
    const along = new THREE.Vector3(-2, 0, 0);
    const high = hazeAmount(new THREE.Vector3(-2, 3.1, -2), along, 1);
    const low = hazeAmount(new THREE.Vector3(-2, 0.3, -2), along, 1);
    expect(high).toBeGreaterThan(low * 3);
    // Across the room at the seat's height: a light veil, not a fog.
    const across = hazeAmount(seat, new THREE.Vector3(2.5, 0, 0), HAZE_PER_LOYLY);
    expect(across).toBeGreaterThan(0.03);
    expect(across).toBeLessThan(0.15);
  });

  it('spreads in after a löyly, thins out, and clears outside the room', () => {
    const uniforms = createHazeUniforms();
    const haze = createSteamHaze(uniforms);
    let now = 0;
    const run = (seconds: number, active = true) => {
      for (let t = 0; t < seconds; t += 0.05) haze.update((now += 50), active);
      return uniforms.suiSteamHaze.value;
    };
    expect(run(1)).toBe(0);
    haze.start();
    const early = run(0.5);
    const spread = run(4);
    expect(early).toBeGreaterThan(0);
    expect(spread).toBeGreaterThan(early);
    // All of it, less what thinned meanwhile.
    expect(spread).toBeGreaterThan(HAZE_PER_LOYLY * 0.8);
    expect(spread).toBeLessThan(HAZE_PER_LOYLY);
    // A second löyly adds, up to 1.
    haze.start();
    haze.start();
    haze.start();
    expect(run(5)).toBeLessThanOrEqual(1);
    const full = uniforms.suiSteamHaze.value;
    expect(run(HAZE_DECAY_SECONDS)).toBeCloseTo(full / Math.E, 1);
    expect(run(0.1, false)).toBe(0);
  });

  it('dims the steam with the daylight', () => {
    const color = new THREE.Color();
    expect(hazeColor([1, 0, 0], color).r).toBeCloseTo(HAZE_COLOR[0]);
    expect(hazeColor([0, 0, 1], color).g).toBeCloseTo(HAZE_COLOR[1] * HAZE_SCENES[2]);
    expect(hazeColor([0, 0.5, 0.5], color).b).toBeCloseTo(HAZE_COLOR[2] * (HAZE_SCENES[1] + HAZE_SCENES[2]) * 0.5);
  });

  it('glows with the room lights along the view, warm and brighter toward them', () => {
    const color = new THREE.Color();
    // Outside the room, nothing.
    expect(hazeLight(new THREE.Vector3(1, 1.5, -2), new THREE.Vector3(-5, 0, 0), color).r).toBe(0);
    // The 'Steam soft backlight' by the glass, and away from it toward the left wall.
    const backlight = HAZE_SOURCES.reduce((a, b) => (b.intensity.r > a.intensity.r ? b : a)).position;
    const toward = hazeLight(seat, backlight.clone().sub(seat).multiplyScalar(3), new THREE.Color()).r;
    const away = hazeLight(seat, new THREE.Vector3(-15, 0, 0), color).r;
    expect(toward).toBeGreaterThan(away * 2);
    expect(color.r).toBeGreaterThan(color.b * 2);
    // The bench strips shine down: steam over them takes none of their light, steam under them does.
    const strip = HAZE_SOURCES[0].position;
    const along = new THREE.Vector3(2, 0, 0);
    const over = hazeLight(strip.clone().add(new THREE.Vector3(-0.5, 0.4, 0)), along, new THREE.Color()).r;
    const under = hazeLight(strip.clone().add(new THREE.Vector3(-0.5, -0.4, 0)), along, new THREE.Color()).r;
    expect(under).toBeGreaterThan(over * 3);
    // Finite through a light.
    expect(Number.isFinite(hazeLight(strip.clone().add(new THREE.Vector3(-0.5, 0, 0)), along, color).r)).toBe(true);
  });

  it('integrates a light along the ray as the sum of short steps does', () => {
    const origin = seat.clone();
    const ray = new THREE.Vector3(2.2, 0.6, 1.1);
    const exact = hazeLight(origin, ray, new THREE.Color());
    // Midpoint sum of max(cos, 0) / (d² + r²)^(3/2)·d over the same softened distance.
    const steps = 20000;
    const sum = new THREE.Color(0, 0, 0);
    const point = new THREE.Vector3();
    for (let i = 0; i < steps; i++) {
      point.copy(origin).addScaledVector(ray, (i + 0.5) / steps);
      for (const { position, emit, intensity } of HAZE_SOURCES) {
        const d = point.clone().sub(position);
        const cos = emit.dot(d);
        if (cos <= 0) continue;
        const r2 = d.lengthSq() + 0.25 * 0.25;
        sum.add(intensity.clone().multiplyScalar(cos / r2 ** 1.5 / steps));
      }
    }
    sum.multiplyScalar(HAZE_LIGHT / (4 * Math.PI));
    expect(exact.r).toBeCloseTo(sum.r, 4);
    expect(exact.b).toBeCloseTo(sum.b, 4);
  });
  it('blurs the scene for the forward scattering over a disk, weighted to 1 and heavier inside', () => {
    const taps = forwardTaps();
    expect(taps).toHaveLength(HAZE_FORWARD.taps);
    expect(taps.reduce((sum, { w }) => sum + w, 0)).toBeCloseTo(1, 6);
    for (const { x, y } of taps) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
    // Centered: the blur does not shift the scene.
    expect(Math.abs(taps.reduce((sum, { x, w }) => sum + x * w, 0))).toBeLessThan(0.05);
    expect(Math.abs(taps.reduce((sum, { y, w }) => sum + y * w, 0))).toBeLessThan(0.05);
    expect(taps[0].w).toBeGreaterThan(taps[taps.length - 1].w);
    expect(HAZE_GLSL.match(/texture2D\( scene,/g)).toHaveLength(HAZE_FORWARD.taps);
  });
});
