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
  lightCoverage,
  PROBE_POINT,
  RIM_HEIGHT,
  shBasis,
  sourceSH,
  upwardExit,
  WATER_BOTTOM,
} from './waterBottom';

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
