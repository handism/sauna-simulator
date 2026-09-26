import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WATER_BOX } from './interiorLights';
import {
  addSideImages,
  applyRefraction,
  apparentDepth,
  keepsImage,
  mirrorAcross,
  SIDE_IMAGE_LAYER,
  SIDE_IMAGES,
  SIDE_WALL_LAYER,
  type Sides,
  sidePath,
  SLICE_SPACING,
  sliceUnderwater,
  trueWeight,
  waterAirReflectance,
  WATER_IOR,
  WATER_VOLUME,
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

  // The view from `camera` through `entry` on the flat surface, followed by reflecting its
  // direction at the sides until it reaches the bottom or passes a side.
  function trace(camera: THREE.Vector3, entry: THREE.Vector3) {
    const view = entry.clone().sub(camera).normalize();
    const sin = Math.hypot(view.x, view.z) / WATER_IOR;
    const d = new THREE.Vector3(view.x, 0, view.z).setLength(sin);
    d.y = -Math.sqrt(1 - sin * sin);
    const p = entry.clone();
    const sides: Sides = [0, 0];
    const { min, max } = WATER_VOLUME;
    for (;;) {
      const tx = ((d.x > 0 ? max.x : min.x) - p.x) / d.x;
      const tz = ((d.z > 0 ? max.z : min.z) - p.z) / d.z;
      const tb = (min.y - p.y) / d.y;
      const t = Math.min(tx, tz, tb);
      p.addScaledVector(d, t);
      if (t === tb) return { point: p, sides, passes: false, first: [0, 0] as Sides, across: 0 };
      const axis = t === tx ? 'x' : 'z';
      // Snell: the view leaves when n·sin(incidence) ≤ 1.
      if (WATER_IOR * Math.sqrt(1 - d[axis] ** 2) <= 1)
        return {
          point: p,
          sides,
          passes: true,
          first: (axis === 'x' ? [Math.sign(d.x), 0] : [0, Math.sign(d.z)]) as Sides,
          across: Math.abs(d[axis]),
        };
      sides[axis === 'x' ? 0 : 1] = Math.sign(d[axis]);
      d[axis] = -d[axis];
    }
  }

  it('finds the sides a view reflects off, where the mirrored point is imaged', () => {
    const level = WATER_VOLUME.max.y;
    const cameras = [
      new THREE.Vector3(1.18, 1.12, -2.7),
      new THREE.Vector3(4.4, 3.3, 3.3),
      new THREE.Vector3(-0.6, 1.0, -0.4),
    ];
    const seen = new Set<string>();
    let passes = 0;
    for (const camera of cameras)
      for (let i = 1; i < 16; i++)
        for (let k = 1; k < 16; k++) {
          const entry = new THREE.Vector3(
            THREE.MathUtils.lerp(WATER_VOLUME.min.x, WATER_VOLUME.max.x, i / 16),
            level,
            THREE.MathUtils.lerp(WATER_VOLUME.min.z, WATER_VOLUME.max.z, k / 16),
          );
          const path = trace(camera, entry);
          if (path.passes && path.sides.every((side) => side === 0)) {
            // Leaving through the first side: still partly reflected off it.
            passes++;
            const image = entry.clone().sub(camera).multiplyScalar(1.2).add(camera);
            const found = sidePath(camera, image, level);
            expect(found.first).toEqual(path.first);
            expect(found.sides).toEqual(path.first);
            expect(found.reflectance).toBeCloseTo(waterAirReflectance(path.across), 9);
            expect(found.reflectance).toBeGreaterThan(0.06);
            expect(found.reflectance).toBeLessThan(1);
            continue;
          }
          if (path.passes) continue;
          seen.add(path.sides.join());
          // The bottom point mirrored across the sides the view reflects off is imaged on the
          // camera ray through the entry, and from that image the same sides are found.
          const mirrored = mirrorAcross(path.point, path.sides);
          const distance = Math.hypot(mirrored.x - camera.x, mirrored.z - camera.z);
          const image = mirrored.clone();
          image.y = level - apparentDepth(camera.y - level, level - mirrored.y, distance);
          const ray = image.clone().sub(camera);
          expect(
            ray
              .clone()
              .multiplyScalar((camera.y - level) / -ray.y)
              .add(camera)
              .distanceTo(entry),
          ).toBeLessThan(1e-4);
          const found = sidePath(camera, image, level);
          expect(found.sides).toEqual(path.sides);
          if (path.sides.some((side) => side !== 0)) expect(found.reflectance).toBe(1);
        }
    // Every side and every corner is reached, and some views pass a side.
    expect(seen.size).toBe(9);
    expect(passes).toBeGreaterThan(0);
    // No reflection from under the water, outside the surface or looking up.
    const pool = new THREE.Vector3(1, 0.4, -2);
    expect(sidePath(new THREE.Vector3(1, 0.5, -2), pool, level)).toEqual({
      sides: [0, 0],
      first: [0, 0],
      reflectance: 0,
    });
    expect(sidePath(new THREE.Vector3(-3, 1.2, -2), new THREE.Vector3(-2, 0.4, -2), level).sides).toEqual([0, 0]);
    // A tilted surface normal (the waves) bends the view before it is followed: it changes the
    // sides near the boundaries of the reflecting regions only.
    const tilted = (x: number) => () => new THREE.Vector3(x, 1, 0).normalize();
    let changed = 0;
    let total = 0;
    for (const camera of cameras)
      for (let i = 1; i < 16; i++)
        for (let k = 1; k < 16; k++) {
          const entry = new THREE.Vector3(
            THREE.MathUtils.lerp(WATER_VOLUME.min.x, WATER_VOLUME.max.x, i / 16),
            level,
            THREE.MathUtils.lerp(WATER_VOLUME.min.z, WATER_VOLUME.max.z, k / 16),
          );
          // Any point on the camera ray under the surface.
          const image = entry.clone().sub(camera).multiplyScalar(1.2).add(camera);
          const flat = sidePath(camera, image, level);
          expect(sidePath(camera, image, level, tilted(0))).toEqual(flat);
          if (sidePath(camera, image, level, tilted(0.05)).sides.join() !== flat.sides.join()) changed++;
          total++;
        }
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(total / 2);
  });

  it('reflects part of a view leaving through a side, fully past the critical angle', () => {
    // Water–air Fresnel: 2% square to the side, rising steeply to 1 at 48.6°.
    const at = (degrees: number) => waterAirReflectance(Math.cos(THREE.MathUtils.degToRad(degrees)));
    expect(at(0)).toBeCloseTo(((WATER_IOR - 1) / (WATER_IOR + 1)) ** 2, 9);
    expect(at(41.4)).toBeCloseTo(0.068, 3);
    expect(at(48)).toBeCloseTo(0.433, 3);
    expect(at(48.7)).toBe(1);
    let last = 0;
    for (let degrees = 0; degrees < 48.6; degrees += 0.1) {
      expect(at(degrees)).toBeGreaterThanOrEqual(last);
      last = at(degrees);
    }
    expect(at(48.6)).toBeGreaterThan(0.9);
  });

  it('weights the wall just behind the first side by its transmittance, and hides what is further', () => {
    const path = { sides: [1, 0] as Sides, first: [1, 0] as Sides, reflectance: 0.3 };
    const wall = new THREE.Vector3(WATER_VOLUME.max.x + 0.006, 0.5, -2);
    expect(trueWeight(new THREE.Vector3(1, 0.3, -2), path)).toBe(1);
    expect(trueWeight(wall, path)).toBeCloseTo(0.7, 9);
    expect(trueWeight(wall, { ...path, reflectance: 1 })).toBe(0);
    // The back of the wall, a wall behind another side and a view that meets no side.
    expect(trueWeight(new THREE.Vector3(WATER_VOLUME.max.x + SIDE_WALL_LAYER + 0.01, 0.5, -2), path)).toBe(0);
    expect(trueWeight(new THREE.Vector3(1, 0.5, WATER_VOLUME.min.z - 0.006), path)).toBe(0);
    expect(trueWeight(wall, { sides: [0, 0], first: [0, 0], reflectance: 0 })).toBe(1);
  });

  it('keeps each fragment on the one image its view reaches', () => {
    const inside = new THREE.Vector3(1, 0.2, -2);
    const behindX = new THREE.Vector3(2.53, 0.5, -2);
    const behindZ = new THREE.Vector3(1, 0.5, -4.11);
    // True surfaces: the pool always, a wall behind a side only while the view passes the sides.
    expect(keepsImage(inside, [0, 0], [1, -1])).toBe(true);
    expect(keepsImage(behindX, [0, 0], [0, 0])).toBe(true);
    expect(keepsImage(behindX, [0, 0], [1, 0])).toBe(false);
    // An image of one side: the pool when the view reflects off that side first or only.
    expect(keepsImage(inside, [1, 0], [1, 0])).toBe(true);
    expect(keepsImage(inside, [1, 0], [1, -1])).toBe(true);
    expect(keepsImage(inside, [1, 0], [0, -1])).toBe(false);
    expect(keepsImage(inside, [1, 0], [-1, 0])).toBe(false);
    // The wall right behind the mirroring side would stand in front of its image.
    expect(keepsImage(behindX, [1, 0], [1, 0])).toBe(false);
    // A wall behind another side is seen after the reflection only when the view passes it.
    expect(keepsImage(behindZ, [1, 0], [1, 0])).toBe(true);
    expect(keepsImage(behindZ, [1, 0], [1, -1])).toBe(false);
    expect(keepsImage(behindZ, [1, -1], [1, -1])).toBe(false);
  });

  it('adds the mirrored images sharing the underwater geometry, shown only where they can be seen', () => {
    const root = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
    const double = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
    // Shader changes of other modules (caustics.ts) tell their programs apart by this key.
    material.customProgramCacheKey = () => 'wall program';
    double.customProgramCacheKey = () => 'floor program';
    const floor = new THREE.PlaneGeometry(2.5, 3).rotateX(-Math.PI / 2).translate(1.18, 0.2, -2.5);
    // The inner wall 6 mm behind the −x side.
    const geometry = wall().translate(-0.001, 0, 0);
    const position = [...geometry.getAttribute('position').array, ...floor.getAttribute('position').array];
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    merged.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(
        position.map((_, i) => (i % 3 === 1 ? 1 : 0)),
        3,
      ),
    );
    merged.setIndex([...geometry.index!.array, ...Array.from(floor.index!.array, (i) => i + 4)]);
    merged.addGroup(0, 6, 0);
    merged.addGroup(6, 6, 1);
    root.add(new THREE.Mesh(merged, [material, double]));
    root.add(new THREE.Mesh(wall().translate(-3, 0, 0), new THREE.MeshStandardMaterial()));
    applyRefraction(root, LEVEL);
    const source = root.children[0] as THREE.Mesh;
    // Every triangle wholly under the surface: all but the wall's cut part above it.
    const index = Array.from(source.geometry.index!.array);
    const y = source.geometry.getAttribute('position');
    const wet = (t: number) => Math.max(y.getY(index[t]), y.getY(index[t + 1]), y.getY(index[t + 2])) <= LEVEL + 1e-6;
    const triangles = [...Array(index.length / 3).keys()].map((t) => t * 3);
    const under = triangles.filter(wet).length;
    expect(under).toBeLessThan(index.length / 3);
    // Of those, the wall's (the floor lies inside the water).
    const walled = triangles.filter((t) => wet(t) && t < merged.groups[1].start).length;
    expect(walled).toBeGreaterThan(0);
    const time = { value: 0 };
    const images = addSideImages(root, LEVEL, time);
    expect(images.meshes).toBe(SIDE_IMAGES.length);
    expect(images.triangles).toBe(SIDE_IMAGES.length * under);
    expect(root.children).toHaveLength(2 + SIDE_IMAGES.length + 1);
    const copies = root.children.slice(2, -1) as THREE.Mesh[];
    // The wall's underwater triangles move to a mesh drawn after the images and blended over them
    // by its alpha; the rest stays in place.
    const behind = root.children[root.children.length - 1] as THREE.Mesh;
    expect(behind.geometry.index!.count / 3).toBe(walled);
    expect(source.geometry.index!.count / 3).toBe(index.length / 3 - walled);
    expect(source.geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
    expect(behind.geometry.getAttribute('position')).toBe(source.geometry.getAttribute('position'));
    expect([source.renderOrder, behind.renderOrder]).toEqual([0, 2]);
    expect(behind.castShadow).toBe(source.castShadow);
    for (const [i, blended] of (behind.material as THREE.MeshStandardMaterial[]).entries()) {
      expect(blended).not.toBe((source.material as THREE.Material[])[i]);
      expect(blended.defines?.SUI_REFRACTION).toBe(material.defines?.SUI_REFRACTION);
      expect(blended.customProgramCacheKey()).toBe(
        `${(source.material as THREE.Material[])[i].customProgramCacheKey()}|behind-sides`,
      );
      expect(blended.blending).toBe(THREE.CustomBlending);
      expect([blended.blendSrc, blended.blendDst]).toEqual([THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor]);
      expect([blended.blendSrcAlpha, blended.blendDstAlpha]).toEqual([THREE.ZeroFactor, THREE.OneFactor]);
    }
    expect([material.blending, double.blending]).toEqual([THREE.NormalBlending, THREE.NormalBlending]);
    for (const [n, copy] of copies.entries()) {
      const sides = SIDE_IMAGES[n];
      expect(copy.geometry.getAttribute('position')).toBe(source.geometry.getAttribute('position'));
      expect(copy.layers.mask).toBe(1 << SIDE_IMAGE_LAYER);
      expect(copy.castShadow).toBe(false);
      expect(copy.renderOrder).toBe(1);
      const [single, both] = copy.material as THREE.MeshStandardMaterial[];
      const flipped = sides[0] * sides[1] === 0;
      expect(single.defines?.SUI_SIDE_IMAGE).toBe('');
      expect(single.defines?.SUI_REFRACTION).toBe(material.defines?.SUI_REFRACTION);
      expect(single.defines?.SUI_SIDE_FLIPPED !== undefined).toBe(flipped);
      expect(single.side).toBe(flipped ? THREE.BackSide : THREE.FrontSide);
      expect(single.blending).toBe(THREE.NormalBlending);
      expect(single.customProgramCacheKey()).toBe('wall program|side-image');
      expect(both.customProgramCacheKey()).toBe('floor program|side-image');
      expect(both.side).toBe(THREE.DoubleSide);
      // The culling bounds hold the mirrored pool.
      const center = mirrorAcross(new THREE.Vector3(1.18, 0.4, -2.5), sides);
      expect(copy.geometry.boundingBox!.containsPoint(center)).toBe(true);
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '' };
      single.onBeforeCompile(shader as never, undefined as never);
      expect(shader.uniforms.suiWaterTime).toBe(time);
      expect((shader.uniforms.suiSide as { value: THREE.Vector2 }).value.toArray()).toEqual(sides);
    }
    const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
    const look = (position: number[], target: number[]) => {
      camera.position.fromArray(position);
      camera.lookAt(new THREE.Vector3().fromArray(target));
      camera.updateMatrixWorld();
      return images.update(camera);
    };
    // Above the pool every image can be seen; beyond the +x side none of that side.
    expect(look([1.18, 1.2, -2.5], [1.18, 0, -2.6])).toBe(8);
    expect(look([4.4, 3.3, 3.3], [1.18, 0.5, -2.5])).toBe(3);
    expect(copies.filter((c) => c.visible).every((c) => !c.name.includes('side image 1'))).toBe(true);
    // Under the surface or looking away, none.
    expect(look([1.18, 0.5, -2.5], [1.18, 0.3, -2.6])).toBe(0);
    expect(look([1.18, 1.2, -2.5], [1.18, 5, -2.4])).toBe(0);
    expect(THREE.ShaderChunk.clipping_planes_fragment).toContain('suiSidePath');
  });
});
