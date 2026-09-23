import { describe, expect, it, vi } from 'vitest';
import { createSpatialAudio, type SpatialPose } from './spatialAudio';

const param = () => ({ value: 0, setTargetAtTime: vi.fn() });
const node = () => ({
  connect: vi.fn(function (target) {
    return target;
  }),
  gain: param(),
});
const pose: SpatialPose = {
  position: [1, 2, 3],
  forward: [0, 0, -1],
  up: [0, 1, 0],
  stove: [-2, 1, 0],
  water: [3, 1, 2],
};
function setup() {
  const listener = Object.fromEntries(
    ['position', 'forward', 'up'].flatMap((prefix) => ['X', 'Y', 'Z'].map((axis) => [prefix + axis, param()])),
  );
  const ctx = {
    currentTime: 4,
    listener,
    createGain: vi.fn(node),
    createPanner: vi.fn(() => ({ ...node(), positionX: param(), positionY: param(), positionZ: param() })),
  };
  const master = node();
  const spatial = createSpatialAudio(ctx as unknown as AudioContext, master as unknown as GainNode)!;
  return { ctx, master, spatial };
}

describe('spatial sound routing', () => {
  it('keeps the original dry level until a 3D pose arrives and bypasses unsupported listeners', () => {
    const { ctx, master } = setup();
    const gains = ctx.createGain.mock.results.map((result) => result.value);
    expect(gains[1].gain.value).toBe(1);
    expect(gains[2].gain.value).toBe(0);
    expect(gains[1].connect).toHaveBeenCalledWith(master);
    expect(gains[2].connect).toHaveBeenCalledWith(master);
    expect(createSpatialAudio({} as AudioContext, master as unknown as GainNode)).toBeNull();
  });
  it('tracks both source positions and the camera orientation without creating more nodes', () => {
    const { ctx, spatial } = setup();
    spatial.update(pose);
    expect(ctx.listener.positionY.value).toBe(2);
    expect(ctx.listener.forwardZ.value).toBe(-1);
    expect(ctx.createPanner.mock.results[0].value.positionX.value).toBe(-2);
    expect(ctx.createPanner.mock.results[1].value.positionZ.value).toBe(2);
    spatial.update({ ...pose, forward: [1, 0, 0], up: [0, 0, 1] });
    expect(ctx.listener.forwardX.value).toBe(1);
    expect(ctx.listener.upZ.value).toBe(1);
    expect(ctx.createPanner).toHaveBeenCalledTimes(2);
    expect(ctx.createGain).toHaveBeenCalledTimes(6);
  });
  it('crossfades back to the original level on 2D/failure and tolerates repeated toggles', () => {
    const { ctx, spatial } = setup();
    const gains = ctx.createGain.mock.results.map((result) => result.value);
    spatial.update(pose);
    spatial.update(pose);
    for (const index of [1, 4]) {
      expect(gains[index].gain.setTargetAtTime).toHaveBeenCalledExactlyOnceWith(0, 4, 0.08);
      expect(gains[index + 1].gain.setTargetAtTime).toHaveBeenCalledExactlyOnceWith(1, 4, 0.08);
    }
    spatial.update(null);
    for (const index of [1, 4]) {
      expect(gains[index].gain.setTargetAtTime).toHaveBeenLastCalledWith(1, 4, 0.08);
      expect(gains[index + 1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0, 4, 0.08);
    }
    for (let i = 0; i < 20; i++) {
      spatial.update(pose);
      spatial.update(null);
    }
    expect(ctx.createPanner).toHaveBeenCalledTimes(2);
    expect(ctx.createGain).toHaveBeenCalledTimes(6);
  });
});
