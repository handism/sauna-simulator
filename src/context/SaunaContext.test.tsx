import React from 'react';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { SaunaProvider, useSaunaContext } from './SaunaContext';
import * as useAudioEngineModule from '../hooks/useAudioEngine';

vi.mock('../hooks/useAudioEngine', () => ({
  useAudioEngine: vi.fn(),
}));

const mockAudioEngine = {
  init: vi.fn(),
  playAmbient: vi.fn(),
  stopAmbient: vi.fn(),
  playLoyly: vi.fn(),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  setSpatialPose: vi.fn(),
};

const wrapper = ({ children }: { children: React.ReactNode }) => <SaunaProvider>{children}</SaunaProvider>;

describe('SaunaContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAudioEngineModule.useAudioEngine).mockReturnValue(
      mockAudioEngine as ReturnType<typeof useAudioEngineModule.useAudioEngine>,
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when used outside of SaunaProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSaunaContext())).toThrow('useSaunaContext must be used within a SaunaProvider');
    consoleError.mockRestore();
  });

  it('provides default values', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    expect(result.current.stage).toBe('start');
    expect(result.current.opacity).toBe(1);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isUiHidden).toBe(false);
    expect(result.current.heartRate).toBe(75);
    expect(result.current.saunaTime).toBe(0);
    expect(result.current.loylyCount).toBe(0);
    expect(result.current.waterTime).toBe(0);
  });

  it('handleStart initializes audio with sound and transitions stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.handleStart(true);
    });

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
    expect(result.current.isMuted).toBe(false);
    expect(result.current.opacity).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('sauna');
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');
    expect(result.current.opacity).toBe(1);
  });

  it('handles start without sound and keeps audio muted', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.handleStart(false);
    });

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(true);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
    expect(result.current.isMuted).toBe(true);
  });

  it('toggleMute toggles mute state', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    expect(result.current.isMuted).toBe(true);

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(false);
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);

    act(() => {
      result.current.toggleMute();
    });

    expect(result.current.isMuted).toBe(true);
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(true);
  });

  it('toggleUiVisibility toggles UI visibility', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    expect(result.current.isUiHidden).toBe(false);

    act(() => {
      result.current.toggleUiVisibility();
    });

    expect(result.current.isUiHidden).toBe(true);
  });

  it('completeSauna transitions to water stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeSauna({ heartRate: 120, saunaTime: 600, loylyCount: 3 });
    });

    expect(result.current.heartRate).toBe(120);
    expect(result.current.saunaTime).toBe(600);
    expect(result.current.loylyCount).toBe(3);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('water');
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('water');
  });

  it('completeWater transitions to totonou stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeWater({ heartRate: 90, waterTime: 120 });
    });

    expect(result.current.heartRate).toBe(90);
    expect(result.current.waterTime).toBe(120);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('totonou');
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('totonou');
  });

  it('completeTotonou transitions to sauna stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeTotonou();
    });

    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('sauna');
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');
  });
  it('records the entry time once, when entering is accepted', () => {
    vi.setSystemTime(50_000);
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    expect(result.current.enteredAt).toBeNull();
    const advance = (action: () => void) => {
      act(action);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    };
    advance(() => result.current.handleStart(false));
    expect(result.current.enteredAt).toBe(50_000);
    // Later rounds keep it: the automatic lighting follows the real time since entering.
    advance(() => result.current.completeSauna({ heartRate: 120, saunaTime: 600, loylyCount: 3 }));
    advance(() => result.current.completeWater({ heartRate: 80, waterTime: 60 }));
    advance(() => result.current.completeTotonou());
    expect(result.current.stage).toBe('sauna');
    expect(result.current.enteredAt).toBe(50_000);
  });
  it('uses one deadline and ignores duplicate transitions and result overwrites', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    act(() => {
      result.current.handleStart(false);
    });
    expect(result.current.pendingStage).toBe('sauna');
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current.stage).toBe('start');
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.pendingStage).toBeNull();
    expect(result.current.stage).toBe('sauna');
    mockAudioEngine.playAmbient.mockClear();
    act(() => {
      result.current.completeSauna({ heartRate: 120, saunaTime: 600, loylyCount: 3 });
      result.current.completeSauna({ heartRate: 150, saunaTime: 999, loylyCount: 9 });
      result.current.completeWater({ heartRate: 80, waterTime: 60 });
    });
    expect(result.current.pendingStage).toBe('water');
    expect(result.current.saunaTime).toBe(600);
    expect(result.current.loylyCount).toBe(3);
    expect(result.current.waterTime).toBe(0);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.stage).toBe('water');
    expect(result.current.opacity).toBe(1);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledTimes(1);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('water');
  });

  it('records each set score when leaving the cold bath', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    const advance = (action: () => void) => {
      act(action);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    };
    expect(result.current.scoreHistory).toEqual([]);
    advance(() => result.current.handleStart(false));
    advance(() => result.current.completeSauna({ heartRate: 120, saunaTime: 50, loylyCount: 2 }));
    advance(() => result.current.completeWater({ heartRate: 80, waterTime: 20 }));
    expect(result.current.scoreHistory).toEqual([100]);
    advance(() => result.current.completeTotonou());
    advance(() => result.current.completeSauna({ heartRate: 110, saunaTime: 10, loylyCount: 0 }));
    advance(() => result.current.completeWater({ heartRate: 80, waterTime: 20 }));
    expect(result.current.scoreHistory).toEqual([100, 50]);
  });

  it('does not record a score for a rejected cold-bath exit', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    act(() => {
      result.current.handleStart(false);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      result.current.completeSauna({ heartRate: 120, saunaTime: 50, loylyCount: 2 });
      result.current.completeWater({ heartRate: 80, waterTime: 20 });
    });
    expect(result.current.scoreHistory).toEqual([]);
  });

  it('cancels a pending transition on unmount', () => {
    const { result, unmount } = renderHook(() => useSaunaContext(), { wrapper });
    act(() => {
      result.current.handleStart(false);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
  });
});

