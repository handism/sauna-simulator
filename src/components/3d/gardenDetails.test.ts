import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addGardenDetails, rockGeometry } from './gardenDetails';
import { disposeTree, prepareModel } from './modelMaterials';

function garden() {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  material.name = 'garden moss';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), material);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 2;
  root.add(ground);
  const details = addGardenDetails(root);
  prepareModel(root);
  details.finishPreparation();
  return { root, details };
}

describe('garden accents', () => {
  it('anchors decorations to the ground, keeps moving objects out of static shadows, and has valid geometry', () => {
    const { root, details } = garden();
    details.update(3, 'summer', 0, 'clear', false);
    const grass = root.getObjectByName('Garden grasses 0') as THREE.Mesh;
    expect(grass.position.y).toBeCloseTo(2);
    expect(grass.castShadow).toBe(false);
    // Contact shade lies just above the ground and fades to nothing at each rim.
    const shade = root.getObjectByName('Garden contact shade') as THREE.Mesh;
    expect(shade.castShadow).toBe(false);
    expect(shade.receiveShadow).toBe(false);
    const heights = Array.from(shade.geometry.attributes.position.array).filter((_, i) => i % 3 === 1);
    expect(heights.every((y) => Math.abs(y - 2.012) < 1e-4)).toBe(true);
    const colors = shade.geometry.attributes.color;
    expect(colors.itemSize).toBe(4);
    for (let i = 0; i < colors.count; i++)
      if (i % 3 === 0) expect(colors.getW(i)).toBeGreaterThan(0);
      else expect(colors.getW(i)).toBe(0);
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      expect(object.geometry).toBeInstanceOf(THREE.BufferGeometry);
      expect(Array.from(object.geometry.attributes.position.array).every(Number.isFinite)).toBe(true);
    });
    disposeTree(root);
  });

  it('removes flowers in winter and freezes grass under reduced motion without allocating new geometry', () => {
    const { root, details } = garden();
    const flowers = root.getObjectByName('Garden seasonal flowers') as THREE.Mesh;
    const grass = root.getObjectByName('Garden grasses 0') as THREE.Mesh;
    const geometry = grass.geometry;
    details.update(2, 'summer', 0, 'clear', false);
    expect(grass.rotation.z).not.toBe(0);
    expect(flowers.visible).toBe(true);
    details.update(9, 'winter', 2, 'snow', true);
    expect(flowers.visible).toBe(false);
    expect(grass.rotation.z).toBe(0);
    details.update(18, 'spring', 0, 'clear', true);
    expect(flowers.visible).toBe(true);
    expect(grass.rotation.z).toBe(0);
    expect(grass.geometry).toBe(geometry);
    disposeTree(root);
  });

  it('shows butterflies only on warm clear days and hides them for reduced motion', () => {
    const { root, details } = garden();
    const butterfly = root.getObjectByName('Garden butterfly 0')!;
    details.update(2, 'summer', 0, 'clear', false);
    expect(butterfly.visible).toBe(true);
    for (const [season, time, weather, reduced] of [
      ['winter', 0, 'clear', false],
      ['summer', 0, 'rain', false],
      ['summer', 2, 'clear', false],
      ['spring', 0, 'clear', true],
    ] as const) {
      details.update(2, season, time, weather, reduced);
      expect(butterfly.visible).toBe(false);
    }
    details.update(30, 'summer', 0, 'clear', false);
    expect(butterfly.visible).toBe(false);
    disposeTree(root);
  });

  it('fades the distant ridges into the overcast instead of standing brighter than the cloud deck', () => {
    const { root, details } = garden();
    const ridges = [0, 1, 2].map(
      (i) => (root.getObjectByName(`Garden distant ridge ${i}`) as THREE.Mesh).material as THREE.MeshBasicMaterial,
    );
    const overcast = new THREE.Color(0.011, 0.0116, 0.0127);
    details.update(2, 'summer', 2, 'clear', false, 0, overcast);
    const clear = ridges.map((ridge) => ridge.color.clone());
    details.update(2, 'summer', 2, 'clear', false);
    ridges.forEach((ridge, i) => expect(ridge.color.equals(clear[i])).toBe(true));
    details.update(2, 'summer', 2, 'rain', false, 1, overcast);
    for (const ridge of ridges) {
      expect(ridge.color.b).toBeLessThan(overcast.b);
      expect(ridge.color.b).toBeLessThan(clear[0].b);
    }
    expect(ridges[0].color.r).toBeLessThan(ridges[2].color.r);
    disposeTree(root);
  });

  it('shades the support around the source stepping stones, darkest at their edge, but not raised stones', () => {
    const root = new THREE.Group();
    const moss = new THREE.MeshStandardMaterial();
    moss.name = 'garden moss';
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), moss);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 2;
    const stone = new THREE.MeshStandardMaterial();
    stone.name = 'V2 | mineral charcoal stone';
    // A slab set into the ground at x 30, one set into a plinth (top 2.4) at x 0, and one on a bench.
    const merged = mergeGeometries([
      new THREE.BoxGeometry(1.2, 0.1, 0.6).translate(30, 2.03, 0),
      new THREE.BoxGeometry(6, 0.5, 6).translate(0, 2.15, 0),
      new THREE.BoxGeometry(1.2, 0.1, 0.6).translate(0, 2.43, 0),
      new THREE.BoxGeometry(1.2, 0.1, 0.6).translate(-30, 3.5, 0),
    ]);
    root.add(ground, new THREE.Mesh(merged, stone));
    addGardenDetails(root);
    const shade = root.getObjectByName('Garden contact shade') as THREE.Mesh;
    const position = shade.geometry.attributes.position;
    const alpha = shade.geometry.attributes.color;
    // Distance outside each slab's footprint.
    const outside = (i: number, cx: number) =>
      Math.hypot(Math.max(Math.abs(position.getX(i) - cx) - 0.6, 0), Math.max(Math.abs(position.getZ(i)) - 0.3, 0));
    for (const [cx, top] of [
      [30, 2],
      [0, 2.4],
    ]) {
      let core = 0;
      let rim = 0;
      for (let i = 0; i < position.count; i++) {
        // The plinth's own shade lies on the ground under it.
        if (Math.abs(position.getX(i) - cx) > 1 || Math.abs(position.getZ(i)) > 1 || position.getY(i) < top) continue;
        expect(position.getY(i)).toBeCloseTo(top + 0.012);
        if (alpha.getW(i) >= 0.6) {
          core++;
          expect(outside(i, cx)).toBeLessThan(1e-4);
        } else if (alpha.getW(i) === 0) {
          rim++;
          expect(outside(i, cx)).toBeCloseTo(0.3);
        } else expect(outside(i, cx)).toBeCloseTo(0.09);
      }
      expect(core).toBeGreaterThan(0);
      expect(rim).toBeGreaterThan(0);
    }
    for (let i = 0; i < position.count; i++) expect(Math.abs(position.getX(i) + 30)).toBeGreaterThan(2);
    disposeTree(root);
  });

  it('builds the same varied garden on every load', () => {
    const first = garden();
    const second = garden();
    for (const name of ['Garden evergreen foliage', 'Garden mineral charcoal stone', 'Garden seasonal flowers']) {
      const a = (first.root.getObjectByName(name) as THREE.Mesh).geometry;
      const b = (second.root.getObjectByName(name) as THREE.Mesh).geometry;
      expect(Array.from(a.attributes.position.array)).toEqual(Array.from(b.attributes.position.array));
      expect(a.attributes.color.count).toBe(a.attributes.position.count);
    }
    // Shrubs differ in green: more than a handful of distinct tints.
    const colors = (first.root.getObjectByName('Garden evergreen foliage') as THREE.Mesh).geometry.attributes.color;
    const tints = new Set<string>();
    for (let i = 0; i < colors.count; i += 12) tints.add(colors.getX(i).toFixed(3));
    expect(tints.size).toBeGreaterThan(20);
    disposeTree(first.root);
    disposeTree(second.root);
  });

  it('shapes each rock differently with smooth, finite normals and a settled base', () => {
    const a = rockGeometry(1.5);
    const b = rockGeometry(42);
    expect(Array.from(a.attributes.position.array)).not.toEqual(Array.from(b.attributes.position.array));
    for (const rock of [a, b]) {
      expect(rock.index).not.toBeNull();
      expect(Array.from(rock.attributes.normal.array).every(Number.isFinite)).toBe(true);
      rock.computeBoundingBox();
      expect(rock.boundingBox!.min.y).toBeGreaterThan(-0.7);
      expect(rock.boundingBox!.max.y).toBeGreaterThan(0.8);
      rock.dispose();
    }
  });

  it('leaves models without garden terrain alone', () => {
    const root = new THREE.Group();
    const details = addGardenDetails(root);
    details.update(0, 'summer', 0, 'clear', false);
    expect(root.children).toHaveLength(0);
  });
});
