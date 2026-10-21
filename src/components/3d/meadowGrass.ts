import * as THREE from 'three';

// The meadow around the deck was the moss terrain's smooth surface alone: color patches but no
// height, so a few meters out it read as a painted slope. Short bent blades in small tufts stand
// on it near the deck, thinning with distance, in one static mesh (no draw per tuft, no per-frame
// work, no shadow cast). Placing tens of thousands of tufts by raycasting the terrain took too long,
// so the terrain's triangles are drawn once into a height grid, and every other solid surface near
// the ground (deck, stones, pavers, the stream, the garden accents) into a mask of cells to keep clear.

/** Grid spacing (m) and half side of the gridded square around the origin (m). */
export const MEADOW_CELL = 0.25;
export const MEADOW_EXTENT = 16;
/** The terrain material that takes blades: the rolling moss meadow, not the forest floor or gravel. */
export const MEADOW_MATERIAL = 'V9 | layered living moss';
/** Tufts per square meter near the deck, and the distances (m) over which they thin out to none. */
const DENSITY = 36;
const THIN_FROM = 7;
const THIN_TO = 16;
/** Surfaces this far above the ground (m) keep the blades out; higher ones (roofs, crowns) do not. */
const CLEARANCE = 0.45;

interface GridShape {
  size: number;
  /** Half side of the gridded square around the origin (m). */
  extent: number;
  /** Grid spacing (m). */
  cellSize: number;
}

export interface MeadowGrid extends GridShape {
  /** Ground height per cell (NaN where no terrain), rows along +z. */
  height: Float32Array;
  /** 1 where the top terrain is the meadow and nothing stands on it. */
  open: Uint8Array;
}

type Triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => void;

function eachTriangle(mesh: THREE.Mesh, visit: Triangle) {
  const position = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const count = index ? index.count : position.count;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i + 2 < count; i += 3) {
    const at = (k: number) => (index ? index.getX(k) : k);
    a.fromBufferAttribute(position, at(i)).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, at(i + 1)).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, at(i + 2)).applyMatrix4(mesh.matrixWorld);
    visit(a, b, c);
  }
}

/** Calls `cell(i, j, y)` for each cell center inside the triangle's ground footprint, with its height there. */
function rasterize(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  { size, extent, cellSize }: GridShape,
  cell: (i: number, j: number, y: number) => void,
) {
  const area = (b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z);
  if (Math.abs(area) < 1e-9) return;
  const toCell = (v: number) => (v + extent) / cellSize - 0.5;
  const i0 = Math.max(0, Math.ceil(toCell(Math.min(a.x, b.x, c.x))));
  const i1 = Math.min(size - 1, Math.floor(toCell(Math.max(a.x, b.x, c.x))));
  const j0 = Math.max(0, Math.ceil(toCell(Math.min(a.z, b.z, c.z))));
  const j1 = Math.min(size - 1, Math.floor(toCell(Math.max(a.z, b.z, c.z))));
  for (let j = j0; j <= j1; j++) {
    const z = (j + 0.5) * cellSize - extent;
    for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * cellSize - extent;
      const u = ((b.x - x) * (c.z - z) - (c.x - x) * (b.z - z)) / area;
      const v = ((c.x - x) * (a.z - z) - (a.x - x) * (c.z - z)) / area;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      cell(i, j, u * a.y + v * b.y + w * c.y);
    }
  }
}

/**
 * The ground's height and the open meadow cells around the origin. `terrain` are the ground meshes;
 * `solids` everything else that may stand on the ground (filtered here to visible meshes).
 */
export function meadowGrid(
  terrain: THREE.Mesh[],
  solids: THREE.Mesh[],
  extent = MEADOW_EXTENT,
  cellSize = MEADOW_CELL,
): MeadowGrid {
  const size = Math.round((2 * extent) / cellSize);
  const shape = { size, extent, cellSize };
  const height = new Float32Array(size * size).fill(NaN);
  const meadow = new Uint8Array(size * size);
  for (const mesh of terrain) {
    const isMeadow = !Array.isArray(mesh.material) && mesh.material.name === MEADOW_MATERIAL;
    eachTriangle(mesh, (a, b, c) =>
      rasterize(a, b, c, shape, (i, j, y) => {
        const k = j * size + i;
        if (!(y <= height[k])) {
          height[k] = y;
          meadow[k] = isMeadow ? 1 : 0;
        }
      }),
    );
  }
  const blocked = new Uint8Array(size * size);
  for (const mesh of solids) {
    if (!mesh.visible) continue;
    eachTriangle(mesh, (a, b, c) =>
      rasterize(a, b, c, shape, (i, j, y) => {
        const k = j * size + i;
        const above = y - height[k];
        if (above > -0.1 && above < CLEARANCE) blocked[k] = 1;
      }),
    );
  }
  // One cell of margin, so tufts do not lean into a stone's side or poke out under a plank's edge.
  const open = new Uint8Array(size * size);
  for (let j = 1; j < size - 1; j++)
    for (let i = 1; i < size - 1; i++) {
      const k = j * size + i;
      if (!meadow[k] || Number.isNaN(height[k])) continue;
      let clear = true;
      for (let dj = -1; dj <= 1 && clear; dj++)
        for (let di = -1; di <= 1; di++) if (blocked[k + dj * size + di]) clear = false;
      if (clear) open[k] = 1;
    }
  return { size, extent, cellSize, height, open };
}

