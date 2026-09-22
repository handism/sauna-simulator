import { useState, useCallback, useEffect, useRef } from "react";
import { AmbientEnv, useAudioEngine } from "./useAudioEngine";

export type Stage = "start" | AmbientEnv;

export function useSaunaSession() {
  const [stage, setStage] = useState<Stage>("start");
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const opacity = pendingStage === null ? 1 : 0;
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isUiHidden, setIsUiHidden] = useState<boolean>(false);

  const [heartRate, setHeartRate] = useState<number>(75);
  const [saunaTime, setSaunaTime] = useState<number>(0);
  const [loylyCount, setLoylyCount] = useState<number>(0);
  const [waterTime, setWaterTime] = useState<number>(0);

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

      setHeartRate(75);
      setSaunaTime(0);
      setLoylyCount(0);
      setWaterTime(0);
    },
    [audio, changeStage],
  );

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

  return {
    stage,
    pendingStage,
    opacity,
    isMuted,
    isUiHidden,
    heartRate,
    setHeartRate,
    saunaTime,
    setSaunaTime,
    loylyCount,
    setLoylyCount,
    waterTime,
    setWaterTime,
    audio,
    changeStage,
    handleStart,
    toggleMute,
    toggleUiVisibility,
  };
}
