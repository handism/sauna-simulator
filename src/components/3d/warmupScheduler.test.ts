import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWarmupSteps } from './warmupScheduler';

function fixture(budgetMs = 50) {
  const controller = new AbortController();
  const restore = vi.fn();
  const isCurrent = vi.fn(() => true);
  const options = { signal: controller.signal, deadline: 1000, isCurrent, restore, budgetMs };
  return { controller, restore, isCurrent, options };
}

beforeEach(() =>
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'],
  }),
);
afterEach(() => vi.useRealTimers());

describe('warmup scheduler', () => {
  it('runs cached steps together and restores once without scheduling waits', async () => {
    const { options, restore } = fixture();
    const step = vi.fn(() => true);
    await runWarmupSteps([step, step], options);
    expect(step).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('yields for a frame plus 20ms after the budget, then resumes', async () => {
    const { options, restore } = fixture();
    const next = vi.fn(() => false);
    const running = runWarmupSteps(
      [
        () => {
          vi.advanceTimersByTime(51);
          return true;
        },
        next,
      ],
      options,
    );
    await vi.advanceTimersByTimeAsync(16);
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    await running;
    expect(next).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 16])('cancels pending frame/timer waits at %ims and settles without later steps', async (delay) => {
    const { options, controller, restore } = fixture(0);
    const next = vi.fn(() => true);
    const running = runWarmupSteps([() => true, next], options);
    const result = expect(running).rejects.toMatchObject({ reason: 'aborted' });
    await vi.advanceTimersByTimeAsync(delay);
    controller.abort();
    await result;
    expect(next).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('expires while rAF is suspended', async () => {
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(999);
    const { options, restore } = fixture(0);
    try {
      const result = expect(runWarmupSteps([() => true], options)).rejects.toMatchObject({ reason: 'deadline' });
      await vi.advanceTimersByTimeAsync(1000);
      await result;
      expect(restore).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      frame.mockRestore();
    }
  });

  it('rejects superseded generations after an async boundary', async () => {
    const { options, isCurrent, restore } = fixture(0);
    const next = vi.fn(() => true);
    const result = expect(runWarmupSteps([() => true, next], options)).rejects.toMatchObject({ reason: 'superseded' });
    isCurrent.mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(16);
    await result;
    expect(next).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects an overlong synchronous final step before reporting completion', async () => {
    const { options, restore } = fixture();
    await expect(
      runWarmupSteps(
        [
          () => {
            vi.advanceTimersByTime(1001);
            return true;
          },
        ],
        options,
      ),
    ).rejects.toMatchObject({ reason: 'deadline' });
    expect(restore).toHaveBeenCalledOnce();
  });

  it('restores after exceptions and refuses an already cancelled run', async () => {
    const { options, controller, restore } = fixture();
    const step = vi.fn(() => {
      throw new Error('draw failed');
    });
    await expect(runWarmupSteps([step], options)).rejects.toThrow('draw failed');
    controller.abort();
    await expect(runWarmupSteps([step], options)).rejects.toMatchObject({ reason: 'aborted' });
    expect(step).toHaveBeenCalledOnce();
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
