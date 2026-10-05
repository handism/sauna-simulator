// GPU time of every animation frame callback (all passes of a frame), from
// EXT_disjoint_timer_query_webgl2 around each callback, and the times of the callbacks that draw
// (suiFrameAt). Installed before the app loads. On ANGLE Metal a frame that misses the display
// interval times about 1.8x the interval between frames (the query also spans waiting on earlier
// frames), and a frame within it only shows the interval: `repeat` > 1 runs each callback that
// draws that many times (same time, so nothing advances, and no further frames scheduled) to make
// the GPU the limit, and the interval between frames / repeat is the cost of one frame.
// `suiAfterDraw`, when set, runs after every callback that draws (each repeat too), e.g. to move
// the view so that view-dependent passes are not kept between the repeated frames.
export function timeFrames(repeat = 1) {
  type Timed = Window & {
    suiGl?: WebGL2RenderingContext;
    suiTimer?: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    suiMeasure?: boolean;
    suiGpuMs: number[];
    suiFrameAt: number[];
    suiAfterDraw?: () => void;
  };
  const w = window as unknown as Timed;
  w.suiGpuMs = [];
  w.suiFrameAt = [];
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
  const wrapped = (callback: FrameRequestCallback) =>
    frame((time) => {
      const gl = w.suiGl;
      const timer = w.suiTimer;
      const query = gl && timer && w.suiMeasure ? gl.createQuery() : null;
      if (query) gl!.beginQuery(timer!.TIME_ELAPSED_EXT, query);
      const before = draws;
      callback(time);
      if (draws > before) w.suiAfterDraw?.();
      if (draws > before && repeat > 1) {
        window.requestAnimationFrame = () => 0;
        for (let i = 1; i < repeat; i++) {
          callback(time);
          w.suiAfterDraw?.();
        }
        window.requestAnimationFrame = wrapped;
      }
      if (w.suiMeasure && draws > before) w.suiFrameAt.push(time);
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
  window.requestAnimationFrame = wrapped;
}
