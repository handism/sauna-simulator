import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { meadowBlades, meadowGrid } from './meadowGrass';
import { createFarForest } from './farForest';
import { gardenBloomGeometry } from './gardenBloom';
import { createGardenStream, streamSection } from './gardenStream';
import type { Season } from './season';

/** A deterministic generator in [0, 1), so every load builds the same garden. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A unit rock: an icosphere with a lumpy, flattened-bottom outline and smooth normals. */
export function rockGeometry(seed: number) {
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  sphere.deleteAttribute('normal');
  sphere.deleteAttribute('uv');
  const geometry = mergeVertices(sphere);
  sphere.dispose();
  const position = geometry.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const lump =
      1 +
      0.13 * Math.sin(p.x * 2.7 + seed * 1.3) * Math.cos(p.z * 2.3 - seed) +
      0.08 * Math.sin(p.y * 4.1 + p.x * 1.7 + seed * 2.1);
    p.multiplyScalar(lump);
    // Rocks settle on a broad base.
    if (p.y < -0.25) p.y = -0.25 + (p.y + 0.25) * 0.45;
    position.setXYZ(i, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** A contact shade: [x, z, half width, half depth, margin, depth, the height its stone rests below]. */
type Contact = [number, number, number, number, number, number, number?];

/**
 * The source model's stones on the ground (the terrace plinth, the stepping-stone row and boulders),
 * as contact shades in world space: one per connected piece of the merged stone mesh whose base meets
 * its support or overhangs it. The stepping stones sit on the plinth's edge and overhang a gravel
 * trench 0.4m below; without the source's occlusion they looked laid on the lit plinth. Interior
 * and raised stones and pebbles in the gravel are left out. `support` gives the surface under a point
 * below a height: the terrain or the top of a flat piece (an axis-aligned slab, so its box is exact).
 */
function restingStones(root: THREE.Object3D, ground: (x: number, z: number) => number | undefined) {
  const pieces: THREE.Box3[] = [];
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (
      object instanceof THREE.Mesh &&
      !Array.isArray(object.material) &&
      /mineral charcoal stone/i.test(object.material.name)
    )
      meshes.push(object);
  });
  const p = new THREE.Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.attributes.position;
    const index = mesh.geometry.index;
    // Pieces share no vertices but may be split at seams, so coincident points (1mm) are joined.
    const parent = Int32Array.from({ length: position.count }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const join = (a: number, b: number) => {
      parent[find(b)] = find(a);
    };
    const world = new Float32Array(position.count * 3);
    const seen = new Map<string, number>();
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld)
        .toArray(world, i * 3);
      const key = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)},${Math.round(p.z * 1000)}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else join(first, i);
    }
    const corners = index ? index.count : position.count;
    for (let t = 0; t < corners; t += 3) {
      const at = (k: number) => (index ? index.getX(t + k) : t + k);
      join(at(0), at(1));
      join(at(0), at(2));
    }
    const boxes = new Map<number, THREE.Box3>();
    for (let i = 0; i < position.count; i++) {
      const piece = find(i);
      const box = boxes.get(piece) ?? new THREE.Box3();
      box.expandByPoint(p.fromArray(world, i * 3));
      boxes.set(piece, box);
    }
    for (const box of boxes.values()) pieces.push(box);
  }
  const size = new THREE.Vector3();
  const flat = (box: THREE.Box3) => (box.getSize(size), size.y < 0.35 * Math.min(size.x, size.z));
  const tops = pieces.filter(flat);
  const support = (x: number, z: number, below: number) => {
    let y = ground(x, z);
    for (const top of tops)
      if (
        top.max.y <= below &&
        top.max.y > (y ?? -Infinity) &&
        x >= top.min.x &&
        x <= top.max.x &&
        z >= top.min.z &&
        z <= top.max.z
      )
        y = top.max.y;
    return y;
  };
  const shades: Contact[] = [];
  for (const box of pieces) {
    box.getSize(size);
    const width = Math.max(size.x, size.z);
    if (width > 16 || width < 0.25) continue;
    const x = (box.min.x + box.max.x) / 2;
    const z = (box.min.z + box.max.z) / 2;
    const below = box.min.y + 0.05;
    const y = support(x, z, below);
    // Its base under its support or overhanging it by up to 0.5m, and its top above it.
    if (y === undefined || box.min.y > y + 0.5 || box.min.y < y - 0.5 || box.max.y < y) continue;
    const hx = size.x / 2;
    const hz = size.z / 2;
    // Slabs keep their rectangle up to the edge, with a softer, wider shade the higher they float;
    // rounded rocks get a smaller core and a wider fall-off.
    const gap = Math.max(0, box.min.y - y);
    if (flat(box)) shades.push([x, z, hx, hz, 0.3 + gap * 0.6, 0.6, below]);
    else shades.push([x, z, hx * 0.55, hz * 0.55, Math.max(hx, hz) * 0.7, 0.55, below]);
  }
  return { shades, support, boulders: pieces.filter((box) => !flat(box)) };
}

