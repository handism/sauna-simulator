import { useState, useCallback, useEffect, useRef } from "react";
import { AmbientEnv, useAudioEngine } from "./useAudioEngine";

export type Stage = "start" | AmbientEnv;

export function useSaunaSession() {
  const [stage, setStage] = useState<Stage>("start");
  const [opacity, setOpacity] = useState<number>(1);
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

  const changeStage = useCallback((nextStage: Stage) => {
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    setOpacity(0);
    transitionTimeoutRef.current = setTimeout(() => {
      transitionTimeoutRef.current = null;
      setStage(nextStage);
      setOpacity(1);
    }, 1000);
  }, []);

  const handleStart = useCallback(
    (withSound: boolean) => {
      audio.init();
      setIsMuted(!withSound);
      audio.setMuted(!withSound);
      audio.playAmbient("sauna");

      setHeartRate(75);
      setSaunaTime(0);
      setLoylyCount(0);
      setWaterTime(0);

      changeStage("sauna");
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
