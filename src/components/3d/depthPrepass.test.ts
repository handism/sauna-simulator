import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createDepthPrepass, PREPASS_LAYER } from './depthPrepass';

const standard = (parameters: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial(parameters);

describe('depth prepass', () => {
  it('adds a depth-only child sharing the geometry of each opaque mesh', () => {
    const prepass = createDepthPrepass();
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const wall = new THREE.Mesh(geometry, standard({ side: THREE.DoubleSide }));
    wall.renderOrder = 3;
    root.add(wall);
    expect(prepass.add(root)).toBe(1);
    const [copy] = wall.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    expect(copy.geometry).toBe(geometry);
    expect(copy.layers.mask).toBe(1 << PREPASS_LAYER);
    expect(copy.renderOrder).toBe(3);
    expect(copy.castShadow || copy.receiveShadow).toBe(false);
    expect(copy.material.colorWrite).toBe(false);
    expect(copy.material.side).toBe(THREE.DoubleSide);
    // Behind the lit pass's own depth, so its fragments pass the less-or-equal test.
    expect(copy.material.polygonOffset && copy.material.polygonOffsetFactor > 0).toBe(true);
    prepass.dispose();
  });

  it('leaves out blended, cut-out, refracted and other-layer surfaces', () => {
    const prepass = createDepthPrepass();
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const excluded = [
      standard({ transparent: true, opacity: 0.5 }),
      standard({ alphaTest: 0.5 }),
      standard({ alphaToCoverage: true }),
      standard({ depthWrite: false }),
      new THREE.ShaderMaterial(),
    ];
    const underwater = standard();
    underwater.defines = { SUI_REFRACTION: '0.7650' };
    excluded.push(underwater);
    for (const material of excluded) root.add(new THREE.Mesh(geometry, material));
    const sideImage = new THREE.Mesh(geometry, standard());
    sideImage.layers.set(2);
    root.add(sideImage);
    expect(prepass.add(root)).toBe(0);
    prepass.dispose();
  });

  it('hides the groups of a multi-material mesh that it leaves out', () => {
    const prepass = createDepthPrepass();
    const geometry = new THREE.BoxGeometry();
    const glass = standard({ transparent: true });
    const mesh = new THREE.Mesh(geometry, [standard(), glass, standard({ side: THREE.BackSide })]);
    expect(prepass.add(mesh)).toBe(1);
    const materials = (mesh.children[0] as THREE.Mesh).material as THREE.Material[];
    expect(materials.map((material) => material.visible)).toEqual([true, false, true]);
    expect(materials[0]).not.toBe(materials[2]);
    // One material per side, shared by the meshes.
    const other = new THREE.Mesh(geometry, standard());
    prepass.add(other);
    expect((other.children[0] as THREE.Mesh).material).toBe(materials[0]);
    prepass.dispose();
  });
});
