import React, { createContext, useContext, useCallback, useState } from "react";
import {
  useAudioEngine,
  AudioEngine,
  AmbientEnv,
} from "../hooks/useAudioEngine";

export type Stage = "start" | AmbientEnv;

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

export function SaunaProvider({ children }: { children: React.ReactNode }) {
  const [stage, setStage] = useState<Stage>("start");
  const [opacity, setOpacity] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isUiHidden, setIsUiHidden] = useState<boolean>(false);

  // シミュレーション用パラメータの連携管理
  const [heartRate, setHeartRate] = useState<number>(75);
  const [saunaTime, setSaunaTime] = useState<number>(0);
  const [loylyCount, setLoylyCount] = useState<number>(0);
  const [waterTime, setWaterTime] = useState<number>(0);

  const audio = useAudioEngine();

  const changeStage = useCallback((nextStage: Stage) => {
    setOpacity(0);
    setTimeout(() => {
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

      // ステート初期化
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

  // Props として渡すための値の整理 (onNext などのコールバックはコンポーネント内で定義するか、context に含める)
  // 今後の拡張性を考えて、 setter も一部公開しておくか、あるいは component から直接 stage を変えられるようにする
  // 今回は既存の onNext を維持しつつ Context で管理することを目的とする

  const value = {
    stage,
    opacity,
    isMuted,
    isUiHidden,
    heartRate,
    saunaTime,
    loylyCount,
    waterTime,
    audio,
    changeStage,
    handleStart,
    toggleMute,
    toggleUiVisibility,
    completeSauna,
    completeWater,
    completeTotonou,
  };
  return context;
}