/** Upper bound of tufts per square meter at distance `d` (m), before local patch thinning. */
export function meadowDensity(d: number) {
  const t = Math.min(1, Math.max(0, (d - THIN_FROM) / (THIN_TO - THIN_FROM)));
  return DENSITY * (1 - t) * (1 - t);
}

interface Blade {
  x: number;
  z: number;
  /** Ground height at the root (m). */
  y: number;
  height: number;
  lean: number;
  bend: number;
  width: number;
  tint: number;
  dry: boolean;
}

/**
 * Collects blades into one non-indexed geometry with position, normal and color. Three triangles
 * each: two tapered sections and a tip. Normals lean mostly up (with `SUI_CROWN_NORMAL`, not turned
 * to the viewer), so a blade seen from behind is lit as the ground it grows from instead of going dark.
 */
function bladeWriter() {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const face = new THREE.Vector3();
  const across = new THREE.Vector3();
  const along = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const levels = [0, 0, 0.55, 0.55, 1];
  let blades = 0;
  return {
    add({ x, z, y, height, lean, bend, width, tint, dry }: Blade) {
      along.set(Math.cos(lean), 0, Math.sin(lean));
      across.set(-along.z, 0, along.x);
      const point = (s: number, side: number) => {
        const half = width * (1 - s * 0.85);
        return [
          x + along.x * bend * s * s + across.x * half * side,
          y - 0.02 + height * (s - 0.25 * s * s * s),
          z + along.z * bend * s * s + across.z * half * side,
        ];
      };
      const corners = [point(0, -1), point(0, 1), point(0.55, -1), point(0.55, 1), point(1, 0)];
      // The blade's own facing (toward its lean), mostly overruled by up.
      face.copy(along).multiplyScalar(-0.3).add(up).normalize();
      const shade = (s: number) => {
        // Darker at the root, where the neighboring blades shade it; dry blades are straw.
        const light = tint * (0.48 + 0.38 * s);
        return dry ? [light * 1.12, light * 1.05, light * 0.78] : [light, light, light * 0.9];
      };
      for (const v of [0, 1, 3, 0, 3, 2, 2, 3, 4]) {
        positions.push(...corners[v]);
        normals.push(face.x, face.y, face.z);
        colors.push(...shade(levels[v]));
      }
      blades++;
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeBoundingSphere();
      return { geometry, blades };
    },
  };
}

/** Short blades in small tufts near the deck, thinning out by `THIN_TO`. */
export function meadowBlades(grid: MeadowGrid, random: () => number) {
  const writer = bladeWriter();
  const cellArea = grid.cellSize * grid.cellSize;
  for (let j = 0; j < grid.size; j++)
    for (let i = 0; i < grid.size; i++) {
      const k = j * grid.size + i;
      if (!grid.open[k]) continue;
      const cx = (i + 0.5) * grid.cellSize - grid.extent;
      const cz = (j + 0.5) * grid.cellSize - grid.extent;
      const distance = Math.hypot(cx, cz);
      const patch = 0.72 + 0.28 * Math.sin(cx * 1.7 + Math.sin(cz * 0.9)) * Math.sin(cz * 1.3);
      const expected = meadowDensity(distance) * cellArea * patch;
      let tufts = Math.floor(expected);
      if (random() < expected - tufts) tufts++;
      const lod = Math.min(1, Math.max(0, (distance - THIN_FROM) / (THIN_TO - THIN_FROM)));
      const minBlades = Math.round(4 - 2 * lod);
      const bladeSpan = Math.round(5 - 2 * lod);
      const widthScale = 1 + 0.35 * lod;
      for (let t = 0; t < tufts; t++) {
        const tx = cx + (random() - 0.5) * grid.cellSize;
        const tz = cz + (random() - 0.5) * grid.cellSize;
        const y = grid.height[k];
        const tuftHeight = 0.08 + random() * 0.13;
        const tuftTint = 0.7 + random() * 0.22;
        const dry = random() < 0.07;
        const count = minBlades + Math.floor(random() * bladeSpan);
        for (let n = 0; n < count; n++) {
          const a = random() * Math.PI * 2;
          const r = Math.sqrt(random()) * 0.06;
          const height = tuftHeight * (0.6 + random() * 0.55);
          const lean = random() * Math.PI * 2;
          const bend = height * (0.15 + random() * 0.45);
          const width = (0.005 + random() * 0.006) * widthScale;
          const tint = tuftTint * (0.9 + random() * 0.18);
          writer.add({ x: tx + Math.cos(a) * r, z: tz + Math.sin(a) * r, y, height, lean, bend, width, tint, dry });
        }
      }
    }
  return writer.finish();
}

