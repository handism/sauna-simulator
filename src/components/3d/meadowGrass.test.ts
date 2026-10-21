import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  MEADOW_CELL,
  MEADOW_EXTENT,
  MEADOW_MATERIAL,
  meadowBlades,
  meadowDensity,
  meadowGrid,
  meadowTufts,
  TUFT_CELL,
  TUFT_EXTENT,
  tuftDensity,
} from './meadowGrass';

const plane = (name: string, size: number, y = 0, x = 0, z = 0) => {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(x, y, z),
    new THREE.MeshStandardMaterial({ name }),
  );
  mesh.updateMatrixWorld(true);
  return mesh;
};
const cellOf = (x: number, z: number, size: number) =>
  Math.floor((z + MEADOW_EXTENT) / MEADOW_CELL) * size + Math.floor((x + MEADOW_EXTENT) / MEADOW_CELL);
const seeded = () => {
  let s = 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
};

describe('meadow grass', () => {
  it('grids the ground height and keeps the meadow open only where nothing stands on it', () => {
    const ground = plane(MEADOW_MATERIAL, 40, 0.3);
    const stone = plane('V2 | pale mineral paving', 2, 0.35, 8, 8);
    const roof = plane('roof', 4, 3, -8, 8);
    const grid = meadowGrid([ground], [stone, roof]);
    expect(grid.height[cellOf(8, 0, grid.size)]).toBeCloseTo(0.3, 5);
    expect(grid.open[cellOf(8, 0, grid.size)]).toBe(1);
    // Under the stone and one cell beyond its edge.
    expect(grid.open[cellOf(8, 8, grid.size)]).toBe(0);
    expect(grid.open[cellOf(9 + MEADOW_CELL * 0.5, 8, grid.size)]).toBe(0);
    expect(grid.open[cellOf(10, 8, grid.size)]).toBe(1);
    // A roof high above does not keep the grass out.
    expect(grid.open[cellOf(-8, 8, grid.size)]).toBe(1);
  });

  it('takes only the meadow material, the topmost ground', () => {
    const meadow = plane(MEADOW_MATERIAL, 40, 0);
    const gravel = plane('Fine garden gravel', 4, 0.05, 6, 6);
    const hidden = plane('V2 | pale mineral paving', 4, 0.1, -6, -6);
    hidden.visible = false;
    const grid = meadowGrid([meadow, gravel], [hidden]);
    expect(grid.open[cellOf(6, 6, grid.size)]).toBe(0);
    expect(grid.height[cellOf(6, 6, grid.size)]).toBeCloseTo(0.05, 5);
    expect(grid.open[cellOf(-6, -6, grid.size)]).toBe(1);
  });

  it('thins out with distance to none', () => {
    expect(meadowDensity(0)).toBeGreaterThan(30);
    expect(meadowDensity(7)).toBe(meadowDensity(0));
    expect(meadowDensity(9)).toBeLessThan(meadowDensity(7));
    expect(meadowDensity(12)).toBeLessThan(meadowDensity(9));
    expect(meadowDensity(16)).toBe(0);
    expect(meadowDensity(18)).toBe(0);
    expect(meadowDensity(30)).toBe(0);
  });

  it('roots blades on the ground of open cells, three triangles each, leaning up-lit', () => {
    const ground = plane(MEADOW_MATERIAL, 40, 0.5);
    const grid = meadowGrid([ground], []);
    const { geometry, blades } = meadowBlades(grid, seeded());
    const position = geometry.attributes.position;
    expect(blades).toBeGreaterThan(1000);
    expect(position.count).toBe(blades * 9);
    let low = Infinity,
      high = -Infinity,
      far = 0;
    for (let v = 0; v < position.count; v++) {
      low = Math.min(low, position.getY(v));
      high = Math.max(high, position.getY(v));
      far = Math.max(far, Math.hypot(position.getX(v), position.getZ(v)));
    }
    expect(low).toBeCloseTo(0.48, 5);
    expect(high).toBeLessThan(0.5 + 0.32);
    expect(far).toBeLessThan(16.5);
    const normal = geometry.attributes.normal;
    for (let v = 0; v < normal.count; v += 97) expect(normal.getY(v)).toBeGreaterThan(0.9);
  });

  it('places nothing where no cell is open', () => {
    const grid = meadowGrid([plane('Fine garden gravel', 40)], []);
    expect(meadowBlades(grid, seeded()).blades).toBe(0);
  });

  it('stands taller wild tufts in patches out in the meadow, past the short blades', () => {
    const ground = plane(MEADOW_MATERIAL, 90, 0.2);
    const grid = meadowGrid([ground], [], TUFT_EXTENT, TUFT_CELL);
    expect(grid.size).toBe((2 * TUFT_EXTENT) / TUFT_CELL);
    expect(grid.open[Math.floor(grid.size / 2) * grid.size + grid.size - 4]).toBe(1);
    expect(tuftDensity(5, 0)).toBe(0);
    expect(tuftDensity(0, 41)).toBe(0);
    // Patches: dense in some places, a sparse scatter in others.
    const samples = Array.from({ length: 400 }, (_, i) => tuftDensity(20 + (i % 20), 2 + Math.floor(i / 20)));
    expect(Math.max(...samples)).toBeGreaterThan(2);
    expect(Math.min(...samples)).toBeLessThan(0.2);
    const { geometry, blades } = meadowTufts(grid, seeded());
    const position = geometry.attributes.position;
    expect(blades).toBeGreaterThan(1000);
    expect(position.count).toBe(blades * 9);
    let near = Infinity,
      far = 0,
      high = -Infinity;
    for (let v = 0; v < position.count; v++) {
      const d = Math.hypot(position.getX(v), position.getZ(v));
      near = Math.min(near, d);
      far = Math.max(far, d);
      high = Math.max(high, position.getY(v));
    }
    expect(near).toBeGreaterThan(10.5);
    expect(far).toBeLessThan(40.5);
    expect(high).toBeGreaterThan(0.2 + 0.3);
    expect(high).toBeLessThan(0.2 + 0.8);
  });

  it('widens far tuft blades to keep about a pixel wide', () => {
    const grid = meadowGrid([plane(MEADOW_MATERIAL, 90, 0)], [], TUFT_EXTENT, TUFT_CELL);
    const position = meadowTufts(grid, seeded()).geometry.attributes.position;
    const base = new THREE.Vector3(),
      side = new THREE.Vector3();
    // Each blade's first two vertices are the root's corners: its full width.
    for (let v = 0; v < position.count; v += 9 * 53) {
      base.fromBufferAttribute(position, v);
      side.fromBufferAttribute(position, v + 1);
      // The width follows the tuft's cell center, up to half a meter from the blade's root.
      const d = Math.hypot(base.x, base.z) - 0.5;
      expect(base.distanceTo(side)).toBeGreaterThan(d * 0.0016 * 0.8 * 2);
    }
  });
});
