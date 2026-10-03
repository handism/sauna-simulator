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
  const outside: { name: string; start: number; duration: number; program?: string }[] = [];
  Object.assign(window, { suiSoakTiming: events, suiSoakOutside: outside });
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
  // three's SHADER_NAME define (the material's name or type) of each program, for the slow calls.
  const shaderNames = new WeakMap<WebGLShader, string>();
  const programNames = new WeakMap<WebGLProgram, string[]>();
  let programCount = 0;
  const shaderSource = gl.shaderSource;
  gl.shaderSource = function (this: WebGL2RenderingContext, shader: WebGLShader, source: string) {
    const name = /#define SHADER_NAME (.*)/.exec(source)?.[1];
    if (name) shaderNames.set(shader, name);
    return shaderSource.call(this, shader, source);
  };
  const attachShader = gl.attachShader;
  gl.attachShader = function (this: WebGL2RenderingContext, program: WebGLProgram, shader: WebGLShader) {
    const name = shaderNames.get(shader) ?? '?';
    if (!programNames.has(program))
      programNames.set(program, [`${name}#${++programCount}@${Math.round(performance.now())}`]);
    return attachShader.call(this, program, shader);
  };
  const programName = (value: unknown) => (value instanceof WebGLProgram ? programNames.get(value)?.[0] : undefined);
  let inFrame = false;
  // Programs whose log three read (their first use) in the current frame.
  let firstUsed: string[] = [];
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
        if (name === 'getProgramInfoLog' && inFrame)
          firstUsed.push(programNames.get(args[0] as WebGLProgram)?.[0] ?? '?');
        // Outside the render loop (the scene's first draw on load), each call of a millisecond or more.
        if (!inFrame && duration >= 1 && outside.length < 4000)
          outside.push({ name, start, duration, program: programName(args[0]) });
        if (duration > 20)
          record({
            kind: name,
            start,
            duration,
            inFrame,
            program: args[0] instanceof WebGLProgram ? programNames.get(args[0])?.[0] : undefined,
          });
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
      firstUsed = [];
      inFrame = true;
      try {
        callback(time);
      } finally {
        inFrame = false;
      }
      if (draws === before) return;
      const duration = performance.now() - start;
      const gap = previous ? time - previous.time : 0;
      if (gap > 100 || duration > 100)
        record({ kind: 'frame', time, start, duration, gap, previous, driver, firstUsed, hidden: document.hidden });
      previous = { time, start, duration, state: state() };
    });
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        record({ kind: 'longtask', start: entry.startTime, duration: entry.duration, name: entry.name });
    }).observe({ type: 'longtask', buffered: true });
  }
}
