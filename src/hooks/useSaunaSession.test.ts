import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSaunaSession } from './useSaunaSession';
import { useAudioEngine } from './useAudioEngine';

// Mock useAudioEngine
vi.mock('./useAudioEngine', () => ({
  useAudioEngine: vi.fn(),
}));

describe('useSaunaSession', () => {
  const mockAudioEngine = {
    init: vi.fn(),
    playAmbient: vi.fn(),
    playLoyly: vi.fn(),
    setMuted: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAudioEngine as any).mockReturnValue(mockAudioEngine);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should have correct initial state', () => {
    const { result } = renderHook(() => useSaunaSession());

    expect(result.current.stage).toBe('start');
    expect(result.current.opacity).toBe(1);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isUiHidden).toBe(false);
    expect(result.current.heartRate).toBe(75);
    expect(result.current.saunaTime).toBe(0);
    expect(result.current.loylyCount).toBe(0);
    expect(result.current.waterTime).toBe(0);
  });

  it('should change stage with delay', () => {
    const { result } = renderHook(() => useSaunaSession());

    act(() => {
      result.current.changeStage('sauna');
    });

    // Immediately after calling changeStage, opacity should be 0, but stage is still 'start'
    expect(result.current.opacity).toBe(0);
    expect(result.current.stage).toBe('start');

    // Fast-forward 1000ms
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // After delay, stage should be updated and opacity should be 1
    expect(result.current.stage).toBe('sauna');
    expect(result.current.opacity).toBe(1);
  });

  it('should handle start with sound', () => {
    const { result } = renderHook(() => useSaunaSession());

    act(() => {
      // Modify state to test reset
      result.current.setHeartRate(120);
      result.current.setSaunaTime(100);
      result.current.setLoylyCount(2);
      result.current.setWaterTime(50);
    });

    act(() => {
      result.current.handleStart(true);
    });

    // Audio engine interactions
    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');
    expect(result.current.isMuted).toBe(false);

    // State resets
    expect(result.current.heartRate).toBe(75);
    expect(result.current.saunaTime).toBe(0);
    expect(result.current.loylyCount).toBe(0);
    expect(result.current.waterTime).toBe(0);

    // Stage change delay
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('sauna');
  });

  it('should handle start without sound', () => {
    const { result } = renderHook(() => useSaunaSession());

    act(() => {
      result.current.handleStart(false);
    });

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(true);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');
    expect(result.current.isMuted).toBe(true);
  });

  it('should toggle mute', () => {
    const { result } = renderHook(() => useSaunaSession());

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

  it('should toggle UI visibility', () => {
    const { result } = renderHook(() => useSaunaSession());

    expect(result.current.isUiHidden).toBe(false);

    act(() => {
      result.current.toggleUiVisibility();
    });

    expect(result.current.isUiHidden).toBe(true);

    act(() => {
      result.current.toggleUiVisibility();
    });

    expect(result.current.isUiHidden).toBe(false);
  });
});
