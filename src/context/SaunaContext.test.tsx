import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SaunaProvider, useSaunaContext } from './SaunaContext';
import * as useAudioEngineModule from '../hooks/useAudioEngine';
import React from 'react';

vi.mock('../hooks/useAudioEngine', () => ({
  useAudioEngine: vi.fn(),
}));

describe('SaunaContext', () => {
  const mockAudioEngine = {
    init: vi.fn(),
    playAmbient: vi.fn(),
    playLoyly: vi.fn(),
    setMuted: vi.fn(),
  };

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SaunaProvider>{children}</SaunaProvider>
  );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAudioEngineModule.useAudioEngine).mockReturnValue(mockAudioEngine as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when used outside of SaunaProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSaunaContext())).toThrow(
      'useSaunaContext must be used within a SaunaProvider'
    );
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

  it('handleStart initializes audio and transitions stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.handleStart(true);
    });

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(false);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');
    expect(result.current.isMuted).toBe(false);

    expect(result.current.opacity).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('sauna');
    expect(result.current.opacity).toBe(1);
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
      result.current.completeSauna(120, 600, 3);
    });

    expect(result.current.heartRate).toBe(120);
    expect(result.current.saunaTime).toBe(600);
    expect(result.current.loylyCount).toBe(3);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('water');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('water');
  });

  it('completeWater transitions to totonou stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeWater(90, 120);
    });

    expect(result.current.heartRate).toBe(90);
    expect(result.current.waterTime).toBe(120);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('totonou');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('totonou');
  });

  it('completeTotonou transitions to sauna stage', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeTotonou();
    });

    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith('sauna');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('sauna');
  });

  it('changeStage handles custom stage transitions', () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.changeStage('water');
    });

    expect(result.current.opacity).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe('water');
    expect(result.current.opacity).toBe(1);
  });
});
