export class WarmupInterrupted extends Error {
  constructor(public readonly reason: 'aborted' | 'deadline' | 'superseded') {
    super(`Warmup interrupted: ${reason}`);
    this.name = 'WarmupInterrupted';
  }
}

export interface WarmupSchedule {
  signal: AbortSignal;
  /** Absolute performance.now() deadline, retained across configuration restarts. */
  deadline: number;
  isCurrent: () => boolean;
  /** Restore CPU state even on failure; the owner must restore before disposing GL resources. */
  restore: () => void;
  budgetMs?: number;
}

/** A step draws internally and synchronously drains that draw; false means no draw.
 * The owner serializes runs, observes actual drawn materials, and owns GL state/visibility.
 * This scheduler neither publishes ready nor assumes that executing a step prepared a group.
 */
export async function runWarmupSteps(steps: Iterable<() => boolean>, options: WarmupSchedule) {
  const { signal, deadline, isCurrent, restore, budgetMs = 50 } = options;
  const check = () => {
    if (signal.aborted) throw new WarmupInterrupted('aborted');
    if (performance.now() >= deadline) throw new WarmupInterrupted('deadline');
    if (!isCurrent()) throw new WarmupInterrupted('superseded');
  };
  const yieldToBrowser = () =>
    new Promise<void>((resolve, reject) => {
      let frame: number | undefined;
      let pause: ReturnType<typeof setTimeout> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: unknown) => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        if (pause !== undefined) clearTimeout(pause);
        if (expiry !== undefined) clearTimeout(expiry);
        signal.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new WarmupInterrupted('aborted'));
      signal.addEventListener('abort', abort, { once: true });
      try {
        check();
        // Also expires when rAF is suspended in a background tab.
        expiry = setTimeout(() => finish(new WarmupInterrupted('deadline')), Math.max(0, deadline - performance.now()));
        frame = requestAnimationFrame(() => {
          frame = undefined;
          try {
            check();
            pause = setTimeout(() => {
              try {
                check();
                finish();
              } catch (error) {
                finish(error);
              }
            }, 20);
          } catch (error) {
            finish(error);
          }
        });
      } catch (error) {
        finish(error);
      }
    });
  try {
    if (!Number.isFinite(deadline) || !Number.isFinite(budgetMs) || budgetMs < 0)
      throw new Error('Invalid warmup schedule');
    check();
    let slice = performance.now();
    for (const step of steps) {
      check();
      const drawn = step();
      check();
      // A synchronous GL call cannot be interrupted or bounded by this budget.
      if (drawn && performance.now() - slice >= budgetMs) {
        await yieldToBrowser();
        check();
        slice = performance.now();
      }
    }
    check();
  } finally {
    restore();
  }
}
