// Opt-in diagnostics only. Keep the normal resource soak free of instrumentation.
export function observeSoakTiming() {
  const state = () => {
    const element = document.querySelector<HTMLElement>('.sauna-3d-canvas');
    return element ? { ...element.dataset } : null;
  };
  const events: unknown[] = [];
  const record = (event: Record<string, unknown>) => {
    if (events.length < 2000) events.push({ ...event, state: state() });
  };
  Object.assign(window, { suiSoakTiming: events });
  let draws = 0;
  const gl = WebGL2RenderingContext.prototype;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
    const original = gl[name];
    Object.defineProperty(gl, name, {
      configurable: true,
      writable: true,
      value(this: WebGL2RenderingContext, ...args: number[]) {
        draws++;
        return Reflect.apply(original, this, args);
      },
    });
  }
  let driver: Record<string, { calls: number; ms: number }> = {};
  // Flag synchronous driver waits without collecting a full browser trace.
  for (const name of [
    'getProgramParameter',
    'getShaderParameter',
    'getUniformLocation',
    'getAttribLocation',
    'getActiveUniform',
    'getActiveAttrib',
    'getShaderInfoLog',
    'getProgramInfoLog',
    'finish',
    'readPixels',
    'compileShader',
    'linkProgram',
  ] as const) {
    const original = gl[name];
    Object.defineProperty(gl, name, {
      configurable: true,
      writable: true,
      value(this: WebGL2RenderingContext, ...args: unknown[]) {
        const start = performance.now();
        const result = Reflect.apply(original, this, args);
        const duration = performance.now() - start;
        const total = (driver[name] ??= { calls: 0, ms: 0 });
        total.calls++;
        total.ms += duration;
        if (duration > 20) record({ kind: name, start, duration });
        return result;
      },
    });
  }
  let previous: { time: number; start: number; duration: number; state: ReturnType<typeof state> } | null = null;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      const start = performance.now();
      const before = draws;
      driver = {};
      callback(time);
      if (draws === before) return;
      const duration = performance.now() - start;
      const gap = previous ? time - previous.time : 0;
      if (gap > 100 || duration > 100)
        record({ kind: 'frame', time, start, duration, gap, previous, driver, hidden: document.hidden });
      previous = { time, start, duration, state: state() };
    });
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        record({ kind: 'longtask', start: entry.startTime, duration: entry.duration, name: entry.name });
    }).observe({ type: 'longtask', buffered: true });
  }
}
