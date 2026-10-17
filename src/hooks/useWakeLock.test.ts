import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock';

const flush = () => act(async () => {});

describe('useWakeLock', () => {
  let request: ReturnType<typeof vi.fn>;
  let sentinels: { released: boolean; release: ReturnType<typeof vi.fn> }[];
  let visibility: DocumentVisibilityState;

  beforeEach(() => {
    sentinels = [];
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    request = vi.fn(() => {
      const sentinel = {
        released: false,
        release: vi.fn(async () => {
          sentinel.released = true;
        }),
      };
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    });
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('holds the lock only while enabled', async () => {
    const { rerender } = renderHook(({ enabled }) => useWakeLock(enabled), { initialProps: { enabled: false } });
    await flush();
    expect(request).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ enabled: false });
    expect(sentinels[0].release).toHaveBeenCalled();
  });

  it('reacquires when the page becomes visible again after the browser released it', async () => {
    renderHook(() => useWakeLock(true));
    await flush();
    sentinels[0].released = true;
    visibility = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(request).toHaveBeenCalledTimes(1);
    visibility = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases a lock granted after it was disabled', async () => {
    let grant: (value: unknown) => void = () => {};
    const release = vi.fn(async () => {});
    request.mockImplementationOnce(() => new Promise((resolve) => (grant = resolve)));
    const { unmount } = renderHook(() => useWakeLock(true));
    unmount();
    grant({ released: false, release });
    await flush();
    expect(release).toHaveBeenCalled();
  });

  it('ignores a refused request and missing support', async () => {
    request.mockRejectedValueOnce(new Error('NotAllowedError'));
    renderHook(() => useWakeLock(true));
    await flush();
    delete (navigator as { wakeLock?: unknown }).wakeLock;
    expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  });
});
