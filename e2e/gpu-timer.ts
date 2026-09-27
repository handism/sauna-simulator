// GPU time of every animation frame callback (all passes of a frame), from
// EXT_disjoint_timer_query_webgl2 around each callback. Installed before the app loads.
export function timeFrames() {
  type Timed = Window & {
    suiGl?: WebGL2RenderingContext;
    suiTimer?: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    suiMeasure?: boolean;
    suiGpuMs: number[];
  };
  const w = window as unknown as Timed;
  w.suiGpuMs = [];
  let draws = 0;
  // DOM animations also schedule rAF callbacks. Their empty GPU queries must
  // not lower the measured quantiles, particularly when WebGL is inexpensive.
  const prototype = WebGL2RenderingContext.prototype;
  for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
    const original = prototype[name];
    Object.defineProperty(prototype, name, {
      configurable: true,
      writable: true,
      value(this: WebGL2RenderingContext, ...args: number[]) {
        if (this === w.suiGl) draws++;
        return Reflect.apply(original, this, args);
      },
    });
  }
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
    const context = getContext.call(this, type, options) as RenderingContext | null;
    if (type === 'webgl2' && context && !w.suiGl) {
      w.suiGl = context as WebGL2RenderingContext;
      w.suiTimer = w.suiGl.getExtension('EXT_disjoint_timer_query_webgl2');
    }
    return context;
  } as typeof getContext;
  const pending: WebGLQuery[] = [];
  const frame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) =>
    frame((time) => {
      const gl = w.suiGl;
      const timer = w.suiTimer;
      const query = gl && timer && w.suiMeasure ? gl.createQuery() : null;
      if (query) gl!.beginQuery(timer!.TIME_ELAPSED_EXT, query);
      const before = draws;
      callback(time);
      if (query) {
        gl!.endQuery(timer!.TIME_ELAPSED_EXT);
        if (draws > before) pending.push(query);
        else gl!.deleteQuery(query);
      }
      while (gl && timer && pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const done = pending.shift()!;
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
          w.suiGpuMs.push(gl.getQueryParameter(done, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(done);
      }
    });
}
