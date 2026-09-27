import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLOSSY_SOURCES } from './glossyLights';
import { VIEW_TINT, WATER_IOR, WATER_VOLUME, waterAirReflectance } from './refraction';
import {
  applyWaterBottom,
  bottomExit,
  bottomLightRadiance,
  bottomLights,
  bottomReflectance,
  clearsRim,
  DISK_WIDENING,
  lightCoverage,
  lightThroughWater,
  PROBE_POINT,
  RIM_HEIGHT,
  shBasis,
  sourceSH,
  upwardExit,
  WATER_BOTTOM,
  wetGlossLights,
} from './waterBottom';
import { WATER_ABSORPTION, WATER_TINT } from './refraction';

const LEVEL = WATER_VOLUME.max.y;
const source = (name: string) => GLOSSY_SOURCES.find(([n]) => n === name)!;

/** The camera ray `air` (going down) refracted into the flat surface. */
function refracted(air: THREE.Vector3) {
  const a = air.clone().normalize();
  const eta = 1 / WATER_IOR;
  const cos = -a.y;
  return a
    .multiplyScalar(eta)
    .add(new THREE.Vector3(0, 1, 0).multiplyScalar(eta * cos - Math.sqrt(1 - eta * eta * (1 - cos * cos))));
}

describe('water bottom reflection', () => {
  it('reflects 2% looking straight down and nearly all at the steepest refracted grazing view', () => {
    expect(bottomReflectance(new THREE.Vector3(0, -1, 0))).toBeCloseTo(0.02, 3);
    const grazing = refracted(new THREE.Vector3(1, -0.01, 0));
    expect(bottomReflectance(grazing)).toBeGreaterThan(0.9);
    expect(bottomReflectance(refracted(new THREE.Vector3(1, -0.5, 0.3)))).toBeCloseTo(
      waterAirReflectance(-refracted(new THREE.Vector3(1, -0.5, 0.3)).y),
      9,
    );
  });

  it('leaves a flat surface along the camera ray mirrored upward, away from the sides', () => {
    const air = new THREE.Vector3(0.3, -0.6, 0.4).normalize();
    const floor = new THREE.Vector3(1.0, 0.202, -2.6);
    const exit = bottomExit(floor, refracted(air), LEVEL)!;
    expect(exit.direction.x).toBeCloseTo(air.x, 6);
    expect(exit.direction.y).toBeCloseTo(-air.y, 6);
    expect(exit.direction.z).toBeCloseTo(air.z, 6);
    expect(exit.point.y).toBeCloseTo(LEVEL, 9);
    // Same angle as it came in: the surface reflects what the view's entry did.
    expect(exit.reflectance).toBeCloseTo(waterAirReflectance(-refracted(air).y), 6);
    expect(exit.transmittance + exit.reflectance).toBeCloseTo(1, 9);
    // It starts on the bottom face above the floor point and rises as steeply as it came down.
    const rise = LEVEL - WATER_BOTTOM;
    expect(exit.path).toBeCloseTo(rise / -refracted(air).y, 6);
  });

  it('reflects off a side on the way up, totally past the critical angle', () => {
    // Close to the +x side, going toward it.
    const d = refracted(new THREE.Vector3(1, -0.6, 0.1));
    const floor = new THREE.Vector3(WATER_VOLUME.max.x - 0.05, 0.202, -2.5);
    const exit = bottomExit(floor, d, LEVEL)!;
    expect(exit.direction.x).toBeLessThan(0);
    expect(exit.point.x).toBeLessThan(WATER_VOLUME.max.x);
    // Across the side: |d.x| below √(1 − 1/n²), so fully reflected.
    expect(exit.transmittance + exit.reflectance).toBeCloseTo(1, 9);
    // A partial side reflection loses the part that leaves into the wall.
    const partial = upwardExit(
      new THREE.Vector3(WATER_VOLUME.max.x - 0.01, 0.5, -2.5),
      new THREE.Vector3(0.7, 0.7, 0),
      LEVEL,
    )!;
    const across = new THREE.Vector3(0.7, 0.7, 0).normalize().x;
    expect(partial.transmittance + partial.reflectance).toBeCloseTo(waterAirReflectance(across), 6);
    expect(upwardExit(new THREE.Vector3(1, 0.5, -2.5), new THREE.Vector3(0, -1, 0), LEVEL)).toBeNull();
  });

  it('refracts about the rippled normal where it leaves', () => {
    const tilt = new THREE.Vector3(0.05, 1, 0).normalize();
    const exit = upwardExit(new THREE.Vector3(1, 0.5, -2.5), new THREE.Vector3(0, 1, 0), LEVEL, () => tilt)!;
    // Snell about the tilted normal: sinθ_out = n·sinθ_in.
    const sinIn = Math.sqrt(1 - tilt.y ** 2);
    const sinOut = new THREE.Vector3().crossVectors(exit.direction, tilt).length();
    expect(sinOut).toBeCloseTo(WATER_IOR * sinIn, 6);
  });

  it('meets the tub below its rim', () => {
    const point = new THREE.Vector3(WATER_VOLUME.max.x - 0.1, LEVEL, -2.5);
    expect(clearsRim(point, new THREE.Vector3(1, 0.5, 0).normalize())).toBe(false);
    const rise = (RIM_HEIGHT - LEVEL) / 0.1;
    expect(clearsRim(point, new THREE.Vector3(1, rise * 1.1, 0).normalize())).toBe(true);
    expect(clearsRim(point, new THREE.Vector3(0, 1, 0))).toBe(true);
  });

  it('sees the lights above the water that face it and transmission rays see, sharp and on their front only', () => {
    const names = bottomLights().map(([name]) => name);
    // The V7 strip is seen by glossy rays only; the rest are below the water or face away.
    expect(names).toEqual(['V9 lounge patch of sunlight', 'V10 lounge dusk fill']);
    const fill = source('V10 lounge dusk fill');
    const center = new THREE.Vector3().fromArray(fill[5]);
    const origin = new THREE.Vector3(1.8, LEVEL, -1.5);
    const toward = center.clone().sub(origin).normalize();
    expect(lightCoverage(fill, origin, toward)).toBe(1);
    const x = new THREE.Vector3().fromArray(fill[6]).normalize();
    const edge = (r: number) => center.clone().addScaledVector(x, r).sub(origin).normalize();
    expect(lightCoverage(fill, origin, edge(1))).toBeCloseTo(0.5, 2);
    expect(lightCoverage(fill, origin, edge(1.1))).toBe(0);
    // Its back does not shine.
    expect(lightCoverage(fill, center.clone().addScaledVector(toward, 1), toward)).toBe(0);
    const dusk = bottomLightRadiance(LEVEL, origin, toward, 1);
    expect(dusk[0]).toBeCloseTo(42 / (Math.PI * Math.PI), 4);
    expect(dusk[1] / dusk[0]).toBeCloseTo(0.7, 6);
    expect(bottomLightRadiance(LEVEL, origin, toward, 0)[0]).toBeCloseTo(3.36 / (Math.PI * Math.PI), 4);
  });

  it('projects a light onto the L2 basis of the probes as seen from above the pool', () => {
    const strip = source('V7 water reflection soft strip');
    const [day, dusk] = sourceSH(strip, PROBE_POINT);
    expect(dusk).toEqual(day);
    // Close to a point light: radiance × solid angle × the basis toward it.
    const center = new THREE.Vector3().fromArray(strip[5]);
    const toward = center.clone().sub(PROBE_POINT);
    const solid =
      (2.2 * 1.6 * -toward.clone().normalize().dot(new THREE.Vector3().fromArray(strip[7]).normalize())) /
      toward.lengthSq();
    const radiance = 65 / (Math.PI * 2.2 * 1.6);
    const basis = shBasis(toward.normalize());
    // Within 10% of it: the strip is 2.2 m wide 4 m away.
    for (const k of [0, 1, 3]) expect(Math.abs(day[k][2] / (radiance * solid * basis[k]) - 1)).toBeLessThan(0.1);
    expect(day[0][0] / day[0][2]).toBeCloseTo(0.78, 6);
    // Its back is dark.
    const above = center.clone().add(new THREE.Vector3(0, 1, 0));
    expect(sourceSH(strip, above)[0][0]).toEqual([0, 0, 0]);
  });

  it('marks only the materials drawn through the water that lie under its bottom', () => {
    const floor = new THREE.MeshStandardMaterial();
    floor.defines = { SUI_REFRACTION: LEVEL.toFixed(4) };
    const wall = new THREE.MeshStandardMaterial();
    wall.defines = { SUI_REFRACTION: LEVEL.toFixed(4) };
    const dry = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    const tiles = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), floor);
    tiles.position.set(1.2, 0.202, -2.5);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5).rotateY(Math.PI / 2), wall);
    side.position.set(WATER_VOLUME.max.x + 0.006, 0.5, -2.5);
    const deck = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), dry);
    deck.position.set(1.2, 0.202, -2.5);
    root.add(tiles, side, deck);
    expect(applyWaterBottom(root)).toBe(1);
    expect(floor.defines.SUI_WATER_BOTTOM).toBe('');
    expect(wall.defines.SUI_WATER_BOTTOM).toBeUndefined();
    expect(dry.defines?.SUI_WATER_BOTTOM).toBeUndefined();
  });

  it('adds its shader code before the view tint', () => {
    const opaque = THREE.ShaderChunk.opaque_fragment;
    expect(opaque.indexOf('suiBottomReflection(')).toBeGreaterThan(0);
    expect(opaque.indexOf('suiBottomReflection(')).toBeLessThan(opaque.indexOf(VIEW_TINT));
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('vec4 suiBottomReflection(');
    expect(THREE.ShaderChunk.lights_pars_begin.split('vec4 suiBottomReflection(')).toHaveLength(2);
  });
});

