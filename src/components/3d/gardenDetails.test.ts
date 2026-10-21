import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addGardenDetails, rockGeometry, settleTerraceProps, tuckGrassBehindBoulders } from './gardenDetails';
import { FOOTLIGHT_DIRECTION, FOOTLIGHTS } from './lighting';
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
  it("keeps the shadow casters out of the footlights' beams across the stepping stones", () => {
    // Ground just under the lights, as around the source's stepping stones.
    const root = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshStandardMaterial());
    ground.material.name = 'garden moss';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.3;
    root.add(ground);
    const details = addGardenDetails(root);
    prepareModel(root);
    details.finishPreparation();
    root.updateMatrixWorld(true);
    const casters: THREE.Mesh[] = [];
    details.group!.traverse((object) => {
      if (object instanceof THREE.Mesh && object.castShadow) casters.push(object);
    });
    const ray = new THREE.Raycaster();
    const axis = new THREE.Vector3(...FOOTLIGHT_DIRECTION).setY(0).normalize();
    for (const position of FOOTLIGHTS)
      for (let yaw = -60; yaw <= 60; yaw += 10)
        for (const rise of [0, 0.15, 0.3]) {
          const direction = axis.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (yaw * Math.PI) / 180);
          ray.set(new THREE.Vector3(...position), direction.setY(rise).normalize());
          ray.far = 2;
          expect(ray.intersectObjects(casters, false).map((hit) => hit.object.name)).toEqual([]);
        }
    disposeTree(root);
  });

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
    const stream = root.getObjectByName('Garden flowing water') as THREE.Mesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    const shader = {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {},
    } as Parameters<typeof stream.material.onBeforeCompile>[0];
    stream.material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    details.update(2, 'summer', 0, 'clear', false);
    expect(shader.uniforms.gardenTime.value).toBe(2);
    expect(stream.castShadow).toBe(false);
    expect(grass.rotation.z).not.toBe(0);
    expect(flowers.visible).toBe(true);
    details.update(9, 'winter', 2, 'snow', true);
    expect(shader.uniforms.gardenTime.value).toBe(0);
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
    const flyingAt = Array.from({ length: 480 }, (_, i) => i * 0.5).find((t) => {
      details.update(t, 'summer', 0, 'clear', false);
      return butterfly.visible;
    })!;
    expect(flyingAt).toBeDefined();
    for (const [season, time, weather, reduced] of [
      ['winter', 0, 'clear', false],
      ['summer', 0, 'rain', false],
      ['summer', 2, 'clear', false],
      ['spring', 0, 'clear', true],
    ] as const) {
      details.update(flyingAt, season, time, weather, reduced);
      expect(butterfly.visible).toBe(false);
    }
    disposeTree(root);
  });

  it('flies butterflies in visits that land on blooms with symmetric wingbeats', () => {
    const { root, details } = garden();
    const flowers = root.getObjectByName('Garden seasonal flowers') as THREE.Mesh;
    flowers.geometry.computeBoundingBox();
    const bloomsTop = flowers.geometry.boundingBox!.max.y;
    for (let n = 0; n < 3; n++) {
      const butterfly = root.getObjectByName(`Garden butterfly ${n}`)!;
      const [right, left] = ['right', 'left'].map((side) =>
        root.getObjectByName(`Garden butterfly ${n} wing ${side}`)!,
      );
      let shown = 0,
        hidden = 0,
        still = 0;
      const last = new THREE.Vector3(NaN, NaN, NaN);
      for (let t = 0; t < 200; t += 0.1) {
        details.update(t, 'spring', 0, 'clear', false);
        if (!butterfly.visible) {
          hidden++;
          last.set(NaN, NaN, NaN);
          continue;
        }
        shown++;
        expect(left.rotation.z).toBeCloseTo(-right.rotation.z);
        // Wings between about 30° below level and closed above the back.
        expect(right.rotation.z).toBeGreaterThan(-0.6);
        expect(right.rotation.z).toBeLessThan(1.55);
        const { x, y, z } = butterfly.position;
        // Above the ground (at y = 2 here) near the patches, and never too fast.
        if (Math.hypot(x - 2, z - 6) < 9) expect(y).toBeGreaterThan(2.02);
        if (Number.isFinite(last.x)) expect(butterfly.position.distanceTo(last)).toBeLessThan(0.8);
        // Resting on a flower: still, level and at a bloom's height.
        if (Number.isFinite(last.x) && butterfly.position.distanceTo(last) < 1e-6) {
          still++;
          expect(y).toBeLessThan(bloomsTop + 0.05);
          expect(Math.abs(butterfly.rotation.x)).toBeLessThan(0.05);
        }
        last.copy(butterfly.position);
      }
      expect(shown).toBeGreaterThan(400);
      expect(hidden).toBeGreaterThan(100);
      expect(still).toBeGreaterThan(30);
    }
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

  it('sets floating sandals and lounger legs onto the terrace and shades them, the table and each lounger', () => {
    const root = new THREE.Group();
    const named = (name: string) => Object.assign(new THREE.MeshStandardMaterial(), { name });
    // A deck whose top is 0.07, with a 5mm seam at x 0.394–0.399 that rays fall through, right
    // under the center of one leg (x 0.396).
    root.add(
      new THREE.Mesh(
        mergeGeometries([
          new THREE.BoxGeometry(5.394, 0.1, 6).translate(-2.303, 0.02, 0),
          new THREE.BoxGeometry(4.601, 0.1, 6).translate(2.6995, 0.02, 0),
        ]),
        named('V2 | outdoor ash / grain & wear'),
      ),
    );
    const sole = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.03, 0.4).translate(-3, 0.115, 1),
      named('V4 | cork sandal sole'),
    );
    // A lounger turned by 0.3rad: legs 0.8m apart across, 1.5m along, 3cm above the deck, on two
    // rails that do not overlap; the table's foot sunk 2cm into the deck; a cup's handle up high.
    const turn = 0.3;
    const at = (across: number, along: number) => [
      1 + across * Math.cos(turn) + along * Math.sin(turn),
      -across * Math.sin(turn) + along * Math.cos(turn),
    ];
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-0.4, 0.4]) {
      for (const end of [-0.75, 0.75]) {
        const [x, z] = at(side, end);
        parts.push(new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(x, 0.25, z));
      }
      const [x, z] = at(side, 0);
      parts.push(new THREE.BoxGeometry(0.06, 0.8, 1.7).rotateY(turn).translate(x, 0.65, z));
    }
    parts.push(new THREE.BoxGeometry(0.16, 0.46, 0.16).translate(-1, 0.28, -2));
    parts.push(new THREE.BoxGeometry(0.08, 0.01, 0.08).translate(-1, 0.64, -2));
    const bronze = new THREE.Mesh(mergeGeometries(parts), named('Blackened bronze'));
    root.add(sole, bronze);
    root.updateMatrixWorld(true);
    const { contacts, settled, loungers } = settleTerraceProps(root);
    expect(settled).toBe(5);
    expect(loungers).toBe(1);
    sole.geometry.computeBoundingBox();
    expect(sole.geometry.boundingBox!.min.y).toBeCloseTo(0.07);
    // Each foot reaches the deck; the rest of the leg and the rails, foot and handle stay.
    const position = bronze.geometry.attributes.position;
    const heights = new Set<number>();
    for (let i = 0; i < position.count; i++) heights.add(Math.round(position.getY(i) * 1000));
    expect([...heights].sort((a, b) => a - b)).toEqual([50, 70, 250, 400, 510, 635, 645, 1050]);
    // Sole, 4 legs, the table's foot and its top, and the lounger: turned, the legs' half spans.
    expect(contacts).toHaveLength(8);
    const lounger = contacts.find(([, , hx, , margin]) => hx > 0 && margin === 0.3)!;
    const [x, z] = at(0, 0);
    expect(lounger[0]).toBeCloseTo(x);
    expect(lounger[1]).toBeCloseTo(z);
    expect(lounger[2]).toBeCloseTo(0.4);
    expect(lounger[3]).toBeCloseTo(0.75);
    expect(Math.abs(Math.cos(lounger[7]! - turn))).toBeCloseTo(1);
    // The shades lie on the deck, also over its seam.
    for (const contact of contacts) {
      expect(contact[8]!(contact[0], contact[1])).toBeCloseTo(0.07);
      expect(contact[8]!(0.3965, 0)).toBeCloseTo(0.07);
    }
    disposeTree(root);
  });

  it('builds the same varied garden on every load', () => {
    const first = garden();
    const second = garden();
    for (const name of [
      'Garden evergreen foliage',
      'Garden mineral charcoal stone',
      'Garden seasonal flowers',
      'Garden grasses 0',
    ]) {
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
  it('moves grass clumps rooted in a boulder to its far rim, onto the lower support, and leaves other grass', () => {
    const root = new THREE.Group();
    // Two clumps of upright blades: one inside a boulder at (6.8, 2.9), one in the open at (-3, 6).
    const blades = (x: number, z: number) =>
      [0, 1, 2].flatMap((k) => [x + k * 0.1 - 0.1, 0, z, x + k * 0.1 - 0.08, 0, z, x + k * 0.1 - 0.09, 0.85, z]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([...blades(6.8, 2.9), ...blades(-3, 6)], 3));
    const grass = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    grass.name = 'Ornamental_grass_blade';
    root.add(grass);
    root.updateMatrixWorld(true);
    const boulder = new THREE.Box3(new THREE.Vector3(6.45, -0.01, 2.55), new THREE.Vector3(7.15, 0.48, 3.25));
    expect(
      tuckGrassBehindBoulders(
        root,
        [boulder],
        () => -0.2,
        () => () => true,
      ),
    ).toBe(1);
    const position = geometry.attributes.position;
    const away = new THREE.Vector2(6.8, 2.9).normalize().multiplyScalar(0.35 * 0.9);
    // The tuft keeps its shape, shifted outward to the rim and down onto the terrain.
    expect(position.getX(0)).toBeCloseTo(6.7 + away.x);
    expect(position.getZ(0)).toBeCloseTo(2.9 + away.y);
    expect(position.getY(0)).toBeCloseTo(-0.2);
    expect(position.getY(2) - position.getY(0)).toBeCloseTo(0.85);
    expect(position.getX(9)).toBeCloseTo(-3.1);
    expect(position.getY(9)).toBe(0);
    // Already out of the rock: a second pass moves nothing.
    expect(
      tuckGrassBehindBoulders(
        root,
        [boulder],
        () => -0.2,
        () => () => true,
      ),
    ).toBe(0);
  });
  it('turns a clump aside from a wall behind its boulder, or leaves it when no side has room', () => {
    const tuft = () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([7, 0, 0, 7.02, 0, 0, 7.01, 0.8, 0], 3));
      const grass = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
      grass.name = 'Ornamental_grass_blade';
      const root = new THREE.Group().add(grass);
      root.updateMatrixWorld(true);
      return { root, position: geometry.attributes.position };
    };
    const boulder = new THREE.Box3(new THREE.Vector3(6.7, 0, -0.3), new THREE.Vector3(7.3, 0.45, 0.3));
    // A wall just beyond the boulder along +x: the first side (+45°) has room.
    const walled = tuft();
    const wall = (_: THREE.Vector3, direction: THREE.Vector3) => direction.x < 0.9;
    expect(
      tuckGrassBehindBoulders(
        walled.root,
        [boulder],
        () => 0,
        () => wall,
      ),
    ).toBe(1);
    expect(walled.position.getX(0)).toBeCloseTo(7 + Math.SQRT1_2 * 0.27);
    expect(walled.position.getZ(0)).toBeCloseTo(Math.SQRT1_2 * 0.27);
    const boxed = tuft();
    expect(
      tuckGrassBehindBoulders(
        boxed.root,
        [boulder],
        () => 0,
        () => () => false,
      ),
    ).toBe(0);
    expect(boxed.position.getX(0)).toBe(7);
  });
});
