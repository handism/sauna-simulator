/** Uses the scene's right-handed, Y-up coordinates without importing Three.js. */
export interface SpatialPose {
  position: readonly number[];
  forward: readonly number[];
  up: readonly number[];
  stove: readonly number[];
  water: readonly number[];
}

export function createSpatialAudio(ctx: AudioContext, master: GainNode) {
  // Older implementations keep the original signal path.
  if (!ctx.createPanner || !ctx.listener?.positionX) return null;
  const createBus = () => {
    const input = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    // Seated views retain their level; attenuation matters beyond the room.
    panner.refDistance = 5;
    panner.rolloffFactor = 0.5;
    dry.gain.value = 1;
    wet.gain.value = 0;
    input.connect(dry).connect(master);
    input.connect(panner).connect(wet).connect(master);
    return { input, dry, wet, panner };
  };
  const stove = createBus();
  const water = createBus();
  let enabled = false;
  const vector = (params: AudioParam[], values: readonly number[]) => {
    params.forEach((param, index) => {
      param.value = values[index];
    });
  };
  return {
    stove: stove.input,
    water: water.input,
    update(pose: SpatialPose | null) {
      if (pose) {
        const listener = ctx.listener;
        vector([listener.positionX, listener.positionY, listener.positionZ], pose.position);
        vector([listener.forwardX, listener.forwardY, listener.forwardZ], pose.forward);
        vector([listener.upX, listener.upY, listener.upZ], pose.up);
        for (const [bus, position] of [
          [stove, pose.stove],
          [water, pose.water],
        ] as const) {
          vector([bus.panner.positionX, bus.panner.positionY, bus.panner.positionZ], position);
        }
      }
      if (enabled === !!pose) return;
      enabled = !!pose;
      // Complementary gains, with identical time constants, also tolerate rapid toggles.
      for (const bus of [stove, water]) {
        bus.dry.gain.setTargetAtTime(enabled ? 0 : 1, ctx.currentTime, 0.08);
        bus.wet.gain.setTargetAtTime(enabled ? 1 : 0, ctx.currentTime, 0.08);
      }
    },
  };
}
