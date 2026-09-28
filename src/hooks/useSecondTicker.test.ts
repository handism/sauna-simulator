import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSecondTicker } from './useSecondTicker';

describe('useSecondTicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts elapsed seconds and calls the latest callback without restarting the interval', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ onTick }) => useSecondTicker(onTick), {
      initialProps: { onTick: first },
    });

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    rerender({ onTick: second });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // The re-render must not reset the phase: the second tick lands at 2000ms
    expect(result.current.current).toBe(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops ticking after unmount', () => {
    const onTick = vi.fn();
    const { result, unmount } = renderHook(() => useSecondTicker(onTick));

    unmount();
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(onTick).not.toHaveBeenCalled();
    expect(result.current.current).toBe(0);
  });
});
