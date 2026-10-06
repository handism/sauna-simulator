import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectWarmupPasses } from './warmupPasses';
import { PREPASS_LAYER } from './depthPrepass';
import { MIRROR_LAYER } from './planarReflection';
import { SHADOW_MASK_LAYER } from './shadowMask';
import { SIDE_IMAGE_LAYER } from './refraction';

function fixture() {
  const root = new THREE.Group();
  const mainLayers = new THREE.Layers();
  mainLayers.enable(SIDE_IMAGE_LAYER);
  const options = { mainLayers, mirrorEnabled: true, shadowMaskEnabled: true, waterLevel: 0 };
  const add = (layer = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.layers.set(layer);
    root.add(mesh);
    return mesh;
  };
  const collect = () => {
    root.updateMatrixWorld(true);
    return collectWarmupPasses(root, options);
  };
  return { root, options, add, collect };
}

describe('warmup pass eligibility', () => {
  it('includes shadow-mask depth copies in both passes and respects mirror-only and side-image layers', () => {
    const { add, collect, options } = fixture();
    const meshes = [0, PREPASS_LAYER, SHADOW_MASK_LAYER, MIRROR_LAYER, SIDE_IMAGE_LAYER, 7].map(add);
    const original = options.mainLayers.mask;
    const passes = collect();
    expect(meshes.map((mesh) => [...(passes.get(mesh.material) ?? [])])).toEqual([
      ['main', 'mirror'],
      ['main', 'mirror'],
      ['main', 'mirror'],
      ['mirror'],
      ['main'],
      [],
    ]);
    expect(options.mainLayers.mask).toBe(original);
    options.shadowMaskEnabled = false;
    expect(collect().get(meshes[1].material)).toEqual(new Set(['main']));
    expect(collect().has(meshes[2].material)).toBe(false);
    options.mirrorEnabled = false;
    expect(collect().has(meshes[3].material)).toBe(false);
    expect(collect().get(meshes[0].material)).toEqual(new Set(['main']));
  });

  it('recollects visibility, skips hidden ancestors/materials, and unions shared multi-material uses', () => {
    const { root, add, collect } = fixture();
    const side = add(SIDE_IMAGE_LAYER);
    const mirror = add(MIRROR_LAYER);
    mirror.material = side.material;
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), [side.material, hidden]));
    expect(collect().get(side.material)).toEqual(new Set(['main', 'mirror']));
    expect(collect().has(hidden)).toBe(false);
    root.children[2].visible = false;
    mirror.visible = false;
    expect(collect().get(side.material)).toEqual(new Set(['main']));
    root.visible = false;
    expect(collect().size).toBe(0);
    expect(hidden.visible).toBe(false);
  });

  it('uses transformed bounds, retains touching surfaces, and honors disabled culling', () => {
    const { root, add, collect, options } = fixture();
    const mesh = add();
    mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    root.position.y = -3;
    mesh.scale.setScalar(2);
    expect(collect().get(mesh.material)).toEqual(new Set(['main']));
    options.waterLevel = -1;
    expect(collect().get(mesh.material)).toEqual(new Set(['main', 'mirror']));
    options.waterLevel = 0;
    mesh.frustumCulled = false;
    expect(collect().get(mesh.material)).toEqual(new Set(['main', 'mirror']));
  });

  it('uses instance bounds instead of the untransformed geometry bounds', () => {
    const { root, collect } = fixture();
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, -10, 0));
    root.add(mesh);
    expect(collect().get(mesh.material)).toEqual(new Set(['main']));
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 10, 0));
    mesh.computeBoundingSphere();
    expect(collect().get(mesh.material)).toEqual(new Set(['main', 'mirror']));
  });
});
