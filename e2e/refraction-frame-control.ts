export interface RefractionClock {
  now: number;
  count: number;
  held: boolean;
  hold(): Promise<void>;
  step(delta: number, count?: number): Promise<void>;
}

/** Hold actual renderer callbacks while screenshots are taken. Each explicit
 * step delivers exactly one shared timestamp to pending callbacks. */
export function installRefractionClock() {
  const native = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const pending = new Map<number, FrameRequestCallback>();
  const clock: RefractionClock = {
    now: 100000,
    count: 0,
    held: false,
    async hold() {
      clock.held = true;
      await new Promise<void>((resolve) => native(() => native(() => resolve())));
    },
    async step(delta, count = 1) {
      clock.now += delta;
      for (let i = 0; i < count; i++)
        await new Promise<void>((resolve) =>
          native(() => {
            const callbacks = [...pending.values()];
            pending.clear();
            for (const callback of callbacks) callback(clock.now);
            clock.count++;
            native(() => resolve());
          }),
        );
    },
  };
  window.requestAnimationFrame = (callback) => {
    const id = native((time) => {
      if (clock.held) pending.set(id, callback);
      else callback(time);
    });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
    cancel(id);
  };
  (window as unknown as { refractionClock: RefractionClock }).refractionClock = clock;
}
