import React, { createContext, useContext, useCallback } from "react";
import { AudioEngine } from "../hooks/useAudioEngine";
import { useSaunaSession, type Stage } from "../hooks/useSaunaSession";

interface SaunaSessionContextType {
  stage: Stage;
  opacity: number;
  isMuted: boolean;
  isUiHidden: boolean;
  heartRate: number;
  setHeartRate: React.Dispatch<React.SetStateAction<number>>;
  saunaTime: number;
  setSaunaTime: React.Dispatch<React.SetStateAction<number>>;
  loylyCount: number;
  setLoylyCount: React.Dispatch<React.SetStateAction<number>>;
  waterTime: number;
  setWaterTime: React.Dispatch<React.SetStateAction<number>>;
  audio: AudioEngine;
  changeStage: (nextStage: Stage) => void;
  handleStart: (withSound: boolean) => void;
  toggleMute: () => void;
  toggleUiVisibility: () => void;
  completeSauna: (heartRate: number, duration: number, loylys: number) => void;
  completeWater: (heartRate: number, duration: number) => void;
  completeTotonou: () => void;
}

const SaunaContext = createContext<SaunaSessionContextType | undefined>(
  undefined,
);

export const useSaunaContext = () => {
  const context = useContext(SaunaContext);
  if (context === undefined) {
    throw new Error("useSaunaContext must be used within a SaunaProvider");
  }
  return context;
};

export function SaunaProvider({ children }: { children: React.ReactNode }) {
  const session = useSaunaSession();

  const completeSauna = useCallback(
    (finalHeartRate: number, duration: number, loylys: number) => {
      session.setHeartRate(finalHeartRate);
      session.setSaunaTime(duration);
      session.setLoylyCount(loylys);
      session.audio.playAmbient("water");
      session.changeStage("water");
    },
    [session],
  );

  const completeWater = useCallback(
    (finalHeartRate: number, duration: number) => {
      session.setHeartRate(finalHeartRate);
      session.setWaterTime(duration);
      session.audio.playAmbient("totonou");
      session.changeStage("totonou");
    },
    [session],
  );

  const completeTotonou = useCallback(() => {
    session.audio.playAmbient("sauna");
    session.changeStage("sauna");
  }, [session]);

  const value = {
    ...session,
    completeSauna,
    completeWater,
    completeTotonou,
  };

  return (
    <SaunaContext.Provider value={value}>{children}</SaunaContext.Provider>
  );
}
