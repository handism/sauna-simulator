import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { type AmbientEnv, useAudioEngine } from './useAudioEngine';
import { RESTING_HEART_RATE } from '../utils/saunaUtils';

export type { AmbientEnv };
/** 入室前の 'start' と、環境音・3D視点を持つ3ステージ（AmbientEnv） */
export type Stage = 'start' | AmbientEnv;

interface SessionResults {
  heartRate: number;
  saunaTime: number;
  loylyCount: number;
  waterTime: number;
}

/** サウナ室を出たときの記録（SaunaRoom の onNext） */
export type SaunaResult = Pick<SessionResults, 'heartRate' | 'saunaTime' | 'loylyCount'>;
/** 水風呂を出たときの記録（CoolingBath の onNext） */
export type WaterResult = Pick<SessionResults, 'heartRate' | 'waterTime'>;

const INITIAL_RESULTS: SessionResults = {
  heartRate: RESTING_HEART_RATE,
  saunaTime: 0,
  loylyCount: 0,
  waterTime: 0,
};

export function useSaunaSession() {
  const [stage, setStage] = useState<Stage>('start');
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const opacity = pendingStage === null ? 1 : 0;
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isUiHidden, setIsUiHidden] = useState<boolean>(false);
  // Wall-clock time (Date.now) of entering; the automatic 3D lighting follows the real time since.
  const [enteredAt, setEnteredAt] = useState<number | null>(null);
  const [results, setResults] = useState<SessionResults>(INITIAL_RESULTS);

  const audio = useAudioEngine();
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // One owner for the fade-out deadline. UI, scenery and audio commit together.
  const changeStage = useCallback(
    (nextStage: Stage): boolean => {
      if (transitionTimeoutRef.current !== null || nextStage === stage) return false;
      setPendingStage(nextStage);
      transitionTimeoutRef.current = setTimeout(() => {
        transitionTimeoutRef.current = null;
        if (nextStage !== 'start') audio.playAmbient(nextStage);
        setStage(nextStage);
        setPendingStage(null);
      }, 1000);
      return true;
    },
    [audio, stage],
  );

  const handleStart = useCallback(
    (withSound: boolean) => {
      if (!changeStage('sauna')) return;
      setEnteredAt(Date.now());
      audio.init();
      setIsMuted(!withSound);
      audio.setMuted(!withSound);
      setResults(INITIAL_RESULTS);
    },
    [audio, changeStage],
  );

  // 遷移が受け付けられたときだけ結果を記録する（遷移中の二重操作で上書きしない）
  const completeSauna = useCallback(
    (result: SaunaResult) => {
      if (!changeStage('water')) return;
      setResults((prev) => ({ ...prev, ...result }));
    },
    [changeStage],
  );

  const completeWater = useCallback(
    (result: WaterResult) => {
      if (!changeStage('totonou')) return;
      setResults((prev) => ({ ...prev, ...result }));
    },
    [changeStage],
  );

  const completeTotonou = useCallback(() => {
    changeStage('sauna');
  }, [changeStage]);

  // 音量の変更は state の updater（純粋であるべき）の外で行う
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    audio.setMuted(next);
  }, [audio, isMuted]);

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
      enteredAt,
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
      enteredAt,
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
