import React from "react";
import { renderHook, act } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SaunaProvider, useSaunaContext } from "./SaunaContext";

const mockAudio = {
  init: vi.fn(),
  playAmbient: vi.fn(),
  playLoyly: vi.fn(),
  setMuted: vi.fn(),
};

vi.mock("../hooks/useAudioEngine", () => ({
  useAudioEngine: () => mockAudio,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SaunaProvider>{children}</SaunaProvider>
);

describe("SaunaContext", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("cancels an earlier transition when a newer one starts", () => {
    const { result } = renderHook(() => useSaunaContext(), { wrapper });

    act(() => {
      result.current.changeStage("water");
    });

    act(() => {
      vi.advanceTimersByTime(500);
      result.current.changeStage("totonou");
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.stage).toBe("totonou");
    expect(result.current.stage).not.toBe("water");
  });
});
