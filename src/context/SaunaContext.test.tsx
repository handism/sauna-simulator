import React from "react";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SaunaProvider, useSaunaContext } from "./SaunaContext";
import * as useAudioEngineModule from "../hooks/useAudioEngine";

vi.mock("../hooks/useAudioEngine", () => ({
  useAudioEngine: vi.fn(),
}));

const mockAudioEngine = {
  init: vi.fn(),
  playAmbient: vi.fn(),
  playLoyly: vi.fn(),
  setMuted: vi.fn(),
    setSpatialPose: vi.fn(),
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SaunaProvider>{children}</SaunaProvider>
);

describe("SaunaContext", () => {
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

  it("throws when used outside of SaunaProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    expect(() => renderHook(() => useSaunaContext())).toThrow(
      "useSaunaContext must be used within a SaunaProvider",
    );
    consoleError.mockRestore();
  });

  it("provides default values", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    expect(result.current.stage).toBe("start");
    expect(result.current.opacity).toBe(1);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isUiHidden).toBe(false);
    expect(result.current.heartRate).toBe(75);
    expect(result.current.saunaTime).toBe(0);
    expect(result.current.loylyCount).toBe(0);
    expect(result.current.waterTime).toBe(0);
  });

  it("handleStart initializes audio with sound and transitions stage", () => {
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

    expect(result.current.stage).toBe("sauna");
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("sauna");
    expect(result.current.opacity).toBe(1);
  });

  it("handles start without sound and keeps audio muted", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.handleStart(false);
    });

    expect(mockAudioEngine.init).toHaveBeenCalled();
    expect(mockAudioEngine.setMuted).toHaveBeenCalledWith(true);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
    expect(result.current.isMuted).toBe(true);
  });

  it("toggleMute toggles mute state", () => {
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

  it("toggleUiVisibility toggles UI visibility", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    expect(result.current.isUiHidden).toBe(false);

    act(() => {
      result.current.toggleUiVisibility();
    });

    expect(result.current.isUiHidden).toBe(true);
  });

  it("completeSauna transitions to water stage", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeSauna(120, 600, 3);
    });

    expect(result.current.heartRate).toBe(120);
    expect(result.current.saunaTime).toBe(600);
    expect(result.current.loylyCount).toBe(3);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe("water");
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("water");
  });

  it("completeWater transitions to totonou stage", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeWater(90, 120);
    });

    expect(result.current.heartRate).toBe(90);
    expect(result.current.waterTime).toBe(120);
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe("totonou");
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("totonou");
  });

  it("completeTotonou transitions to sauna stage", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.completeTotonou();
    });

    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe("sauna");
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("sauna");
  });
  it("uses one deadline and ignores duplicate transitions and result overwrites", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });
    act(() => { result.current.handleStart(false); });
    expect(result.current.pendingStage).toBe("sauna");
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current.stage).toBe("start");
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.pendingStage).toBeNull();
    expect(result.current.stage).toBe("sauna");
    mockAudioEngine.playAmbient.mockClear();
    act(() => {
      result.current.completeSauna(120, 600, 3);
      result.current.completeSauna(150, 999, 9);
      result.current.completeWater(80, 60);
    });
    expect(result.current.pendingStage).toBe("water");
    expect(result.current.saunaTime).toBe(600);
    expect(result.current.loylyCount).toBe(3);
    expect(result.current.waterTime).toBe(0);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.stage).toBe("water");
    expect(result.current.opacity).toBe(1);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledTimes(1);
    expect(mockAudioEngine.playAmbient).toHaveBeenCalledWith("water");
  });

  it("cancels a pending transition on unmount", () => {
    const { result, unmount } = renderHook(() => useSaunaContext(), { wrapper });
    act(() => { result.current.handleStart(false); });
    unmount();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(mockAudioEngine.playAmbient).not.toHaveBeenCalled();
  });

});
