import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { type AmbientEnv, useAudioEngine } from './useAudioEngine';
import { calculateTotonouScore, RESTING_HEART_RATE } from '../utils/saunaUtils';

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
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isUiHidden, setIsUiHidden] = useState<boolean>(false);
  // Wall-clock time (Date.now) of entering; the automatic 3D lighting follows the real time since.
  const [enteredAt, setEnteredAt] = useState<number | null>(null);
  const [results, setResults] = useState<SessionResults>(INITIAL_RESULTS);
  // 水風呂を出た時点で確定する、セットごとのととのい度（入室ごとにリセット）
  const [scoreHistory, setScoreHistory] = useState<readonly number[]>([]);

  // 終了操作時に確定する、その日のセットごとのととのい度と入室からの実時間
  const [sessionSummary, setSessionSummary] = useState<{ scores: readonly number[]; seconds: number } | null>(null);
  const dismissSummary = useCallback(() => setSessionSummary(null), []);

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
      setSessionSummary(null);
      setIsUiHidden(false);
      setEnteredAt(Date.now());
      audio.init();
      setIsMuted(!withSound);
      audio.setMuted(!withSound);
      setResults(INITIAL_RESULTS);
      setScoreHistory([]);
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
      const { maxTotonou } = calculateTotonouScore(results.saunaTime, result.waterTime, results.loylyCount);
      setScoreHistory((prev) => [...prev, maxTotonou]);
    },
    [changeStage, results.saunaTime, results.loylyCount],
  );

  const completeTotonou = useCallback(() => {
    changeStage('sauna');
  }, [changeStage]);

  const finishSession = useCallback(() => {
    if (stage !== 'totonou' || !changeStage('start')) return;
    audio.stopAmbient();
    setSessionSummary({
      scores: scoreHistory,
      seconds: enteredAt === null ? 0 : Math.max(0, Math.floor((Date.now() - enteredAt) / 1000)),
    });
    setIsUiHidden(false);
  }, [stage, changeStage, audio, scoreHistory, enteredAt]);

  // 音量の変更は state の updater（純粋であるべき）の外で行う
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    setIsMuted(next);
    audio.setMuted(next);
  }, [audio, isMuted]);

  const setVolume = useCallback(
    (next: number) => {
      if (!Number.isFinite(next)) return;
      const clamped = Math.max(0, Math.min(1, next));
      setVolumeState(clamped);
      audio.setVolume(clamped);
    },
    [audio],
  );

  const toggleUiVisibility = useCallback(() => {
    setIsUiHidden((prev) => !prev);
  }, []);

  return useMemo(
    () => ({
      stage,
      pendingStage,
      opacity,
      volume,
      setVolume,
      isMuted,
      isUiHidden,
      enteredAt,
      ...results,
      scoreHistory,
      audio,
      handleStart,
      toggleMute,
      toggleUiVisibility,
      completeSauna,
      completeWater,
      completeTotonou,
      finishSession,
      sessionSummary,
      dismissSummary,
    }),
    [
      stage,
      pendingStage,
      opacity,
      volume,
      setVolume,
      isMuted,
      isUiHidden,
      enteredAt,
      results,
      scoreHistory,
      audio,
      handleStart,
      toggleMute,
      toggleUiVisibility,
      completeSauna,
      completeWater,
      completeTotonou,
      finishSession,
      sessionSummary,
      dismissSummary,
    ],
  );
}

export type SaunaSession = ReturnType<typeof useSaunaSession>;
