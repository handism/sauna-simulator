import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createShadowMask, MASK_END, MASK_LOAD, MASK_SLOTS, SHADOW_MASK_LAYER } from './shadowMask';
import { PREPASS_LAYER } from './depthPrepass';

const standard = (parameters: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial(parameters);

// Records what the mask pass asks of the renderer.
function fakeRenderer() {
  const calls: { target: unknown; layers: number; autoClear: boolean }[] = [];
  let target: unknown = 'canvas';
  let clearAlpha = 1;
  const clearColor = new THREE.Color(0x123456);
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: (next: unknown) => (target = next),
    getClearAlpha: () => clearAlpha,
    getClearColor: (color: THREE.Color) => color.copy(clearColor),
    setClearColor: (color: THREE.ColorRepresentation, alpha: number) => {
      clearColor.set(color);
      clearAlpha = alpha;
    },
    clear: vi.fn(),
    render: (_scene: THREE.Scene, camera: THREE.Camera) =>
      calls.push({ target, layers: camera.layers.mask, autoClear: renderer.autoClear }),
  };
  return { renderer, calls, clearColor: () => clearColor.getHex(), clearAlpha: () => clearAlpha };
}

describe('shadow mask', () => {
  it('adds a mask child sharing the geometry of each opaque shadow receiver and marks its material', () => {
    const mask = createShadowMask(fakeRenderer().renderer as unknown as THREE.WebGLRenderer);
    const geometry = new THREE.BoxGeometry();
    const material = standard({ side: THREE.DoubleSide });
    const previous = vi.fn();
    material.onBeforeCompile = previous;
    const wall = new THREE.Mesh(geometry, material);
    wall.receiveShadow = true;
    wall.renderOrder = 2;
    expect(mask.add(wall)).toBe(1);
    const [copy] = wall.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[];
    expect(copy.geometry).toBe(geometry);
    expect(copy.layers.mask).toBe(1 << SHADOW_MASK_LAYER);
    expect(copy.renderOrder).toBe(2);
    expect(copy.castShadow).toBe(false);
    expect(copy.receiveShadow).toBe(true);
    expect(copy.material.lights).toBe(true);
    expect(copy.material.side).toBe(THREE.DoubleSide);
    expect(material.defines?.SUI_SHADOW_MASK).toBe('');
    // The lit pass gets the mask's uniforms after the material's own extension.
    const shader = { uniforms: {} } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(previous).toHaveBeenCalledOnce();
    expect(shader.uniforms.suiShadowMaskOn).toBe(mask.uniforms.suiShadowMaskOn);
    // Marked once, however many meshes share it.
    mask.add(new THREE.Mesh(geometry, material));
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(previous).toHaveBeenCalledTimes(2);
    mask.dispose();
  });

  it('leaves out surfaces the depth prepass leaves out, non-receivers and other layers', () => {
    const mask = createShadowMask(fakeRenderer().renderer as unknown as THREE.WebGLRenderer);
    const geometry = new THREE.BoxGeometry();
    const receivers = [standard({ transparent: true }), standard({ alphaTest: 0.5 })].map((material) =>
      Object.assign(new THREE.Mesh(geometry, material), { receiveShadow: true }),
    );
    const notReceiving = new THREE.Mesh(geometry, standard());
    const sideImage = Object.assign(new THREE.Mesh(geometry, standard()), { receiveShadow: true });
    sideImage.layers.set(2);
    const root = new THREE.Group().add(...receivers, notReceiving, sideImage);
    expect(mask.add(root)).toBe(0);
    expect(sideImage.material.defines?.SUI_SHADOW_MASK).toBeUndefined();
    // A multi-material mesh keeps the eligible groups.
    const mixed = Object.assign(new THREE.Mesh(geometry, [standard(), standard({ transparent: true })]), {
      receiveShadow: true,
    });
    expect(mask.add(mixed)).toBe(1);
    const materials = (mixed.children[0] as THREE.Mesh).material as THREE.Material[];
    expect(materials.map((material) => material.visible)).toEqual([true, false]);
    mask.dispose();
  });

  it('refracts the copies of underwater materials and writes nothing where they may discard', () => {
    const mask = createShadowMask(fakeRenderer().renderer as unknown as THREE.WebGLRenderer);
    const geometry = new THREE.BoxGeometry();
    const underwater = standard();
    underwater.defines = { SUI_REFRACTION: '0.7650' };
    const floor = standard();
    floor.defines = { SUI_REFRACTION: '0.7650', SUI_WATER_BOTTOM: '' };
    const mesh = Object.assign(new THREE.Mesh(geometry, [standard(), underwater, floor]), { receiveShadow: true });
    expect(mask.add(mesh)).toBe(1);
    expect(underwater.defines.SUI_SHADOW_MASK).toBe('');
    const [dry, wet, bottom] = (mesh.children[0] as THREE.Mesh).material as THREE.ShaderMaterial[];
    expect(dry.defines).toEqual({});
    expect(dry.fragmentShader).not.toMatch(/discard;/);
    // The vertex stage's project_vertex refracts; the floor's shadow coordinates follow its paths.
    expect(wet.defines).toEqual({ SUI_REFRACTION: '0.7650' });
    expect(wet.fragmentShader).toMatch(/discard;/);
    expect(bottom.defines).toEqual({ SUI_REFRACTION: '0.7650', SUI_WATER_BOTTOM: '' });
    // Shared by the meshes with the same side and level.
    const other = Object.assign(new THREE.Mesh(geometry, underwater), { receiveShadow: true });
    mask.add(other);
    expect((other.children[0] as THREE.Mesh).material).toBe(wet);
    mask.dispose();
  });

  it('writes the mask of the cut-out cards where the lit pass keeps their leaves', () => {
    const mask = createShadowMask(fakeRenderer().renderer as unknown as THREE.WebGLRenderer);
    const geometry = new THREE.PlaneGeometry();
    const alphaMap = new THREE.Texture();
    const card = standard({ alphaMap, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide });
    const mesh = Object.assign(new THREE.Mesh(geometry, [card, standard()]), { receiveShadow: true });
    expect(mask.add(mesh)).toBe(1);
    expect(card.defines?.SUI_SHADOW_MASK).toBe('');
    const [cut, dry] = (mesh.children[0] as THREE.Mesh).material as THREE.ShaderMaterial[];
    expect(cut.defines).toEqual({ SUI_CUTOUT: '' });
    expect(cut.side).toBe(THREE.DoubleSide);
    expect(cut.uniforms.suiAlphaMap.value).toBe(alphaMap);
    expect(cut.uniforms.suiAlphaMapTransform.value).toBe(alphaMap.matrix);
    expect(cut.fragmentShader).toContain(
      'if ( suiLeafCoverage( suiOpacity * texture2D( suiAlphaMap, vSuiAlphaMapUv ).g, vSuiAlphaMapUv ) == 0.0 ) discard;',
    );
    expect(cut.fragmentShader).toContain('float suiLeafCoverage(');
    expect(dry.fragmentShader).not.toMatch(/discard;/);
    mask.dispose();
  });

  it('reads the mask in place of every lookup of the lit pass', () => {
    const lights = THREE.ShaderChunk.lights_fragment_begin;
    expect(lights.startsWith(MASK_LOAD)).toBe(true);
    expect(lights.endsWith(MASK_END)).toBe(true);
    expect(lights).toContain(
      '? SUI_MASKED( NUM_DIR_LIGHT_SHADOWS + UNROLLED_LOOP_INDEX ) getShadow( spotShadowMap[ i ]',
    );
    expect(lights).toContain(
      '? SUI_MASKED( UNROLLED_LOOP_INDEX ) suiSunShadow( directLight.color, directionalShadowMap[ i ]',
    );
    // Off the mask, a single lookup in place of the PCSS, whose functions are then never called.
    expect(MASK_LOAD).toContain('#define SUI_MASKED( slot ) suiMaskHit ? suiMaskFactor( slot ) :');
    expect(MASK_LOAD).toContain('#define getShadow suiHardShadow');
    expect(MASK_LOAD).toContain('#define suiSunShadow suiSunHardShadow');
    expect(MASK_END).toContain('#undef getShadow');
    // Without a mask, SUI_HARD_SHADOW takes the single lookups alone.
    const hard = MASK_LOAD.slice(MASK_LOAD.indexOf('#if defined( SUI_HARD_SHADOW )'));
    expect(hard).toContain('#define getShadow suiHardShadow');
    expect(hard).not.toContain('suiLoadShadowMask');
    expect(MASK_END).toContain('defined( SUI_HARD_SHADOW )');
    expect(THREE.ShaderChunk.lights_pars_begin).toContain(
      '#if ( defined( SUI_SHADOW_MASK ) || defined( SUI_HARD_SHADOW ) ) && defined( USE_SHADOWMAP )',
    );
    expect(THREE.ShaderChunk.lights_pars_begin).toContain('vec3 v = round( texel.rgb );');
  });

  it('packs three 8-bit factors into a channel exactly in 32-bit floats', () => {
    expect(MASK_SLOTS).toBe(9);
    const all = 255 + 255 * 256 + 255 * 65536;
    expect(Math.fround(all)).toBe(all);
    // Adding a half before flooring, as a first version did, rounds it up to 2^24.
    expect(Math.fround(all + 0.5)).toBe(2 ** 24);
  });

  it('draws the depth copies, then the mask copies, at half resolution and restores the renderer', () => {
    const { renderer, calls, clearColor, clearAlpha } = fakeRenderer();
    const mask = createShadowMask(renderer as unknown as THREE.WebGLRenderer);
    const scene = new THREE.Scene();
    const light = new THREE.SpotLight();
    light.castShadow = true;
    light.shadow.needsUpdate = false;
    light.shadow.map = new THREE.WebGLRenderTarget(1, 1);
    scene.add(light);
    const camera = new THREE.PerspectiveCamera();
    camera.layers.enable(2);
    const layers = camera.layers.mask;
    mask.render(scene, camera, 1201, 800);
    expect(calls.map(({ layers }) => layers)).toEqual([1 << PREPASS_LAYER, 1 << SHADOW_MASK_LAYER]);
    expect(calls.every(({ autoClear, target }) => !autoClear && target !== 'canvas')).toBe(true);
    // three gathers only lights on the camera's layers.
    expect(light.layers.isEnabled(SHADOW_MASK_LAYER)).toBe(true);
    const texture = mask.uniforms.suiShadowMask.value as THREE.Texture<{ width: number; height: number }>;
    expect([texture.image.width, texture.image.height]).toEqual([601, 400]);
    expect(mask.uniforms.suiShadowMaskScale.value.toArray()).toEqual([601 / 1201, 0.5]);
    expect(mask.uniforms.suiShadowMaskOn.value).toBe(true);
    expect([camera.layers.mask, renderer.autoClear, renderer.getRenderTarget()]).toEqual([layers, true, 'canvas']);
    expect([clearColor(), clearAlpha()]).toEqual([0x123456, 1]);
    mask.end();
    expect(mask.uniforms.suiShadowMaskOn.value).toBe(false);

    // The mirror's mask has a target of its own.
    mask.render(scene, camera, 300, 100, 'mirror');
    expect(mask.uniforms.suiShadowMask.value).not.toBe(texture);
    mask.dispose();
  });

  it('lets the view draw shadow maps that need it before the mask layers', () => {
    const { renderer, calls } = fakeRenderer();
    const mask = createShadowMask(renderer as unknown as THREE.WebGLRenderer);
    const scene = new THREE.Scene();
    const light = new THREE.DirectionalLight();
    light.castShadow = true;
    scene.add(light);
    const camera = new THREE.PerspectiveCamera();
    const layers = camera.layers.mask;
    let read: unknown = 'unset';
    renderer.render = (_scene, view) => {
      if (!calls.length) read = mask.uniforms.suiShadowMask.value;
      return calls.push({
        target: renderer.getRenderTarget(),
        layers: view.layers.mask,
        autoClear: renderer.autoClear,
      });
    };
    mask.render(scene, camera, 100, 100);
    expect(calls.map(({ layers }) => layers)).toEqual([layers, 1 << PREPASS_LAYER, 1 << SHADOW_MASK_LAYER]);
    // It draws into the mask's target, which it must not read meanwhile.
    expect(read).toBeNull();
    mask.dispose();
  });
});