/** three's BRDF_GGX (F0 0.04, f90 1) with UE4 alpha. */
function ggx(l: THREE.Vector3, v: THREE.Vector3, n: THREE.Vector3, alpha: number) {
  const h = l.clone().add(v).normalize();
  const nl = Math.max(0, n.dot(l)),
    nv = Math.max(1e-4, n.dot(v)),
    nh = Math.max(0, n.dot(h));
  const f = 0.04 + 0.96 * (1 - Math.max(0, v.dot(h))) ** 5;
  const a2 = alpha * alpha;
  const vis = 0.5 / (nl * Math.sqrt(a2 + (1 - a2) * nv * nv) + nv * Math.sqrt(a2 + (1 - a2) * nl * nl));
  return (f * vis * a2) / (Math.PI * (nh * nh * (a2 - 1) + 1) ** 2);
}

describe('light highlights on the floor below the water', () => {
  it('keeps V9 and the dusk fill, scaling V9 down as the source clamp does', () => {
    const lights = wetGlossLights();
    expect(lights.map(({ name }) => name)).toEqual(['V9 lounge patch of sunlight', 'V10 lounge dusk fill']);
    expect(lights[0].radius).toBeCloseTo(0.625, 6);
    expect(lights[0].scale).toBeCloseTo(0.17, 2);
    expect(lights[1].scale).toBe(1);
  });

  it('passes both faces of the water, the tint twice and the absorption along the refracted path', () => {
    const up = lightThroughWater(new THREE.Vector3(0, 1, 0));
    const r = waterAirReflectance(1);
    up.forEach((value, i) =>
      expect(value).toBeCloseTo(
        (1 - r) ** 2 * WATER_TINT[i] ** 2 * Math.exp(-WATER_ABSORPTION[i] * (LEVEL - WATER_BOTTOM)),
        6,
      ),
    );
    const low = lightThroughWater(new THREE.Vector3(1, 0.05, 0).normalize());
    low.forEach((value, i) => expect(value).toBeLessThan(up[i]));
  });

  it('widens the highlight of a point at the V9 disk to its integral over the disk', () => {
    const [v9] = wetGlossLights();
    const [, , , , , , axis, facing] = source('V9 lounge patch of sunlight');
    const n = new THREE.Vector3(0, 1, 0);
    const center = new THREE.Vector3().fromArray(v9.position);
    const back = new THREE.Vector3().fromArray(facing).normalize();
    const x = new THREE.Vector3().fromArray(axis).normalize();
    const y = new THREE.Vector3().crossVectors(back, x);
    for (const [px, pz, tilt] of [
      [0.2, -1.2, 0],
      [1.2, -2.5, 0.1],
      [2.3, -3.8, -0.1],
    ]) {
      const p = new THREE.Vector3(px, 0.202, pz);
      const toCenter = center.clone().sub(p);
      const d = toCenter.length();
      toCenter.normalize();
      // The view that sees the highlight's peak, tilted towards its tail.
      const v = new THREE.Vector3(-toCenter.x + tilt, toCenter.y, -toCenter.z).normalize();
      let exact = 0;
      const steps = 60,
        cell = (2 * v9.radius) / steps;
      for (let i = 0; i < steps; i++)
        for (let j = 0; j < steps; j++) {
          const u = (i + 0.5) * cell - v9.radius,
            w = (j + 0.5) * cell - v9.radius;
          if (u * u + w * w > v9.radius ** 2) continue;
          const l = center.clone().addScaledVector(x, u).addScaledVector(y, w).sub(p);
          const r2 = l.lengthSq();
          l.normalize();
          exact += (ggx(l, v, n, 0.09) * Math.max(0, n.dot(l)) * Math.max(0, -l.dot(back)) * cell * cell) / r2;
        }
      const alpha = Math.sqrt(0.09 ** 2 + DISK_WIDENING * (v9.radius / d) ** 2);
      const point =
        (ggx(toCenter, v, n, alpha) * n.dot(toCenter) * Math.PI * v9.radius ** 2 * -toCenter.dot(back)) / d ** 2;
      expect(point / exact).toBeGreaterThan(0.9);
      expect(point / exact).toBeLessThan(1.1);
    }
  });

  it('gives the floor under the water only the highlight of the spot lights', () => {
    const begin = THREE.ShaderChunk.lights_fragment_begin;
    const call = begin.indexOf('suiWetSpecular(');
    expect(begin.split('suiWetSpecular(')).toHaveLength(3);
    expect(call).toBeGreaterThan(begin.indexOf('spotLight = spotLights[ i ];'));
    expect(call).toBeLessThan(begin.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'));
    expect(THREE.ShaderChunk.lights_physical_pars_fragment.split('void suiWetSpecular(')).toHaveLength(2);
    // One highlight per light after the loop, not one per unrolled spot light.
    expect(begin.indexOf('suiWetLight(')).toBeLessThan(
      begin.indexOf('#pragma unroll_loop_end', begin.indexOf('spotLight = spotLights[ i ];')),
    );
  });
});
