import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addSpoutTrough, createSpoutWater, fallTime, landing, sheetPoint, SPOUT } from './waterSpout';
import { createIrradianceUniforms } from './irradiance';
import { WAVES } from './waterEffects';

const LEVEL = 0.765;

describe('spout water', () => {
  it('falls clear of the pool coping and lands where the source waves ring out', () => {
    // The coping's inner edge (blender y 4.065) and top (z 1.035), in glTF z and y.
    const [y, z] = sheetPoint(0);
    expect(z).toBeGreaterThan(-4.065);
    expect(y).toBeGreaterThan(1.035);
    // Level along the trough, then falling faster and faster toward the pool.
    expect(sheetPoint(-0.2)).toEqual([y, z - 0.2 * SPOUT.speed]);
    expect(sheetPoint(fallTime(LEVEL))[0]).toBeCloseTo(LEVEL, 9);
    expect(Math.abs(landing(LEVEL) - WAVES.center[1])).toBeLessThan(0.02);
  });

  it('adds the trough in the bronze of the spout box', () => {
    const root = new THREE.Group();
    const bronze = new THREE.MeshStandardMaterial({ name: 'Blackened bronze' });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), bronze));
    expect(addSpoutTrough(root, 1.18)).toBe(1);
    const trough = root.getObjectByName('Spillway trough') as THREE.Mesh;
    expect(trough.material).toBe(bronze);
    trough.geometry.computeBoundingBox();
    const box = trough.geometry.boundingBox!;
    expect(box.max.z).toBeCloseTo(SPOUT.lip, 6);
    expect(box.min.z).toBeLessThan(SPOUT.face);
    expect(box.max.x - box.min.x).toBeCloseTo(SPOUT.width, 6);
    expect(addSpoutTrough(new THREE.Group(), 1.18)).toBe(0);
  });

  it('shares the probes and the water time, and stills the drops with reduced motion', () => {
    const probes = createIrradianceUniforms();
    const time = { value: 3 };
    const spout = createSpoutWater(1.18, LEVEL, probes, time);
    const sheet = spout.sheet as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    expect(sheet.material.uniforms.time).toBe(time);
    expect(sheet.material.uniforms.suiProbeCourtyard).toBe(probes.suiProbeCourtyard);
    expect(sheet.material.fragmentShader).toContain('suiReflection(');
    expect(sheet.castShadow).toBe(false);
    // The sheet runs from inside the box down to the surface.
    sheet.geometry.computeBoundingBox();
    expect(sheet.geometry.boundingBox!.min.y).toBeCloseTo(LEVEL, 6);
    expect(sheet.geometry.boundingBox!.min.z).toBeLessThan(SPOUT.face);
    const drops = spout.mainOnly.find((object) => object instanceof THREE.Points)!;
    spout.update(true);
    expect(drops.visible).toBe(false);
    spout.update(false);
    expect(drops.visible).toBe(true);
  });
});