/** Half side (m) and spacing (m) of the coarser grid for the wild tufts out in the meadow. */
export const TUFT_EXTENT = 40;
export const TUFT_CELL = 0.5;
/** Wild tufts per square meter inside a patch, and where (m) they fade in past the short blades and out. */
const TUFT_DENSITY = 2.6;
const TUFT_IN: [number, number] = [11, 15];
const TUFT_OUT: [number, number] = [33, 40];
/** Screen-space floor on blade width: radians per blade, so far blades stay about a pixel or more wide. */
const TUFT_ANGULAR_WIDTH = 0.0016;

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Share of the wild tufts' density at (x, z): patches several meters across where taller grass
 * stands together, with a sparse scatter between them.
 */
export function tuftPatch(x: number, z: number) {
  const wave =
    0.5 + 0.5 * Math.sin(x * 0.33 + 1.9 * Math.sin(z * 0.21)) * Math.sin(z * 0.29 + 1.3 * Math.sin(x * 0.17));
  return 0.04 + 0.96 * smooth(0.5, 0.78, wave);
}

/** Wild tufts per square meter at (x, z), `d` (m) from the origin. */
export function tuftDensity(x: number, z: number, d = Math.hypot(x, z)) {
  return TUFT_DENSITY * tuftPatch(x, z) * smooth(...TUFT_IN, d) * (1 - smooth(...TUFT_OUT, d));
}

/**
 * Taller, looser tufts of wild grass beyond the short blades. The source meadow was one smooth
 * green from the blades' end to the woodland, a mown lawn at mid distance; patches of taller
 * grass (some of it straw) break it up with standing height. Blades widen with distance so they
 * stay about a pixel wide instead of shimmering as subpixel slivers.
 */
export function meadowTufts(grid: MeadowGrid, random: () => number) {
  const writer = bladeWriter();
  const cellArea = grid.cellSize * grid.cellSize;
  for (let j = 0; j < grid.size; j++)
    for (let i = 0; i < grid.size; i++) {
      const k = j * grid.size + i;
      if (!grid.open[k]) continue;
      const cx = (i + 0.5) * grid.cellSize - grid.extent;
      const cz = (j + 0.5) * grid.cellSize - grid.extent;
      const distance = Math.hypot(cx, cz);
      const expected = tuftDensity(cx, cz, distance) * cellArea;
      if (expected <= 0) continue;
      let tufts = Math.floor(expected);
      if (random() < expected - tufts) tufts++;
      for (let t = 0; t < tufts; t++) {
        const tx = cx + (random() - 0.5) * grid.cellSize;
        const tz = cz + (random() - 0.5) * grid.cellSize;
        const y = grid.height[k];
        const tuftHeight = 0.2 + random() * 0.28;
        const tuftTint = 0.68 + random() * 0.26;
        const dryTuft = random() < 0.2;
        const minWidth = distance * TUFT_ANGULAR_WIDTH;
        const count = 5 + Math.floor(random() * 4);
        for (let n = 0; n < count; n++) {
          const a = random() * Math.PI * 2;
          const r = Math.sqrt(random()) * 0.1;
          const height = tuftHeight * (0.55 + random() * 0.6);
          const lean = random() * Math.PI * 2;
          const bend = height * (0.25 + random() * 0.5);
          const width = Math.max(0.006 + random() * 0.006, minWidth * (0.8 + random() * 0.45));
          const tint = tuftTint * (0.88 + random() * 0.22);
          const dry = dryTuft || random() < 0.12;
          writer.add({ x: tx + Math.cos(a) * r, z: tz + Math.sin(a) * r, y, height, lean, bend, width, tint, dry });
        }
      }
    }
  return writer.finish();
}
