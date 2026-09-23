import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { AmbientEnv, useAudioEngine } from "./useAudioEngine";

export type Stage = "start" | AmbientEnv;

interface SessionResults {
  heartRate: number;
  saunaTime: number;
  loylyCount: number;
  waterTime: number;
}

const INITIAL_RESULTS: SessionResults = {
  heartRate: 75,
  saunaTime: 0,
  loylyCount: 0,
  waterTime: 0,
};

export function useSaunaSession() {
  const [stage, setStage] = useState<Stage>("start");
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const opacity = pendingStage === null ? 1 : 0;
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isUiHidden, setIsUiHidden] = useState<boolean>(false);
  const [results, setResults] = useState<SessionResults>(INITIAL_RESULTS);

  const audio = useAudioEngine();
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // One owner for the fade-out deadline. UI, scenery and audio commit together.
  const changeStage = useCallback((nextStage: Stage): boolean => {
    if (transitionTimeoutRef.current !== null || nextStage === stage) return false;
    setPendingStage(nextStage);
    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null;
      if (nextStage !== "start") audio.playAmbient(nextStage);
      setStage(nextStage);
      setPendingStage(null);
    }, 1000);
    return true;
  }, [audio, stage]);

  const handleStart = useCallback(
    (withSound: boolean) => {
      if (!changeStage("sauna")) return;
      audio.init();
      setIsMuted(!withSound);
      audio.setMuted(!withSound);
      setResults(INITIAL_RESULTS);
    },
    [audio, changeStage],
  );

  // 遷移が受け付けられたときだけ結果を記録する（遷移中の二重操作で上書きしない）
  const completeSauna = useCallback(
    (heartRate: number, saunaTime: number, loylyCount: number) => {
      if (!changeStage("water")) return;
      setResults((prev) => ({ ...prev, heartRate, saunaTime, loylyCount }));
    },
    [changeStage],
  );

  const completeWater = useCallback(
    (heartRate: number, waterTime: number) => {
      if (!changeStage("totonou")) return;
      setResults((prev) => ({ ...prev, heartRate, waterTime }));
    },
    [changeStage],
  );

  const completeTotonou = useCallback(() => {
    changeStage("sauna");
  }, [changeStage]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audio.setMuted(next);
      return next;
    });
  }, [audio]);

  const toggleUiVisibility = useCallback(() => {
    setIsUiHidden((prev) => !prev);
  }, []);

  return useMemo(
    () => ({
      stage,
      pendingStage,
      opacity,
      isMuted,
      isUiHidden,
      ...results,
      audio,
      handleStart,
      toggleMute,
      toggleUiVisibility,
      completeSauna,
      completeWater,
      completeTotonou,
    }),
    [
      stage,
      pendingStage,
      opacity,
      isMuted,
      isUiHidden,
      results,
      audio,
      handleStart,
      toggleMute,
      toggleUiVisibility,
      completeSauna,
      completeWater,
      completeTotonou,
    ],
  );
}

export type SaunaSession = ReturnType<typeof useSaunaSession>;