describe('ending a session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    vi.mocked(useAudioEngineModule.useAudioEngine).mockReturnValue(mockAudioEngine);
  });
  afterEach(() => vi.useRealTimers());

  it.each(['sauna', 'water'])('ends from %s without scoring an unfinished set', (stage) => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    act(() => result.current.handleStart(false));
    act(() => vi.advanceTimersByTime(1000));
    if (stage === 'water') {
      act(() => result.current.completeSauna({ heartRate: 100, saunaTime: 30, loylyCount: 1 }));
      act(() => vi.advanceTimersByTime(1000));
    }
    act(() => {
      result.current.finishSession();
      result.current.finishSession();
    });
    expect(mockAudioEngine.stopAmbient).toHaveBeenCalledTimes(1);
    expect(result.current.sessionSummary?.scores).toEqual([]);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.stage).toBe('start');
    expect(result.current.sessionSummary?.seconds).toBe(stage === 'water' ? 2 : 1);
  });

  it('fades audio once, freezes the full-session summary, and resets on a new visit', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    const advance = (action: () => void) => {
      act(action);
      act(() => vi.advanceTimersByTime(1000));
    };
    act(() => result.current.finishSession());
    expect(mockAudioEngine.stopAmbient).not.toHaveBeenCalled();
    advance(() => result.current.handleStart(true));
    for (let round = 0; round < 2; round++) {
      advance(() => result.current.completeSauna({ heartRate: 100, saunaTime: 50, loylyCount: 1 }));
      advance(() => result.current.completeWater({ heartRate: 65, waterTime: 20 }));
      if (round === 0) advance(() => result.current.completeTotonou());
    }
    act(() => vi.advanceTimersByTime(60_000));
    act(() => result.current.toggleUiVisibility());
    act(() => {
      result.current.finishSession();
      result.current.finishSession();
      result.current.completeTotonou();
    });
    expect(mockAudioEngine.stopAmbient).toHaveBeenCalledTimes(1);
    expect(result.current.pendingStage).toBe('start');
    expect(result.current.sessionSummary).toEqual({ scores: [95, 95], seconds: 66 });
    expect(result.current.isUiHidden).toBe(false);
    const calls = mockAudioEngine.playAmbient.mock.calls.length;
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.stage).toBe('start');
    expect(result.current.sessionSummary).toEqual({ scores: [95, 95], seconds: 66 });
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledTimes(calls);
    act(() => result.current.dismissSummary());
    expect(result.current.sessionSummary).toBeNull();
    advance(() => result.current.handleStart(false));
    expect(result.current.scoreHistory).toEqual([]);
    expect(result.current.saunaTime).toBe(0);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.enteredAt).toBe(196_000);
  });
});
