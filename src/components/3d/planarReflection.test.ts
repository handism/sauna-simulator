import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  MIRROR_MARGIN,
  createMirrorUniforms,
  createPlanarReflection,
  mirrorMatrix,
  obliqueClip,
  screenBounds,
} from './planarReflection';

const LEVEL = 0.765;

function fakeRenderer() {
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    info: { render: { calls: 41, triangles: 1234 } },
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(800, 600),
    getRenderTarget: () => target,
    setRenderTarget: vi.fn((next: THREE.WebGLRenderTarget | null) => (target = next)),
    render: vi.fn(),
  };
  return renderer;
}

function setup() {
  const renderer = fakeRenderer();
  const uniforms = createMirrorUniforms();
  const mirror = createPlanarReflection(renderer as unknown as THREE.WebGLRenderer, LEVEL, uniforms);
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(2.65, 3.17));
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(1.18, LEVEL, -2.5);
  surface.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(68, 4 / 3, 0.05, 250);
  camera.position.set(1.18, 1.12, -2.7);
  camera.lookAt(1.18, 0.5, -3.5);
  return { renderer, uniforms, mirror, surface, camera, scene: new THREE.Scene() };
}

describe('planar reflection', () => {
  it('mirrors in the water plane', () => {
    const point = new THREE.Vector3(0.3, 1.4, -2).applyMatrix4(mirrorMatrix(LEVEL));
    expect(point.toArray().map((v) => +v.toFixed(6))).toEqual([0.3, 0.13, -2]);
  });

  it('moves the near plane onto the clip plane and keeps the far plane', () => {
    const camera = new THREE.PerspectiveCamera(60, 1.5, 0.05, 250);
    const plane = new THREE.Vector4(0, 0.6, -0.8, -2); // kept side: 0.6y − 0.8z > 2
    const projection = obliqueClip(camera.projectionMatrix.clone(), plane);
    const depth = (p: THREE.Vector3) => {
      const clip = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(projection);
      return clip.z / clip.w;
    };
    // On the plane (0.6y − 0.8z = 2) the depth is −1, the near end.
    expect(depth(new THREE.Vector3(0.4, 0.4, -2.2))).toBeCloseTo(-1, 6);
    // Inside the kept side, in front of the camera: within the depth range.
    expect(Math.abs(depth(new THREE.Vector3(0, 2, -5)))).toBeLessThan(1);
    // On the other side: clipped.
    expect(depth(new THREE.Vector3(0, -1, -3))).toBeLessThan(-1);
    // x, y and w rows are unchanged.
    const e = projection.elements;
    const o = camera.projectionMatrix.elements;
    for (const i of [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15]) expect(e[i]).toBe(o[i]);
  });

  it('renders the scene from the mirrored camera and maps points to where it drew them', () => {
    const { renderer, uniforms, mirror, surface, camera, scene } = setup();
    mirror.setScale(0.5);
    const stats = mirror.render(scene, camera, surface);
    expect(stats).toEqual({ calls: 41, triangles: 1234, rendered: true });
    expect(renderer.render).toHaveBeenCalledOnce();
    const [, mirrored] = renderer.render.mock.calls[0] as [THREE.Scene, THREE.PerspectiveCamera];
    expect(mirrored.matrixWorld.determinant()).toBeCloseTo(1, 6);
    const position = new THREE.Vector3().setFromMatrixPosition(mirrored.matrixWorld);
    expect(position.toArray().map((v) => +v.toFixed(6))).toEqual([1.18, +(2 * LEVEL - 1.12).toFixed(6), -2.7]);
    // The surface is hidden while the mirror is drawn and the target is restored.
    expect(surface.visible).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    const target = renderer.setRenderTarget.mock.calls[0][0] as THREE.WebGLRenderTarget;
    expect([target.width, target.height]).toEqual([400, 300]);
    expect(uniforms.suiMirror.value).toBe(target.texture);
    expect(uniforms.suiMirrorAmount.value).toBe(1);
    expect(mirror.size).toBe('400x300');

    // The camera sees `above` reflected at the surface point where the line to its mirror image
    // crosses the water; the texture holds `above` at that point's coordinates.
    const above = new THREE.Vector3(0.4, 1.0, -4.2);
    const image = above.clone().applyMatrix4(mirrorMatrix(LEVEL));
    const t = (camera.position.y - LEVEL) / (camera.position.y - image.y);
    const surfacePoint = camera.position.clone().lerp(image, t);
    const texture = (p: THREE.Vector3) => p.clone().applyMatrix4(uniforms.suiMirrorMatrix.value);
    expect(texture(above).x).toBeCloseTo(texture(surfacePoint).x, 6);
    expect(texture(above).y).toBeCloseTo(texture(surfacePoint).y, 6);
    // The image covers only the corner of the target that holds the surface and its margin.
    const limit = uniforms.suiMirrorLimit.value;
    expect([target.viewport.z / 400, target.viewport.w / 300]).toEqual([
      expect.closeTo(limit.x + 0.5 / 400, 9),
      expect.closeTo(limit.y + 0.5 / 300, 9),
    ]);
    expect(limit.x * limit.y).toBeLessThan(1);
    // Points of the surface in view.
    for (const corner of [
      [0.5, 0.765, -4],
      [1.8, 0.765, -3.8],
      [1.18, 0.765, -3],
    ]) {
      const uv = texture(new THREE.Vector3(...corner));
      expect(uv.x).toBeGreaterThan(0);
      expect(uv.y).toBeGreaterThan(0);
      expect(uv.x).toBeLessThan(limit.x);
      expect(uv.y).toBeLessThan(limit.y);
    }
    // A point under the water is clipped by the oblique near plane.
    const clip = (p: THREE.Vector3) => {
      const v = new THREE.Vector4(p.x, p.y, p.z, 1)
        .applyMatrix4(mirrored.matrixWorldInverse)
        .applyMatrix4(mirrored.projectionMatrix);
      return v.z / v.w;
    };
    expect(clip(new THREE.Vector3(1.18, 0.5, -3.5))).toBeLessThan(-1);
    expect(Math.abs(clip(above))).toBeLessThan(1);

    // An unchanged view and state keep the image; a changed state draws it again.
    expect(mirror.render(scene, camera, surface, [0.5]).rendered).toBe(true);
    expect(mirror.render(scene, camera, surface, [0.5])).toEqual({ calls: 41, triangles: 1234, rendered: false });
    expect(uniforms.suiMirrorAmount.value).toBe(1);
    expect(mirror.render(scene, camera, surface, [0.6]).rendered).toBe(true);
    camera.rotation.y += 0.01;
    expect(mirror.render(scene, camera, surface, [0.6]).rendered).toBe(true);
    expect(renderer.render).toHaveBeenCalledTimes(4);

    // Turning the mirror off frees the target and the water falls back to the probes.
    const released = vi.fn();
    target.addEventListener('dispose', released);
    mirror.setScale(0);
    expect(released).toHaveBeenCalledOnce();
    expect(uniforms.suiMirrorAmount.value).toBe(0);
  });

  it('skips the pass when turned off, out of view, or with the camera at or below the water', () => {
    const { renderer, uniforms, mirror, surface, camera, scene } = setup();
    expect(mirror.render(scene, camera, surface).calls).toBe(0);
    mirror.setScale(1);
    camera.lookAt(1.18, 10, -2.6);
    expect(mirror.render(scene, camera, surface).calls).toBe(0);
    camera.position.y = LEVEL;
    camera.lookAt(1.18, 0, -3.5);
    expect(mirror.render(scene, camera, surface).calls).toBe(0);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(uniforms.suiMirrorAmount.value).toBe(0);
    mirror.dispose();
    expect(uniforms.suiMirror.value).toBeNull();
  });

  it('bounds the surface on screen, clipped behind the camera and grown by a margin', () => {
    const square = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ].map(([x, y]) => new THREE.Vector4(x * 2, y * 2, 0, 2));
    expect(screenBounds(square)).toEqual(
      [-0.5, -0.5, 0.5, 0.5].map((v) => expect.closeTo(v + Math.sign(v) * MIRROR_MARGIN, 9)),
    );
    // Corners behind the camera (w < 0) are cut at w = ε: the rectangle reaches the view's edge.
    square[2].set(1, 1, 0, -1);
    square[3].set(-1, 1, 0, -1);
    const cut = screenBounds(square)!;
    expect(cut[3]).toBe(1);
    expect(cut[1]).toBeCloseTo(-0.5 - MIRROR_MARGIN, 9);
    // Entirely behind, or off to one side: nothing.
    expect(screenBounds(square.map((p) => new THREE.Vector4(p.x, p.y, 0, -1)))).toBeNull();
    expect(screenBounds(square.map((p, i) => new THREE.Vector4(3 + (i % 2), p.y, 0, 1)))).toBeNull();
  });
});
