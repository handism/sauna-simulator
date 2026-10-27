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
    // The impostors' front rank from 48m.
    expect(radii.some((r) => r < 49)).toBe(true);
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
  it('stands one baked crown in front of the band for each crown, its tree top at the crown top', () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const { geometry } = forest.mesh;
    const { position, uv, gardenImpostor, gardenBand, gardenCrownTop, gardenEdge, gardenBroadleaf } =
      geometry.attributes;
    const crowns = farForestCrowns();
    const quads: number[][] = [];
    for (let i = 0; i < position.count; i++) {
      if (gardenImpostor.getX(i) === 0) continue;
      expect(gardenBand.getX(i)).toBe(0);
      if (!quads.length || quads[quads.length - 1].length === 4) quads.push([]);
      quads[quads.length - 1].push(i);
    }
    expect(quads.length).toBe(crowns.length);
    const drops = { front: 0, backing: 0, far: 0 };
    quads.forEach((quad, c) => {
      const crown = crowns[c];
      const ys = quad.map((i) => position.getY(i));
      const bottom = Math.min(...ys);
      const top = Math.max(...ys);
      expect(bottom).toBe(-4);
      // The baked tree's top 0.25m under its tile's 12.8m.
      expect(bottom + (top - bottom) * (12.55 / 12.8)).toBeCloseTo(gardenCrownTop.getX(quad[0]), 4);
      const drop = crown.top - gardenCrownTop.getX(quad[0]);
      const rank = c % 6 === 3 ? 'far' : c % 6 === 0 ? 'backing' : 'front';
      expect(drop).toBeCloseTo({ front: 0.2, backing: 0.25, far: 0.1 }[rank], 4);
      drops[rank]++;
      // The far rank alone carries the larger sentinel QA omits it by.
      expect(gardenEdge.getX(quad[0])).toBe(rank === 'far' ? 2e4 : 1e4);
      // One tile of the 4 × 2 atlas, broadleaf (the first five) or evergreen by the crown.
      const us = quad.map((i) => uv.getX(i));
      const vs = quad.map((i) => uv.getY(i));
      const column = Math.floor(Math.min(...us) * 4 + 1e-6);
      const row = Math.floor(Math.min(...vs) * 2 + 1e-6);
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.25, 6);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(0.5, 6);
      expect(row * 4 + column >= 5).toBe(crown.evergreen);
      expect(gardenBroadleaf.getX(quad[0]) > 0).toBe(!crown.evergreen);
      // Its tree's top row at its top (an ImageBitmap is not flipped).
      const topVertex = quad[ys.indexOf(top)];
      expect(uv.getY(topVertex)).toBeCloseTo(row / 2, 6);
      // Facing the clearing: its corners at one distance along the crown's direction.
      const along = quad.map(
        (i) => position.getX(i) * Math.cos(crown.angle) + position.getZ(i) * Math.sin(crown.angle),
      );
      expect(Math.max(...along) - Math.min(...along)).toBeLessThan(1e-4);
    });
    expect(drops.front).toBeGreaterThan(50);
    expect(drops.backing).toBeGreaterThan(10);
    expect(drops.far).toBeGreaterThan(10);
    // The band's 32,780 triangles less the old volumes, plus two a crown.
    expect(geometry.index!.count / 3).toBeLessThan(25000);
    geometry.dispose();
    (forest.mesh.material as THREE.Material).dispose();
  });
  it('cuts the impostors out of their atlas over the samples and shades them by the baked crown', () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const material = forest.mesh.material as THREE.MeshBasicMaterial;
    // A clear placeholder until the atlas arrives, so the same program draws both.
    const placeholder = material.map!;
    expect(placeholder).toBeInstanceOf(THREE.DataTexture);
    expect(Array.from((placeholder.image as { data: Uint8Array }).data)).toEqual([0, 0, 0, 0]);
    const atlas = new THREE.Texture();
    let disposed = 0;
    placeholder.addEventListener('dispose', () => disposed++);
    forest.setImpostors(atlas);
    expect(material.map).toBe(atlas);
    expect(disposed).toBe(1);
    expect(material.alphaToCoverage).toBe(true);
    // Still kept out of the depth prepass.
    expect(material.alphaTest).toBeGreaterThan(0);
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    };
    material.onBeforeCompile(shader as any, undefined as any);
    expect(shader.fragmentShader).toContain('texture2D(map, vMapUv)');
    expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
    expect(shader.fragmentShader).not.toContain('#include <alphatest_fragment>');
    expect(shader.vertexShader).toContain('vGardenImpostor = gardenImpostor;');
    // Without the sun, its mean, as on the band.
    forest.update('summer', new THREE.Color(1, 1, 1), 0.25);
    expect(shader.uniforms.gardenSun.value).toBe(0.25);
    expect(shader.fragmentShader.match(/mix\(0\.3, max\(0\.0, dot\(gardenNormal/g)?.length).toBe(2);
    forest.mesh.geometry.dispose();
    material.dispose();
  });
  it("frays the understory with the crown over it and tints its foot as no crown's", () => {
    const forest = createFarForest({ value: new THREE.Color() });
    const { position, gardenEdge, gardenBand, gardenBroadleaf, color } = forest.mesh.geometry.attributes;
    forest.update('winter', new THREE.Color(1, 1, 1));
    let higher = 0;
    const feet = new Set<string>();
    for (let i = 0; i < position.count; i++) {
      if (gardenBand.getX(i) !== 1) continue;
      // No unfrayed sentinel left on the band: under a crown its outline is above the understory.
      expect(gardenEdge.getX(i)).toBeLessThan(100);
      if (position.getY(i) === 4.5 && gardenEdge.getX(i) > 4.6) higher++;
      if (position.getY(i) === -4) {
        expect(gardenBroadleaf.getX(i)).toBe(0);
        feet.add([color.getX(i), color.getY(i), color.getZ(i)].map((v) => v.toFixed(5)).join());
      }
    }
    expect(higher).toBeGreaterThan(1000);
    // One tint at the foot all round.
    expect(feet.size).toBe(1);
    forest.mesh.geometry.dispose();
    (forest.mesh.material as THREE.Material).dispose();
  });
});