/**
 * The source's ornamental grass clumps (`Ornamental_grass_blade`) are rooted at the centers of the
 * boulders on the plinth's edge (also so in the source), so their blades stuck out of the rock tops
 * like hair. Each clump moves to its boulder's rim on the far side from the courtyard (the origin
 * lies between the sauna, the plunge and the terrace, so every stage looks at the near side), and
 * down onto the support there: the terrain or the plinth. Where a wall stands close behind, the
 * clump turns up to 90° aside to a side with room for its blades (`clear`: nothing but the boulder
 * itself in the way from a point along a direction within a distance), or stays. A clump is the grass within half a meter of
 * a boulder's outline that reaches inside it. Returns the number of clumps moved.
 */
export function tuckGrassBehindBoulders(
  root: THREE.Object3D,
  boulders: THREE.Box3[],
  support: (x: number, z: number, below: number) => number | undefined,
  clearAround: (
    boulders: THREE.Box3[],
  ) => (from: THREE.Vector3, direction: THREE.Vector3, far: number, boulder: THREE.Box3) => boolean,
) {
  const p = new THREE.Vector3();
  const size = new THREE.Vector3();
  const clumps: {
    position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    world: Float32Array;
    toLocal: THREE.Matrix4;
    boulder: THREE.Box3;
    vertices: number[];
    base: number;
  }[] = [];
  const grass: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name.startsWith('Ornamental_grass_blade')) grass.push(object);
  });
  for (const mesh of grass) {
    const position = mesh.geometry.attributes.position;
    const world = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++)
      p.fromBufferAttribute(position, i)
        .applyMatrix4(mesh.matrixWorld)
        .toArray(world, i * 3);
    const toLocal = mesh.matrixWorld.clone().invert();
    for (const boulder of boulders) {
      boulder.getSize(size);
      const reach = Math.max(size.x, size.z) / 2;
      const cx = (boulder.min.x + boulder.max.x) / 2;
      const cz = (boulder.min.z + boulder.max.z) / 2;
      if (reach < 0.12 || reach > 0.75 || Math.hypot(cx, cz) < 1) continue;
      const vertices: number[] = [];
      let inside = false;
      let base = Infinity;
      for (let i = 0; i < position.count; i++) {
        p.fromArray(world, i * 3);
        if (Math.hypot(p.x - cx, p.z - cz) > reach + 0.5) continue;
        vertices.push(i);
        inside ||= boulder.containsPoint(p);
        base = Math.min(base, p.y);
      }
      if (inside) clumps.push({ position, world, toLocal, boulder, vertices, base });
    }
  }
  if (!clumps.length) return 0;
  const clear = clearAround(clumps.map(({ boulder }) => boulder));
  const from = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let moved = 0;
  for (const { position, world, toLocal, boulder, vertices, base } of clumps) {
    boulder.getSize(size);
    const reach = Math.max(size.x, size.z) / 2;
    const cx = (boulder.min.x + boulder.max.x) / 2;
    const cz = (boulder.min.z + boulder.max.z) / 2;
    let spread = 0;
    for (const i of vertices) spread = Math.max(spread, Math.hypot(world[i * 3] - cx, world[i * 3 + 2] - cz));
    const shift = reach * 0.9;
    const outward = Math.atan2(cz, cx);
    const turn = [0, 1, -1, 2, -2].find((k) => {
      const angle = outward + (k * Math.PI) / 4;
      direction.set(Math.cos(angle), 0, Math.sin(angle));
      return [0.3, 0.6].every((h) => clear(from.set(cx, base + h, cz), direction, shift + spread + 0.05, boulder));
    });
    if (turn === undefined) continue;
    const dx = Math.cos(outward + (turn * Math.PI) / 4) * shift;
    const dz = Math.sin(outward + (turn * Math.PI) / 4) * shift;
    const ground = support(cx + dx, cz + dz, base + 0.05);
    // Down onto a lower terrace edge or into the gravel trench, never up into the air.
    const dy = ground === undefined ? 0 : Math.min(0, Math.max(-0.5, ground - base));
    for (const i of vertices) {
      p.fromArray(world, i * 3);
      p.set(p.x + dx, p.y + dy, p.z + dz).toArray(world, i * 3);
      position.setXYZ(i, ...p.applyMatrix4(toLocal).toArray());
    }
    position.needsUpdate = true;
    moved++;
  }
  for (const mesh of grass) {
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  return moved;
}

