import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FAR_FOREST_RADIUS, createFarForest, crownHeight, farForestCrowns } from './farForest';

describe('far forest', () => {
  it('rings the woodland with the same crowns on every load, about a third evergreen', () => {
    const crowns = farForestCrowns();
    expect(crowns).toEqual(farForestCrowns());
    expect(crowns.length).toBeGreaterThan(80);
    const evergreen = crowns.filter((crown) => crown.evergreen).length / crowns.length;
    expect(evergreen).toBeGreaterThan(0.25);
    expect(evergreen).toBeLessThan(0.45);
    for (const crown of crowns) {
      expect(crown.top).toBeGreaterThan(4.5);
      // Below the ridges' crest as seen from the deck: taller, the band made the skyline.
      expect(crown.top).toBeLessThan(9.5);
    }
  });
  it('keeps lobed crowns below their leaders and outside their original width', () => {
    const [broad, ever] = [false, true].map((evergreen) => ({
      angle: 0,
      radius: 2,
      top: 10,
      evergreen,
      shade: 0,
      pick: 0,
    }));
    expect(crownHeight(broad, 0)).toBe(10);
    expect(crownHeight(ever, 0)).toBe(10);
    expect(crownHeight(broad, 2.1)).toBe(-Infinity);
    // Broadleaf shoulders remain wider than the tapering evergreen shoulders.
    expect(10 - crownHeight(broad, 1)).toBeLessThan(0.5);
    expect(10 - crownHeight(ever, 1)).toBeGreaterThan(1);
    for (const crown of farForestCrowns()) {
      for (let n = -99; n <= 99; n++) {
        const y = crownHeight(crown, (n / 100) * crown.radius);
        expect(Number.isFinite(y)).toBe(true);
        expect(y).toBeLessThanOrEqual(crown.top);
      }
    }
  });
  it('stands on its ring between the woodland and the ridges, recolored by season and lit by the caller', () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const position = forest.mesh.geometry.attributes.position;
    // Check every vertex: the sparse rear shoulders must not spill past the
    // backing ring or into the real woodland between sampled vertices.
    // Counted rather than asserted per vertex, which outran CI's 5s timeout.
    let strays = 0;
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i));
      if (radius < 44 - 1e-4 || radius > FAR_FOREST_RADIUS + 1e-4 || !(position.getY(i) < 16)) strays++;
    }
    expect(strays).toBe(0);
    // The bridge is separated in depth from the backing, stays outside the real trees,
    // and uses finite geometry even at a crown's open ends.
    expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
    const radii = Array.from({ length: position.count }, (_, i) => Math.hypot(position.getX(i), position.getZ(i)));
    expect(radii.some((r) => r < 47)).toBe(true);
    expect(radii.filter((r) => r < 53).reduce((a, b) => Math.max(a, b), 0)).toBeGreaterThan(50);
    expect(radii.some((r) => r > 53.9)).toBe(true);
    expect(Array.from(forest.mesh.geometry.attributes.gardenCrownSide.array).every(Number.isFinite)).toBe(true);
    const color = forest.mesh.geometry.attributes.color;
    forest.update('summer', new THREE.Color(0.45, 0.45, 0.45));
    const summer = Array.from(color.array);
    expect(summer.every(Number.isFinite)).toBe(true);
    forest.update('autumn', new THREE.Color(0.45, 0.45, 0.45));
    const autumn = Array.from(color.array);
    expect(autumn).not.toEqual(summer);
    // Autumn reds and ochres: more red than green on average.
    const mean = (values: number[], k: number) => values.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0);
    expect(mean(autumn, 0)).toBeGreaterThan(mean(autumn, 1));
    expect(mean(summer, 1)).toBeGreaterThan(mean(summer, 0));
    forest.update('summer', new THREE.Color(0.1, 0.2, 0.3));
    expect(Array.from(color.array)).toEqual(summer);
    // The frayed outline over each vertex; none where a crown covers the understory's top.
    const edge = forest.mesh.geometry.attributes.gardenEdge;
    expect(edge.count).toBe(position.count);
    let belowEdge = 0;
    for (let i = 0; i < position.count; i++) if (!(edge.getX(i) >= position.getY(i) - 1e-4)) belowEdge++;
    expect(belowEdge).toBe(0);
    // Kept out of the depth prepass, whose depth would hide the sky behind the frayed edge.
    expect((forest.mesh.material as THREE.MeshBasicMaterial).alphaTest).toBeGreaterThan(0);
    expect((forest.mesh.material as THREE.MeshBasicMaterial).color.toArray()).toEqual([0.1, 0.2, 0.3]);
  });
  it('gives the backing shoulders continuous depth without opening seams or moving the buried foot', () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const position = forest.mesh.geometry.attributes.position;
    const shoulders = new Map<string, number>();
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) !== 4.5) continue;
      const x = position.getX(i),
        z = position.getZ(i);
      const radius = Math.hypot(x, z);
      const angle = Math.atan2(z, x).toFixed(5);
      // Adjacent crown owners must place their shared edge at the same radius.
      if (shoulders.has(angle)) expect(radius).toBeCloseTo(shoulders.get(angle)!, 4);
      shoulders.set(angle, radius);
      expect(radius).toBeGreaterThanOrEqual(51.8 - 1e-4);
      expect(radius).toBeLessThanOrEqual(54 + 1e-4);
    }
    expect(Math.min(...shoulders.values())).toBeLessThan(52);
    expect(Math.max(...shoulders.values())).toBeGreaterThan(53.9);
    // The band still closes the horizon, with the foot on the original circle.
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i));
      if (position.getY(i) === -4 && radius > 53) expect(radius).toBeCloseTo(54, 4);
    }
    forest.mesh.geometry.dispose();
    (forest.mesh.material as THREE.Material).dispose();
  });
  it('closes every crown volume without holes, below its crown top, within a geometry budget', () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const { geometry } = forest.mesh;
    const { position, gardenEdge, gardenBand, gardenCrownTop } = geometry.attributes;
    const index = geometry.index!;
    // Counted rather than asserted per vertex: some 420,000 expect calls outran CI's 5s timeout.
    let mixedBands = 0;
    let aboveTop = 0;
    let degenerate = 0;
    // One id per rounded point, with -0 as 0 (a pole on the x axis comes out as either).
    const ids = new Map<string, number>();
    const pointId = new Int32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const key = [position.getX(i), position.getY(i), position.getZ(i)]
        .map((v) => (v + 0).toFixed(4).replace(/^-(0\.0+)$/, '$1'))
        .join(',');
      let id = ids.get(key);
      if (id === undefined) ids.set(key, (id = ids.size));
      pointId[i] = id;
    }
    const edges = new Map<number, number>();
    let far = 0;
    let volumes = 0;
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      if (gardenBand.getX(a) !== 0) continue;
      volumes++;
      if (gardenEdge.getX(a) === 2e4) far++;
      const vertices = [a, index.getX(t + 1), index.getX(t + 2)].map((i) => {
        if (gardenBand.getX(i) !== 0) mixedBands++;
        // The leaders, shoulders and foliage clumps stay under the crown's top.
        if (position.getY(i) > gardenCrownTop.getX(i) + 1e-4) aboveTop++;
        return pointId[i];
      });
      if (new Set(vertices).size !== 3) degenerate++;
      for (let n = 0; n < 3; n++) {
        const p = vertices[n];
        const q = vertices[(n + 1) % 3];
        const key = Math.min(p, q) * ids.size + Math.max(p, q);
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect(mixedBands).toBe(0);
    expect(aboveTop).toBe(0);
    expect(degenerate).toBe(0);
    // Closed: every edge of the volumes (leaders, shoulders, clumps) shared by two of their triangles.
    expect([...edges.values()].every((count) => count === 2)).toBe(true);
    // The far rank: three lobes and four clumps a crown.
    expect(far).toBeGreaterThan(0);
    expect(far).toBeLessThan(8000);
    // About 58,600 triangles of clumps over the 32,780 of the band and lobes; the shared vertices
    // keep the attributes and the 32-bit index near the earlier non-indexed arrays (5.3 against 4.7 MB).
    expect(volumes).toBeGreaterThan(70000);
    expect(index.count / 3).toBeLessThan(95000);
    let bytes = index.array.byteLength;
    for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
    // Plus the volumes' 8-bit normals for their frayed outline (240 KB).
    expect(bytes).toBeLessThan(5.65e6);
    geometry.dispose();
    (forest.mesh.material as THREE.Material).dispose();
  });
  it("raises the front volumes to their crowns' tips and gives only the volumes normals to fray", () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const { gardenBand, gardenEdge, gardenCrownTop, gardenNormal } = forest.mesh.geometry.attributes;
    const tips = farForestCrowns().map((crown) => crown.top);
    // Counted rather than asserted per vertex, which outran CI's 5s timeout.
    let bandNormals = 0;
    let volumeNormals = 0;
    let misplaced = 0;
    let front = 0;
    // Many vertices share a crown top: find each one's nearest tip once.
    const drops = new Map<number, number>();
    for (let i = 0; i < gardenBand.count; i++) {
      const length = Math.hypot(gardenNormal.getX(i), gardenNormal.getY(i), gardenNormal.getZ(i));
      if (gardenBand.getX(i) === 1) {
        // The band frays by its outline's height instead.
        if (length !== 0) bandNormals++;
        continue;
      }
      if (!(length > 0.98 && length < 1.02)) volumeNormals++;
      if (gardenEdge.getX(i) !== 1e4) continue;
      // The front rank (not the backing one, 0.25m under): close enough under a tip to hide the band's.
      const top = gardenCrownTop.getX(i);
      let drop = drops.get(top);
      if (drop === undefined) drops.set(top, (drop = Math.min(...tips.map((tip) => Math.abs(tip - top)))));
      if (drop < 0.22) front++;
      if (!(drop < 0.2 + 1e-4 || Math.abs(drop - 0.25) < 1e-4)) misplaced++;
    }
    expect(bandNormals).toBe(0);
    expect(volumeNormals).toBe(0);
    expect(misplaced).toBe(0);
    expect(front).toBeGreaterThan(0);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    (forest.mesh.material as THREE.MeshBasicMaterial).onBeforeCompile(shader as any, undefined as any);
    expect(shader.vertexShader).toContain('vGardenNormal = gardenNormal;');
    expect(shader.fragmentShader).toContain('normalize(cameraPosition - vGardenPosition)');
    forest.mesh.geometry.dispose();
    (forest.mesh.material as THREE.MeshBasicMaterial).dispose();
  });
});
