import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
