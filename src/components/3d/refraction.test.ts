import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WATER_BOX } from './interiorLights';
import {
  applyRefraction,
  apparentDepth,
  SLICE_SPACING,
  sliceUnderwater,
  WATER_IOR,
  waterTransmittance,
} from './refraction';

const LEVEL = 0.785;

function area(geometry: THREE.BufferGeometry, matrix = new THREE.Matrix4()) {
  const position = geometry.getAttribute('position');
  const index = geometry.index!.array;
  const [a, b, c] = [0, 1, 2].map(() => new THREE.Vector3());
  let sum = 0;
  for (let t = 0; t < index.length; t += 3) {
    a.fromBufferAttribute(position, index[t]).applyMatrix4(matrix);
    b.fromBufferAttribute(position, index[t + 1]).applyMatrix4(matrix);
    c.fromBufferAttribute(position, index[t + 2]).applyMatrix4(matrix);
    sum += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return sum;
}

// A tub wall of the source: one quad from the tiles to above the coping, along z.
function wall() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [-0.16, 0.25, -0.62, -0.16, 0.93, -0.62, -0.16, 0.93, -4.38, -0.16, 0.25, -4.38],
      3,
    ),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

describe('refraction', () => {
  it('puts the image at the apparent depth of a flat water surface', () => {
    // Straight down: depth / n.
    expect(apparentDepth(0.4, 0.6, 0)).toBeCloseTo(0.6 / WATER_IOR, 6);
    // The refracted ray through the surface point obeys Snell's law and ends at the point, and
    // the image lies on the camera ray through that surface point, above the point.
    for (const [height, depth, distance] of [
      [0.34, 0.58, 0.4],
      [0.34, 0.2, 2.5],
      [1.5, 0.5, 1.0],
    ]) {
      const image = apparentDepth(height, depth, distance);
      const x = (distance * height) / (height + image);
      const sin1 = x / Math.hypot(x, height);
      const sin2 = (distance - x) / Math.hypot(distance - x, depth);
      expect(sin1).toBeCloseTo(WATER_IOR * sin2, 5);
      expect(image).toBeLessThan(depth / WATER_IOR + 1e-9);
    }
    // Grazing views flatten the image.
    expect(apparentDepth(0.34, 0.5, 3)).toBeLessThan(apparentDepth(0.34, 0.5, 0.5) / 2);
  });

  it('cuts a tub wall at the surface and on the grid without changing its shape', () => {
    const geometry = wall();
    const before = area(geometry);
    const { triangles: added, materials } = sliceUnderwater(geometry, new THREE.Matrix4(), LEVEL);
    expect([...materials]).toEqual([0]);
    expect(added).toBeGreaterThan(0);
    expect(geometry.index!.count / 3).toBe(2 + added);
    expect(area(geometry)).toBeCloseTo(before, 6);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    const normal = geometry.getAttribute('normal');
    const index = geometry.index!.array;
    for (let t = 0; t < index.length; t += 3) {
      const corners = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, index[t + k]));
      // Every triangle lies on one side of the surface; those under it in the plunge are small.
      const ys = corners.map((c) => c.y);
      expect(Math.min(...ys) >= LEVEL - 1e-6 || Math.max(...ys) <= LEVEL + 1e-6).toBe(true);
      const inPlunge = corners.every((c) => c.z >= WATER_BOX.min.z - 1e-6 && c.z <= WATER_BOX.max.z + 1e-6);
      if (Math.max(...ys) <= LEVEL + 1e-6 && inPlunge)
        for (let e = 0; e < 3; e++)
          expect(corners[e].distanceTo(corners[(e + 1) % 3])).toBeLessThanOrEqual(SLICE_SPACING * Math.SQRT2 + 1e-6);
    }
    // Attributes stay linear over the quad.
    for (let i = 0; i < position.count; i++) {
      expect(uv.getY(i)).toBeCloseTo((position.getY(i) - 0.25) / 0.68, 5);
      expect(uv.getX(i)).toBeCloseTo((-0.62 - position.getZ(i)) / 3.76, 5);
      expect(normal.getX(i)).toBeCloseTo(1, 6);
    }
  });

  it('cuts in world space, keeps material groups and leaves dry or small geometry alone', () => {
    const geometry = wall();
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);
    // The source wall object is scaled along y and moved.
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0.05, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(1, 0.95, 1),
    );
    const before = area(geometry, matrix);
    expect([...sliceUnderwater(geometry, matrix, LEVEL).materials]).toEqual([0, 1]);
    expect(area(geometry, matrix)).toBeCloseTo(before, 6);
    expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(geometry.groups[1].start).toBe(geometry.groups[0].count);
    expect(geometry.groups[0].count + geometry.groups[1].count).toBe(geometry.index!.count);

    const dry = wall().translate(-2, 0, 0);
    expect(sliceUnderwater(dry, new THREE.Matrix4(), LEVEL)).toEqual({ triangles: 0, materials: new Set() });
    // Small tiles are drawn refracted without cutting.
    const tile = new THREE.PlaneGeometry(0.19, 0.19).rotateX(-Math.PI / 2).translate(1, 0.2, -2);
    expect(sliceUnderwater(tile, new THREE.Matrix4(), LEVEL)).toEqual({ triangles: 0, materials: new Set([0]) });
  });

  it('marks the materials of meshes under the water', () => {
    const root = new THREE.Group();
    const wet = new THREE.MeshStandardMaterial();
    const dry = new THREE.MeshStandardMaterial();
    // A mesh reaching into the plunge whose dry material has no triangle under the water.
    const both = wall();
    const beside = new THREE.PlaneGeometry(0.3, 0.3).translate(-1, 1, -2);
    const merged = new THREE.BufferGeometry();
    merged.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...both.getAttribute('position').array, ...beside.getAttribute('position').array],
        3,
      ),
    );
    merged.setIndex([...both.index!.array, ...Array.from(beside.index!.array, (i) => i + 4)]);
    merged.addGroup(0, 6, 0);
    merged.addGroup(6, 6, 1);
    const shared = new THREE.MeshStandardMaterial();
    root.add(
      new THREE.Mesh(wall(), wet),
      new THREE.Mesh(wall().translate(-2, 0, 0), dry),
      new THREE.Mesh(merged, [new THREE.MeshStandardMaterial(), shared]),
    );
    const result = applyRefraction(root, LEVEL);
    expect(result.materials).toBe(2);
    expect(shared.defines?.SUI_REFRACTION).toBeUndefined();
    expect(result.triangles).toBeGreaterThan(0);
    expect(wet.defines?.SUI_REFRACTION).toBe('0.7850');
    expect(dry.defines?.SUI_REFRACTION).toBeUndefined();
    expect(THREE.ShaderChunk.project_vertex).toContain('#ifdef SUI_REFRACTION');
    expect(THREE.ShaderChunk.opaque_fragment).toContain('vSuiWaterPath');
  });

  it('tints the view through the water as the source surface and volume do', () => {
    // Surface only: the Base Color of the transmissive source water.
    expect(waterTransmittance(0)).toEqual([0.93, 0.985, 0.975]);
    // Cycles volume absorption: exp(−density·(1 − color)·d), here over 1 m.
    const meter = waterTransmittance(1);
    [0.57, 0.84, 0.78].forEach((color, i) =>
      expect(meter[i]).toBeCloseTo(waterTransmittance(0)[i] * Math.exp(-0.12 * (1 - color)), 9),
    );
    // Red is absorbed most, so the deep view turns teal.
    expect(meter[0] / meter[1]).toBeLessThan(waterTransmittance(0)[0] / waterTransmittance(0)[1]);
  });
});
