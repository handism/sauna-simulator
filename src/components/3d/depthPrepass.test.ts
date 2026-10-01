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

  it('leaves out blended, cut-out and other-layer surfaces', () => {
    const prepass = createDepthPrepass();
    const root = new THREE.Group();
    const geometry = new THREE.BoxGeometry();
    const excluded = [
      standard({ transparent: true, opacity: 0.5 }),
      standard({ alphaTest: 0.5 }),
      standard({ alphaToCoverage: true }),
      // Cut out by the map's alpha, which the copies do not read.
      standard({ alphaTest: 0.5, alphaMap: new THREE.Texture(), map: new THREE.Texture() }),
      standard({ alphaMap: new THREE.Texture() }),
      standard({ depthWrite: false }),
      new THREE.ShaderMaterial(),
    ];
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

  it('refracts the copies of underwater materials and writes no depth where they may discard', () => {
    const prepass = createDepthPrepass();
    const geometry = new THREE.BoxGeometry();
    const underwater = standard();
    underwater.defines = { SUI_REFRACTION: '0.7650' };
    const dry = standard();
    const mesh = new THREE.Mesh(geometry, [underwater, dry]);
    expect(prepass.add(mesh)).toBe(1);
    const [wet, plain] = (mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial[];
    expect(wet).not.toBe(plain);
    expect(wet.colorWrite).toBe(false);
    expect(wet.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());
    const shader = {
      vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    wet.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    // Only the vertex stage takes the define: the lit fragment chunks it guards need the lit shader.
    expect(shader.vertexShader.startsWith('#define SUI_REFRACTION 0.7650\n')).toBe(true);
    expect(shader.fragmentShader).not.toContain('#define SUI_REFRACTION');
    expect(shader.fragmentShader).toMatch(/discard;/);
    // Shared by the meshes with the same side and level.
    const other = new THREE.Mesh(geometry, underwater);
    prepass.add(other);
    expect((other.children[0] as THREE.Mesh).material).toBe(wet);
    prepass.dispose();
  });

  it('writes the depth of the cut-out cards only where their alpha to coverage covers every sample', () => {
    const prepass = createDepthPrepass();
    const geometry = new THREE.PlaneGeometry();
    const alphaMap = new THREE.Texture();
    const card = standard({ alphaMap, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    const plain = standard({ alphaMap, alphaTest: 0.5 });
    const mesh = new THREE.Mesh(geometry, [card, plain]);
    expect(prepass.add(mesh)).toBe(1);
    const [covered, cut] = (mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial[];
    expect([covered.alphaMap, covered.alphaTest, covered.side, covered.colorWrite]).toEqual([
      alphaMap,
      0.5,
      THREE.DoubleSide,
      false,
    ]);
    // No alpha to coverage of its own: it would cover samples by another program's coverage.
    expect(covered.alphaToCoverage).toBe(false);
    const compile = (material: THREE.MeshBasicMaterial) => {
      const shader = {
        vertexShader: THREE.ShaderLib.basic.vertexShader,
        fragmentShader: THREE.ShaderLib.basic.fragmentShader,
      } as THREE.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      return shader.fragmentShader;
    };
    expect(compile(covered)).toContain('if ( diffuseColor.a < alphaTest + fwidth( diffuseColor.a ) ) discard;');
    expect(compile(cut)).toContain('#include <alphatest_fragment>');
    expect(covered.customProgramCacheKey()).not.toBe(cut.customProgramCacheKey());
    // Each material keeps its copy.
    const other = new THREE.Mesh(geometry, card);
    prepass.add(other);
    expect((other.children[0] as THREE.Mesh).material).toBe(covered);
    prepass.dispose();
  });
});