/** Browser-built garden accents. Geometry is deterministic and owned by the scene. */
export function addGardenDetails(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const terrain: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.every((material) => /moss|woodland earth|garden gravel/i.test(material.name))) terrain.push(object);
    }
  });
  // An incomplete or substitute model must not receive floating decorations.
  if (!terrain.length) return { tuckedGrass: 0, meadowBlades: 0, finishPreparation() {}, update() {} };
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const ground = (x: number, z: number) => {
    ray.ray.origin.set(x, 25, z);
    return ray.intersectObjects(terrain, false)[0]?.point.y;
  };
  const floor = (x: number, z: number) => ground(x, z) ?? 0;
  const resting = restingStones(root, ground);
  // Walls and other solid parts near the grass's boulders, as world-space triangles within 1.5m of
  // one (raycasting the whole merged model took seconds). Leaves, grass and the ground do not block
  // the grass; a stone blocks it unless it is the clump's own boulder, which the rays start inside.
  const tuckedGrass = tuckGrassBehindBoulders(root, resting.boulders, resting.support, (boulders) => {
    const near = boulders.map((box) => box.clone().expandByVector(new THREE.Vector3(1.5, 0.3, 1.5)));
    const all = near.reduce((union, box) => union.union(box), new THREE.Box3());
    const solid: number[] = [];
    const stones: number[] = [];
    const corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const triangle = new THREE.Box3();
    const bounds = new THREE.Box3();
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
      const name = `${object.material.name} ${object.name}`;
      if (/leaf|foliage|fern|grass|moss|woodland earth|gravel/i.test(name)) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      if (
        !near.some((box) =>
          box.intersectsBox(bounds.copy(object.geometry.boundingBox!).applyMatrix4(object.matrixWorld)),
        )
      )
        return;
      const into = /mineral charcoal stone/i.test(name) ? stones : solid;
      const position = object.geometry.attributes.position;
      const index = object.geometry.index;
      const count = index ? index.count : position.count;
      for (let t = 0; t < count; t += 3) {
        for (let k = 0; k < 3; k++)
          corner[k].fromBufferAttribute(position, index ? index.getX(t + k) : t + k).applyMatrix4(object.matrixWorld);
        triangle.setFromPoints(corner);
        if (all.intersectsBox(triangle) && near.some((box) => box.intersectsBox(triangle)))
          for (const c of corner) into.push(c.x, c.y, c.z);
      }
    });
    const soup = (points: number[]) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    };
    const solidSoup = soup(solid);
    const stoneSoup = soup(stones);
    const sideways = new THREE.Raycaster();
    const own = new THREE.Box3();
    return (from, direction, far, boulder) => {
      sideways.set(from, direction);
      sideways.far = far;
      own.copy(boulder).expandByScalar(0.02);
      return (
        sideways.intersectObject(solidSoup, false).length === 0 &&
        sideways.intersectObject(stoneSoup, false).every((hit) => own.containsPoint(hit.point))
      );
    };
  });
  const group = new THREE.Group();
  group.name = 'Living garden';
  group.applyMatrix4(root.matrixWorld.clone().invert());
  root.add(group);
  const material = (name: string, color: number) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
    value.name = name;
    return value;
  };
  const stone = material('Garden mineral charcoal stone', 0x777c70);
  const shrub = material('Garden evergreen foliage', 0x58713c);
  // Per-plant and per-stone tints, so repeated shapes do not read as copies.
  stone.vertexColors = shrub.vertexColors = true;
  const grass = material('Garden meadow foliage', 0x819455);
  grass.side = THREE.DoubleSide;
  grass.vertexColors = true;
  const flower = material('Garden seasonal flowers', 0xd7bd82);
  flower.vertexColors = true;
  flower.side = THREE.DoubleSide;
  const random = seeded(0x5a17);
  const range = (min: number, max: number) => min + (max - min) * random();
  const white = new THREE.Color(1, 1, 1);
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    tint = white,
  ) => {
    geometry.scale(sx, sy, sz);
    geometry.translate(x, y, z);
    const list = batches.get(mat) ?? [];
    if (geometry.index) {
      const expanded = geometry.toNonIndexed();
      geometry.dispose();
      geometry = expanded;
    }
    // Untextured materials: every batch shares position, normal and color only.
    geometry.deleteAttribute('uv');
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const sourceColors = geometry.getAttribute('color');
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = tint.r * (sourceColors?.getX(i / 3) ?? 1);
      colors[i + 1] = tint.g * (sourceColors?.getY(i / 3) ?? 1);
      colors[i + 2] = tint.b * (sourceColors?.getZ(i / 3) ?? 1);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    list.push(geometry);
    batches.set(mat, list);
  };
  // Clear of the beams of the source's footlights (V10 path grazing light 1/4/7, lighting.ts),
  // which shine low across the stepping stones in +x from x≈-1: a group at (-0.5, 5.7) stood
  // around light 7 and took the stones' pools of light on its leaves. (The lanterns below, too.)
  const patches = [
    [-4.8, 4.8],
    [-2.9, 7.2],
    [-3.4, 3.6],
    [3.8, 6.3],
    [6.4, 4.8],
    [7.6, 9.5],
    [-5.8, 11],
    [1.1, 12.5],
  ];
  // Soft darkening where each accent meets the ground: [x, z, half width, half depth, margin, depth]
  // (a rounded rectangle, a disc when the half sizes are 0), darkest inside and 0 at the margin.
  const contacts: Contact[] = [...resting.shades];
  // A stone with its own outline, turn and shade.
  const addRock = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    contacts.push([x, z, 0, 0, Math.max(sx, sz) * 1.5, 0.6]);
    const geometry = rockGeometry(random() * 100);
    geometry.rotateY(random() * Math.PI * 2);
    const shade = range(0.8, 1.12);
    add(
      geometry,
      stone,
      x,
      y,
      z,
      sx,
      sy,
      sz,
      new THREE.Color(shade * range(0.96, 1.06), shade, shade * range(0.92, 1.04)),
    );
  };
  for (const [x, z] of patches) {
    for (let n = 0; n < 7; n++) {
      const angle = n * 2.4 + range(-0.35, 0.35);
      const px = x + Math.cos(angle) * (0.25 + n * 0.15) + range(-0.1, 0.1);
      const pz = z + Math.sin(angle) * (0.25 + n * 0.12) + range(-0.1, 0.1);
      const y = floor(px, pz);
      // Each shrub has its own size, footprint, height, density, turn and green.
      const size = range(0.24, 0.48);
      const wide = range(1.15, 1.65);
      const deep = range(0.8, 1.2);
      const tall = range(1.05, 1.85);
      const leaves = 38 + Math.floor(random() * 32);
      const turn = random() * Math.PI * 2;
      const light = range(0.78, 1.16);
      const plant = new THREE.Color(light * range(0.9, 1.12), light, light * range(0.82, 1.05));
      contacts.push([px, pz, 0, 0, size * wide * 1.25, 0.5]);
      for (let leaf = 0; leaf < leaves; leaf++) {
        const a = leaf * 2.399 + turn + range(-0.3, 0.3);
        const rise = (leaf + range(0.2, 0.8)) / leaves;
        const reach = Math.sqrt(1 - rise * rise) * size * range(0.78, 1.15);
        const scale = range(0.7, 1.3);
        const geometry = new THREE.IcosahedronGeometry(1, 0);
        geometry.scale(0.12 * scale, 0.017 * scale, 0.055 * scale);
        // A cupped leaf instead of a flat, chunky lozenge; retain the same triangles.
        const vertices = geometry.attributes.position;
        for (let v = 0; v < vertices.count; v++)
          vertices.setY(v, vertices.getY(v) + 0.018 * scale * (vertices.getX(v) / (0.12 * scale)) ** 2);
        geometry.computeVertexNormals();
        geometry.rotateX(range(-0.3, 0.3));
        geometry.rotateZ(Math.sin(a) * 0.4 + range(-0.25, 0.25));
        geometry.rotateY(a);
        add(
          geometry,
          shrub,
          px + Math.cos(a) * reach * wide,
          y + 0.1 + rise * size * tall,
          pz + Math.sin(a) * reach * deep,
          1,
          1,
          1,
          plant.clone().multiplyScalar(range(0.93, 1.07)),
        );
      }
      if (random() < 0.5)
        addRock(
          px + range(0.2, 0.4),
          y + 0.1,
          pz + range(0.15, 0.35),
          range(0.2, 0.36),
          range(0.16, 0.26),
          range(0.18, 0.3),
        );
      // Blooms scattered over the upper crown.
      const blooms = 2 + Math.floor(random() * 5);
      for (let f = 0; f < blooms; f++) {
        const a = random() * Math.PI * 2;
        const rise = range(0.55, 0.95);
        const reach = Math.sqrt(1 - rise * rise) * size * 1.05;
        const scale = range(0.75, 1.3);
        const bloom = gardenBloomGeometry();
        bloom.rotateY(a);
        bloom.rotateZ(Math.sin(a * 3) * 0.3);
        const flowerX = px + Math.cos(a) * reach * wide;
        const flowerY = y + 0.12 + rise * size * tall;
        const flowerZ = pz + Math.sin(a) * reach * deep;
        const start = new THREE.Vector3(px, y + 0.05, pz);
        const end = new THREE.Vector3(flowerX, flowerY, flowerZ);
        const stem = new THREE.CylinderGeometry(0.0025, 0.005, start.distanceTo(end), 3, 1);
        stem.applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize()),
        );
        const midpoint = start.add(end).multiplyScalar(0.5);
        add(stem, shrub, midpoint.x, midpoint.y, midpoint.z, 1, 1, 1, plant.clone().multiplyScalar(0.65));
        add(
          bloom,
          flower,
          flowerX,
          flowerY,
          flowerZ,
          0.07 * scale,
          0.07 * scale,
          0.07 * scale,
          new THREE.Color().setScalar(range(0.86, 1.1)),
        );
      }
    }
  }
  // Stone banks follow the water's changing width; keep the existing deterministic stones.
  for (let i = 0; i < 38; i++) {
    const { x, z, width } = streamSection(i * 0.23);
    for (const side of [-1, 1]) {
      // Uneven edging: varied size, turn and spacing, with an occasional pebble behind.
      const cluster = 0.5 + 0.5 * Math.sin(i * 1.7 + side * 2.1);
      const bx = x + side * (width + 0.09 + 0.13 * cluster + range(-0.03, 0.05));
      const bz = z + 0.08 * Math.sin(i * 2.3 + side) + range(-0.07, 0.07);
      const size = 0.65 + cluster * 0.8;
      addRock(
        bx,
        floor(bx, bz) + 0.035 + cluster * 0.025,
        bz,
        range(0.15, 0.27) * size,
        range(0.11, 0.19) * (0.65 + cluster * 0.5),
        range(0.14, 0.25) * size,
      );
      if (random() < 0.22) {
        const px = bx + side * range(0.18, 0.26);
        const pz = bz + range(-0.1, 0.1);
        addRock(px, floor(px, pz) + 0.05, pz, range(0.07, 0.12), range(0.05, 0.09), range(0.07, 0.11));
      }
    }
  }
  const { mesh: stream, clock } = createGardenStream(floor);
  group.add(stream);
  // Low hills around the woodland, with three overlapping silhouettes and atmospheric color.
  const hills: THREE.Mesh[] = [];
  const hazeColor = { value: new THREE.Color() };
  for (let layer = 0; layer < 3; layer++) {
    const positions: number[] = [];
    const colors: number[] = [];
    const radius = 72 + layer * 38;
    const segments = 320;
    const point = (j: number, row: number) => {
      const a = (j / segments) * Math.PI * 2;
      const height =
        7 +
        layer * 4 +
        3 * Math.sin(a * 3 + layer) +
        1.8 * Math.sin(a * 7 + 0.7 + layer) +
        0.65 * Math.sin(a * 19 + layer * 2) +
        0.3 * Math.sin(a * 43);
      const y = row === 0 ? -7 : row === 1 ? height * 0.38 : height;
      return [Math.cos(a) * radius, y, Math.sin(a) * radius];
    };
    const vertex = (j: number, row: number) => {
      positions.push(...point(j, row));
      const a = (j / segments) * Math.PI * 2;
      const shade = 0.76 + 0.08 * Math.sin(a * 11 + layer) + 0.04 * Math.sin(a * 29);
      const tint = new THREE.Color().setRGB(shade, shade, shade);
      // Neutral ridge variation; atmospheric color is blended after the surface tint.
      colors.push(tint.r, tint.g, tint.b);
    };
    for (let n = 0; n < segments; n++)
      for (let row = 0; row < 2; row++) {
        vertex(n, row);
        vertex(n, row + 1);
        vertex(n + 1, row + 1);
        vertex(n, row);
        vertex(n + 1, row + 1);
        vertex(n + 1, row);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    mat.name = `Garden distant ridge ${layer}`;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.gardenHazeColor = hazeColor;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float gardenRidgeHeight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ngardenRidgeHeight = position.y;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float gardenRidgeHeight; uniform vec3 gardenHazeColor;',
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float valleyMist = 1.0 - smoothstep(-3.0, ${(12 + layer * 4).toFixed(1)}, gardenRidgeHeight);
          float haze = ${(0.24 + layer * 0.19).toFixed(2)} + valleyMist * 0.25;
          diffuseColor.rgb = mix(diffuseColor.rgb, gardenHazeColor, haze);`,
        );
    };
    mat.customProgramCacheKey = () => `garden-ridge-haze-${layer}`;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = mat.name;
    hills.push(mesh);
    group.add(mesh);
  }
  // Distant forest between the woodland and the ridges, in the same air (farForest.ts).
  const farForest = createFarForest(hazeColor);
  group.add(farForest.mesh);
  const movingGrass: THREE.Mesh[] = [];
  for (const [index, [x, z]] of patches.entries()) {
    const positions: number[] = [];
    const colors: number[] = [];
    const next = seeded(0x711 + index * 139);
    const tuftHeight = 0.7 + next() * 0.55;
    for (let blade = 0; blade < 32; blade++) {
      const a = blade * 2.4 + next() * 0.5;
      const r = 0.06 + Math.sqrt(next()) * 0.33;
      const px = Math.cos(a) * r,
        pz = Math.sin(a) * r;
      const height = (0.3 + next() * 0.5) * tuftHeight;
      const bend = 0.2 + next() * 0.38;
      const width = 0.014 + next() * 0.018;
      const tint = 0.78 + next() * 0.36;
      const vertex = (t: number, side: number) => {
        const reach = bend * t * t;
        const half = width * (1 - t) * (0.8 + 0.6 * t);
        positions.push(
          px + Math.cos(a) * reach - Math.sin(a) * half * side,
          height * (t - 0.32 * t ** 3),
          pz + Math.sin(a) * reach + Math.cos(a) * half * side,
        );
        const light = tint * (0.66 + 0.34 * t);
        colors.push(light, light, light * 0.92);
      };
      // Four curved sections, tapered to a point; no extra draw call or per-frame geometry work.
      for (let segment = 0; segment < 4; segment++) {
        const lo = segment / 4;
        const hi = (segment + 1) / 4;
        vertex(lo, -1);
        vertex(lo, 1);
        vertex(hi, -1);
        if (segment < 3) {
          vertex(lo, 1);
          vertex(hi, 1);
          vertex(hi, -1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, grass);
    mesh.position.set(x + 0.9, floor(x + 0.9, z - 0.6), z - 0.6);
    mesh.name = `Garden grasses ${index}`;
    movingGrass.push(mesh);
    group.add(mesh);
  }
  const lamps: THREE.Mesh[] = [];
  const lampMaterial = material('Garden amber lantern', 0xf1c284);
  lampMaterial.emissive.setHex(0xffb75c);
  for (const [x, z] of [
    // Behind footlight 7 (-1.3, 5.23): at (-0.9, 4.7) it shaded the near stepping stones.
    [-1.9, 4.3],
    [3.2, 7.9],
    [0.1, 10.7],
  ]) {
    const y = floor(x, z);
    contacts.push([x, z, 0, 0, 0.38, 0.6]);
    add(new THREE.CylinderGeometry(0.13, 0.17, 0.48, 8), stone, x, y + 0.24, z);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.13, 8), lampMaterial);
    lamp.position.set(x, y + 0.48, z);
    lamps.push(lamp);
    group.add(lamp);
    add(new THREE.ConeGeometry(0.24, 0.13, 8), stone, x, y + 0.6, z);
  }
  const flowers: THREE.Mesh[] = [];
  for (const [mat, geometries] of batches) {
    const merged = mergeGeometries(geometries);
    for (const geometry of geometries) geometry.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = mat.name;
    if (mat === flower) flowers.push(mesh);
    group.add(mesh);
  }
  // Short blades over the open meadow (meadowGrass.ts), kept off everything else standing on the
  // ground, the accents above included. Before the contact shade, which lies on the ground itself.
  root.updateMatrixWorld(true);
  const solids: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || terrain.includes(object)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.every((value) => !/leaf|foliage|fern|grass|flower/i.test(value.name))) solids.push(object);
  });
  const meadowMaterial = material('Garden meadow blade foliage', 0x819455);
  meadowMaterial.side = THREE.DoubleSide;
  meadowMaterial.vertexColors = true;
  // Up-leaning normals as written on either face (crownNormals.ts), not turned to the viewer.
  meadowMaterial.defines = { SUI_CROWN_NORMAL: '' };
  const meadowCells = meadowGrid(terrain, solids);
  const meadow = meadowBlades(meadowCells, seeded(0x3ead0));
  const meadowMesh = new THREE.Mesh(meadow.geometry, meadowMaterial);
  meadowMesh.name = 'Garden meadow blades';
  group.add(meadowMesh);
  // Contact shade: a disc or rounded rectangle per accent laid on the terrain, black with the depth
  // falling to zero at the rim (vertex alpha), so rocks, shrubs and lanterns do not seem to float.
  // Without baked occlusion under the browser-built accents, their base met the lit ground with no
  // darkening; the source's stepping stones and boulders read as slabs floating above the meadow.
  const shadePositions: number[] = [];
  const shadeColors: number[] = [];
  const ARC = 4;
  const lift = 0.012;
  for (const [x, z, hx, hz, margin, depth, below] of contacts) {
    const onGround = (px: number, pz: number) => [
      px,
      (below === undefined ? floor(px, pz) : (resting.support(px, pz, below) ?? floor(px, pz))) + lift,
      pz,
    ];
    // Rings around the core, point for point: each corner's arc around its core corner. Around a
    // stone's footprint the shade gathers at the edge, as occlusion does where it meets the ground.
    const rings: [number, number][] =
      hx || hz
        ? [
            [0, depth],
            [margin * 0.3, depth * 0.4],
            [margin, 0],
          ]
        : [
            [0, depth],
            [margin, 0],
          ];
    const points = rings.map(([offset]) => {
      const ring: number[][] = [];
      for (let corner = 0; corner < 4; corner++) {
        const cx = x + (corner === 0 || corner === 3 ? hx : -hx);
        const cz = z + (corner < 2 ? hz : -hz);
        for (let k = 0; k <= ARC; k++) {
          const a = ((corner + k / ARC) * Math.PI) / 2;
          ring.push(onGround(cx + Math.cos(a) * offset, cz + Math.sin(a) * offset));
        }
      }
      return ring;
    });
    const center = onGround(x, z);
    const same = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[2] - b[2]) < 1e-6;
    const triangle = (corners: number[][], alphas: number[]) => {
      for (const point of corners) shadePositions.push(...point);
      for (const alpha of alphas) shadeColors.push(0, 0, 0, alpha);
    };
    const count = points[0].length;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const core = points[0];
      if (!same(core[i], core[j])) triangle([center, core[j], core[i]], [depth, depth, depth]);
      for (let r = 0; r + 1 < rings.length; r++) {
        const [inner, outer] = [points[r], points[r + 1]];
        const [ai, ao] = [rings[r][1], rings[r + 1][1]];
        if (!same(outer[i], outer[j])) triangle([inner[i], outer[j], outer[i]], [ai, ao, ao]);
        if (!same(inner[i], inner[j])) triangle([inner[i], inner[j], outer[j]], [ai, ai, ao]);
      }
    }
  }
  const shadeGeometry = new THREE.BufferGeometry();
  shadeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(shadePositions, 3));
  shadeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(shadeColors, 4));
  const shadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  shadeMaterial.name = 'Garden contact shade';
  const shade = new THREE.Mesh(shadeGeometry, shadeMaterial);
  shade.name = shadeMaterial.name;
  group.add(shade);
  // Lamp pools: the lanterns add no browser light (every light costs each pixel's shader), so a
  // terrain-following additive disc per lantern carries their warm spill on the ground at dusk.
  // The weights fall off as 1/(1 + (r/r0)²) shifted to 0 at the rim (sampled on rings).
  const poolPositions: number[] = [];
  const poolColors: number[] = [];
  const RIM = 16;
  const POOL_RINGS = [0, 0.18, 0.4, 0.7, 1.05, 1.5];
  const falloff = (r: number) => 1 / (1 + (r / 0.32) ** 2);
  const poolWeight = (r: number) => (falloff(r) - falloff(1.5)) / (1 - falloff(1.5));
  for (const lamp of lamps) {
    const { x, z } = lamp.position;
    const ring = (r: number) =>
      Array.from({ length: RIM }, (_, k) => {
        const a = (k / RIM) * Math.PI * 2;
        const rx = x + Math.cos(a) * r,
          rz = z + Math.sin(a) * r;
        return [rx, floor(rx, rz) + 0.016, rz];
      });
    const rings = POOL_RINGS.map(ring);
    for (let n = 0; n + 1 < POOL_RINGS.length; n++) {
      const [inner, outer] = [rings[n], rings[n + 1]];
      const [wi, wo] = [poolWeight(POOL_RINGS[n]), poolWeight(POOL_RINGS[n + 1])];
      for (let k = 0; k < RIM; k++) {
        const next = (k + 1) % RIM;
        poolPositions.push(...inner[k], ...outer[next], ...outer[k], ...inner[k], ...inner[next], ...outer[next]);
        for (const w of [wi, wo, wo, wi, wi, wo]) poolColors.push(w, w, w);
      }
    }
  }
  const poolGeometry = new THREE.BufferGeometry();
  poolGeometry.setAttribute('position', new THREE.Float32BufferAttribute(poolPositions, 3));
  poolGeometry.setAttribute('color', new THREE.Float32BufferAttribute(poolColors, 3));
  const poolMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
  });
  poolMaterial.name = 'Garden lantern pool';
  const pool = new THREE.Mesh(poolGeometry, poolMaterial);
  pool.name = poolMaterial.name;
  group.add(pool);
  const butterflies: THREE.Group[] = [];
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xf0d9a2, roughness: 0.9, side: THREE.DoubleSide });
  const wingGeometry = new THREE.CircleGeometry(0.09, 5);
  wingGeometry.rotateX(-Math.PI / 2);
  wingGeometry.translate(0.075, 0, 0);
  for (let n = 0; n < 3; n++) {
    const butterfly = new THREE.Group();
    butterfly.name = `Garden butterfly ${n}`;
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(wingGeometry, wingMaterial);
      wing.scale.x = side;
      butterfly.add(wing);
    }
    butterflies.push(butterfly);
    group.add(butterfly);
  }
  const butterflyFloors = butterflies.map((_, i) => floor(patches[i + 2][0], patches[i + 2][1]));
  const hillDay = [new THREE.Color(0x718575), new THREE.Color(0x8b9c9b), new THREE.Color(0xa7b4bc)];
  // Unlit, so the dusk colors are set here: halfway to night they stood out above the darkened
  // meadow under the opened evening exposure.
  const hillEvening = [new THREE.Color(0x2b3340), new THREE.Color(0x384050), new THREE.Color(0x474e60)];
  const hillNight = new THREE.Color(0x101c29);
  // Winter days: snow-covered ridges, nearer ones greyer with their bare woods, instead of summer green.
  const hillWinter = [new THREE.Color(0xa3aaab), new THREE.Color(0xb1b9bf), new THREE.Color(0xbdc6ce)];
  const airDay = new THREE.Color(0xaebdcc);
  const airEvening = new THREE.Color(0x5c5f72);
  const airNight = new THREE.Color(0x25344f);
  // The overcast sky at the horizon is its base radiance × 0.75 (sky.ts OVERCAST_GLSL, mean shade 1).
  const OVERCAST_HAZE = 0.75;
  // Before the vertex shade (about 0.8) and the haze; nearer ridges stand darker against the deck.
  const OVERCAST_RIDGE = [0.4, 0.5, 0.6];
  const overcastAir = new THREE.Color();
  // The light on the far forest multiplies its tints: by day 0.45, as dark as the lit woodland's
  // crowns in front of it (at full tint the unlit band stood as bright as the ridges, a pale
  // backdrop), then the ridges' own darkening toward dusk and night, and under the cloud deck the
  // nearest ridge's share of it.
  const FOREST_DAY = 0.45;
  const forestLight = new THREE.Color();
  const forestEvening = new THREE.Color().setRGB(0.15, 0.17, 0.22).multiplyScalar(FOREST_DAY);
  const forestNight = new THREE.Color().setRGB(0.035, 0.06, 0.1).multiplyScalar(FOREST_DAY);
  const FOREST_OVERCAST =
    (FOREST_DAY * OVERCAST_RIDGE[0] * 0.8) / (0.2126 * hillDay[0].r + 0.7152 * hillDay[0].g + 0.0722 * hillDay[0].b);
  const POOL_RADIANCE = 0.12;
  return {
    group,
    /** The source's grass clumps moved out of their boulders (tuckGrassBehindBoulders). */
    tuckedGrass,
    /** Short blades on the meadow (meadowGrass.ts). */
    meadowBlades: meadow.blades,
    /** Call after the generic model preparation, which otherwise enables every shadow. */
    finishPreparation() {
      for (const mesh of [...hills, farForest.mesh, stream, shade, pool, ...movingGrass, ...lamps, meadowMesh])
        mesh.castShadow = false;
      for (const mesh of [...hills, farForest.mesh, shade, pool]) mesh.receiveShadow = false;
      for (const butterfly of butterflies)
        butterfly.traverse((object) => {
          if (object instanceof THREE.Mesh) object.castShadow = false;
        });
    },
    /**
     * `clouds` is the overcast's share and `overcast` its radiance at the base (lighting.ts): under
     * the cloud deck the ridges fade into its grey instead of keeping the clear air's blue.
     */
    update(
      seconds: number,
      season: Season,
      timeOfDay: number,
      weather: string,
      reducedMotion: boolean,
      clouds = 0,
      overcast?: THREE.Color,
    ) {
      const time = reducedMotion ? 0 : seconds;
      clock.value = time;
      const evening = Math.min(1, timeOfDay);
      lampMaterial.emissiveIntensity = evening * 3;
      // Scene-linear radiance at the lamp's foot (before exposure); hidden by day.
      poolMaterial.color.copy(lampMaterial.emissive).multiplyScalar(evening * POOL_RADIANCE);
      pool.visible = evening > 0;
      grass.color.setHex(season === 'autumn' ? 0xad955d : season === 'winter' ? 0x827c63 : 0x819455);
      meadowMaterial.color.copy(grass.color);
      flower.color.setHex(season === 'spring' ? 0xe8c6cd : season === 'autumn' ? 0xcba657 : 0xc8c1df);
      for (const mesh of flowers) mesh.visible = season !== 'winter';
      hazeColor.value.copy(airDay).lerp(airEvening, Math.min(1, timeOfDay));
      hazeColor.value.lerp(airNight, Math.max(0, Math.min(1, timeOfDay - 1)));
      // The clear air's colors are far brighter than the overcast at night (a blue band under the
      // grey deck), so the haze takes the deck's radiance near the horizon and the ridges a darker share.
      const cover = overcast ? clouds : 0;
      if (overcast) hazeColor.value.lerp(overcastAir.copy(overcast).multiplyScalar(OVERCAST_HAZE), cover);
      for (const [i, hill] of hills.entries()) {
        const color = (hill.material as THREE.MeshBasicMaterial).color
          .copy(season === 'winter' ? hillWinter[i] : hillDay[i])
          .lerp(hillEvening[i], Math.min(1, timeOfDay))
          .lerp(hillNight, Math.max(0, Math.min(1, timeOfDay - 1)));
        if (overcast) color.lerp(overcastAir.copy(overcast).multiplyScalar(OVERCAST_RIDGE[i]), cover);
      }
      forestLight
        .setScalar(FOREST_DAY)
        .lerp(forestEvening, Math.min(1, timeOfDay))
        .lerp(forestNight, Math.max(0, Math.min(1, timeOfDay - 1)));
      if (overcast) forestLight.lerp(overcastAir.copy(overcast).multiplyScalar(FOREST_OVERCAST), cover);
      farForest.update(season, forestLight);
      for (const [i, mesh] of movingGrass.entries())
        mesh.rotation.z = Math.sin(time * 0.8 + i * 1.7) * (reducedMotion ? 0 : 0.025);
      for (const [i, butterfly] of butterflies.entries()) {
        butterfly.visible =
          !reducedMotion &&
          weather === 'clear' &&
          (season === 'spring' || season === 'summer') &&
          timeOfDay < 0.6 &&
          (time + i * 13) % 42 < 24;
        const x = patches[i + 2][0] + Math.sin(time * 0.27 + i * 2) * 0.8;
        const z = patches[i + 2][1] + Math.cos(time * 0.21 + i) * 0.6;
        butterfly.position.set(x, butterflyFloors[i] + 0.95 + Math.sin(time * 0.7 + i) * 0.22, z);
        butterfly.rotation.y = time * 0.27 + i;
        butterfly.children.forEach((wing, j) => {
          wing.rotation.z = Math.sin(time * 13 + i) * 0.65 * (j ? 1 : -1);
        });
      }
    },
  };
}
