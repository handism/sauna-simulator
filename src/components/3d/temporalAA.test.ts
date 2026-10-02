import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createTemporalAA, HISTORY_WEIGHT, JUMP_ANGLE, reprojectionMatrix, STILL_FRAMES } from './temporalAA';

function camera(yaw = 0, pitch = 0) {
  const result = new THREE.PerspectiveCamera(65, 1.5, 0.05, 250);
  result.rotation.order = 'YXZ';
  result.position.set(1, 1.2, -2);
  result.rotation.set(pitch, yaw, 0);
  result.updateMatrixWorld();
  return result;
}

function viewProjection(view: THREE.PerspectiveCamera) {
  return new THREE.Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
}

// A pixel's far point in this frame, carried to the previous frame's NDC.
function reproject(matrix: THREE.Matrix4, x: number, y: number) {
  const clip = new THREE.Vector4(x, y, 1, 1).applyMatrix4(matrix);
  return [clip.x / clip.w, clip.y / clip.w];
}

describe('reprojection', () => {
  it('is the identity while the camera holds still', () => {
    const view = camera(0.3, -0.2);
    const matrix = reprojectionMatrix(viewProjection(view), view);
    matrix.elements.forEach((value, i) => expect(value).toBeCloseTo(new THREE.Matrix4().elements[i], 6));
  });

  it('finds where a direction was before a turn, whatever its depth', () => {
    const before = camera(0.3, -0.2);
    const after = camera(0.3 - 0.004, -0.2);
    const matrix = reprojectionMatrix(viewProjection(before), after);
    for (const [x, y] of [
      [0, 0],
      [0.7, -0.4],
      [-0.9, 0.8],
    ]) {
      // A point at 3 m along this frame's ray of (x, y) projects to the same place before the turn.
      const point = new THREE.Vector3(x, y, 0.5).unproject(after).sub(after.position).setLength(3).add(after.position);
      const seen = point.clone().project(before);
      const [px, py] = reproject(matrix, x, y);
      expect(px).toBeCloseTo(seen.x, 5);
      expect(py).toBeCloseTo(seen.y, 5);
    }
    // Turning right (rotation.y down, as dragging right does): this frame's centre was right of centre.
    expect(reproject(matrix, 0, 0)[0]).toBeGreaterThan(0);
  });
});

function fakeRenderer() {
  const targets: (THREE.WebGLRenderTarget | null)[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    setRenderTarget: (next: THREE.WebGLRenderTarget | null) => (target = next),
    render: vi.fn(() => targets.push(target)),
  };
  const material = () => {
    const calls = renderer.render.mock.calls as unknown as [THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>][];
    return calls[calls.length - 1][0].material;
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, targets, material };
}

describe('temporal blend', () => {
  it('blends with the other history once one is drawn, in turn', () => {
    const { renderer, targets, material } = fakeRenderer();
    const temporal = createTemporalAA(renderer);
    const current = new THREE.Texture();
    const view = camera();
    const first = temporal.resolve(current, view, 640, 400);
    expect(material().uniforms.historyWeight.value).toBe(0);
    expect(material().uniforms.tCurrent.value).toBe(current);
    expect(material().uniforms.texel.value.toArray()).toEqual([1 / 640, 1 / 400]);
    const second = temporal.resolve(current, view, 640, 400);
    expect(material().uniforms.historyWeight.value).toBe(HISTORY_WEIGHT);
    expect(material().uniforms.tHistory.value).toBe(first);
    expect(second).not.toBe(first);
    expect(targets[1]?.texture).toBe(second);
    expect([targets[0]?.width, targets[0]?.height, targets[0]?.texture.type]).toEqual([640, 400, THREE.HalfFloatType]);
    expect(temporal.resolve(current, view, 640, 400)).toBe(first);
  });

  it('starts over on a jump, another view, another size or a reset, not on a look', () => {
    const { renderer, material } = fakeRenderer();
    const temporal = createTemporalAA(renderer);
    const current = new THREE.Texture();
    const weight = (view: THREE.PerspectiveCamera, width = 640) => {
      temporal.resolve(current, view, width, 400);
      return material().uniforms.historyWeight.value;
    };
    expect(weight(camera(0))).toBe(0);
    expect(weight(camera(JUMP_ANGLE * 0.9))).toBe(HISTORY_WEIGHT);
    expect(weight(camera(JUMP_ANGLE * 2.1))).toBe(0);
    expect(weight(camera(JUMP_ANGLE * 2.1))).toBe(HISTORY_WEIGHT);
    const moved = camera(JUMP_ANGLE * 2.1);
    moved.position.x += 1;
    moved.updateMatrixWorld();
    expect(weight(moved)).toBe(0);
    expect(weight(moved, 480)).toBe(0);
    expect(weight(moved, 480)).toBe(HISTORY_WEIGHT);
    temporal.reset();
    expect(weight(moved, 480)).toBe(0);
    temporal.release();
    expect(weight(moved, 480)).toBe(0);
  });

  it('skips the pass once a still view has converged, starting over on the next turn', () => {
    const { renderer, material } = fakeRenderer();
    const temporal = createTemporalAA(renderer);
    const current = new THREE.Texture();
    const draws = () => (renderer.render as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    temporal.resolve(current, camera(0), 640, 400);
    for (let frame = 0; frame < STILL_FRAMES; frame++)
      expect(temporal.resolve(current, camera(0), 640, 400)).not.toBe(current);
    expect(draws()).toBe(STILL_FRAMES + 1);
    for (let frame = 0; frame < 3; frame++) expect(temporal.resolve(current, camera(0), 640, 400)).toBe(current);
    expect(draws()).toBe(STILL_FRAMES + 1);
    temporal.resolve(current, camera(0.004), 640, 400);
    expect(draws()).toBe(STILL_FRAMES + 2);
    expect(material().uniforms.historyWeight.value).toBe(0);
    temporal.resolve(current, camera(0.004), 640, 400);
    expect(material().uniforms.historyWeight.value).toBe(HISTORY_WEIGHT);
  });

  it('keeps a still pixel and clamps the history to a box holding it', () => {
    const { renderer, material } = fakeRenderer();
    createTemporalAA(renderer).resolve(new THREE.Texture(), camera(), 640, 400);
    const shader = material().fragmentShader;
    expect(shader).toContain('texelFetch( tHistory');
    expect(shader).toContain('same ? linear : expand( fromYCoCg( blended ) )');
    expect(shader).toContain('clamp( history, min( mean - sigma, current ), max( mean + sigma, current ) )');
  });
});
