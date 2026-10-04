import FirstVisitGuide from './FirstVisitGuide';
import StageDock from './StageDock';
import { useState, useEffect, useRef } from 'react';
import { AudioEngine } from '../hooks/useAudioEngine';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { useSecondTicker } from '../hooks/useSecondTicker';
import type { SaunaResult } from '../hooks/useSaunaSession';
import { calculateHeatIndex, RESTING_HEART_RATE, STAY_TARGET_SECONDS } from '../utils/saunaUtils';
import HeartRateRow from './HeartRateRow';
import StayTimer from './StayTimer';
import { ActionIcon } from './ActionIcon';

interface Steam {
  id: number;
  left: string;
}

/** 直近のロウリュで上がった温度・湿度。メーター横に一瞬だけ表示する */
interface LoylyDelta {
  id: number;
  temperature: number;
  humidity: number;
}

export interface SaunaRoomProps {
  audio: AudioEngine;
  onLoyly?: () => void;
  onNext: (result: SaunaResult) => void;
}

const SAUNA_CONFIG = {
  INITIAL_TEMP: 90,
  INITIAL_HUMIDITY: 15,
  MAX_TEMP: 110,
  MAX_HUMIDITY: 90,
  LOYLY_TEMP_INC: 3,
  LOYLY_HUMIDITY_INC: 25,
  TEMP_DECAY: 0.05,
  HUMIDITY_DECAY: 0.4,
  MIN_TEMP: 85,
  MIN_HUMIDITY: 12,
  HEAT_INDEX_BASE: 70,
  HR_INCREASE_MULTIPLIER: 0.006,
  HR_BASE_INCREASE: 0.02,
  MAX_HEART_RATE: 155,
  STEAM_PARTICLE_DURATION_MS: 4000,
};

const SaunaRoom = ({ audio, onNext, onLoyly }: SaunaRoomProps) => {
  const [saunaState, setSaunaState] = useState<{
    temperature: number;
    humidity: number;
    heartRate: number;
  }>({
    temperature: SAUNA_CONFIG.INITIAL_TEMP,
    humidity: SAUNA_CONFIG.INITIAL_HUMIDITY,
    heartRate: RESTING_HEART_RATE,
  });
  const [steams, setSteams] = useState<Steam[]>([]);
  // ロウリュごとに増やし、曇り演出の要素を作り直してアニメーションを最初から再生する
  const [steamBurst, setSteamBurst] = useState<number>(0);
  const [loylyDelta, setLoylyDelta] = useState<LoylyDelta | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const loylyCountRef = useRef<number>(0);
  const steamIdRef = useRef<number>(0);
  // 蒸気パーティクルは連打で複数同時に存在するため、個別に削除タイマーを持つ
  const steamParticleTimeoutsRef = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const particleTimeouts = steamParticleTimeoutsRef.current;
    return () => {
      particleTimeouts.forEach(clearTimeout);
      particleTimeouts.clear();
    };
  }, []);

  const { temperature, humidity, heartRate } = saunaState;

  // ロウリュ実行
  const handleLoyly = () => {
    audio.playLoyly();
    onLoyly?.();
    // 上限で頭打ちになった分は表示しない（直前の表示値からの差分）
    setLoylyDelta({
      id: steamBurst,
      temperature: Math.min(temperature + SAUNA_CONFIG.LOYLY_TEMP_INC, SAUNA_CONFIG.MAX_TEMP) - temperature,
      humidity:
        Math.round(Math.min(humidity + SAUNA_CONFIG.LOYLY_HUMIDITY_INC, SAUNA_CONFIG.MAX_HUMIDITY)) -
        Math.round(humidity),
    });
    setSaunaState((prev) => ({
      ...prev,
      temperature: Math.min(prev.temperature + SAUNA_CONFIG.LOYLY_TEMP_INC, SAUNA_CONFIG.MAX_TEMP),
      humidity: Math.min(prev.humidity + SAUNA_CONFIG.LOYLY_HUMIDITY_INC, SAUNA_CONFIG.MAX_HUMIDITY),
    }));
    loylyCountRef.current += 1;

    // スチーム曇り演出トリガー（終了後は index.css の forwards で透明のまま残る）
    setSteamBurst((prev) => prev + 1);

    // サウナストーンからの蒸気パーティクル
    const newSteam: Steam = {
      id: steamIdRef.current++,
      left: Math.random() * 60 + 20 + '%',
    };
    setSteams((prev) => [...prev, newSteam]);
    const particleTimeouts = steamParticleTimeoutsRef.current;
    const particleTimeout = setTimeout(() => {
      particleTimeouts.delete(particleTimeout);
      setSteams((prev) => prev.filter((s) => s.id !== newSteam.id));
    }, SAUNA_CONFIG.STEAM_PARTICLE_DURATION_MS);
    particleTimeouts.add(particleTimeout);
  };

  useKeyboardShortcut(' ', handleLoyly, { scope: rootRef });

  // メインシミュレーションループ (1秒ごと。滞在時間も数える)
  const seconds = useSecondTicker(() => {
    setSaunaState((prev) => {
      // 自然減衰 (温度と湿度は徐々に下がる)
      const nextTemp = Math.max(prev.temperature - SAUNA_CONFIG.TEMP_DECAY, SAUNA_CONFIG.MIN_TEMP);
      const nextHum = Math.max(prev.humidity - SAUNA_CONFIG.HUMIDITY_DECAY, SAUNA_CONFIG.MIN_HUMIDITY);

      // 体感温度の算出 (簡易Heat Index)
      // 湿度が上がると体感温度が急激に上がる
      const heatIndex = calculateHeatIndex(nextTemp, nextHum);

      // 体感温度に応じて心拍数が徐々に上昇
      const hrIncrease = (heatIndex - SAUNA_CONFIG.HEAT_INDEX_BASE) * SAUNA_CONFIG.HR_INCREASE_MULTIPLIER;
      const nextHeartRate = Math.min(
        prev.heartRate + Math.max(hrIncrease, SAUNA_CONFIG.HR_BASE_INCREASE),
        SAUNA_CONFIG.MAX_HEART_RATE,
      );

      return {
        temperature: nextTemp,
        humidity: nextHum,
        heartRate: nextHeartRate,
      };
    });
  });

  // 体感温度のリアルタイム計算
  const heatIndex = calculateHeatIndex(temperature, humidity);

  const handleLeave = () => {
    onNext({ heartRate: Math.round(heartRate), saunaTime: seconds, loylyCount: loylyCountRef.current });
  };

  return (
    <div ref={rootRef} className="scene-container">
      {/* スチームオーバーレイ曇り演出 */}
      <div key={steamBurst} className={`steam-overlay ${steamBurst > 0 ? 'active' : ''}`} />

      <header className="stage-heading">
        <p className="stage-step">01 / 03 · サウナ</p>
        <h2 className="sauna-room-title" tabIndex={-1}>
          サウナルーム
        </h2>
        <p>湯気と木の香りを、ゆっくりと。</p>
      </header>
      <StageDock className="sauna-room-panel">
        <FirstVisitGuide />
        {/* メインデジタルメーター */}
        <div className="sauna-meters-grid">
          <div className="sauna-meter-box">
            <span className="reading-label">温度</span>
            <div className="dashboard-value sauna-meter-value">
              {loylyDelta && loylyDelta.temperature > 0 && (
                <span key={loylyDelta.id} className="meter-delta" aria-hidden="true">
                  +{loylyDelta.temperature.toFixed(1)}
                </span>
              )}
              {temperature.toFixed(1)}°C
            </div>
          </div>
          <div className="sauna-meter-box">
            <span className="reading-label">湿度</span>
            <div className="dashboard-value sauna-meter-value">
              {loylyDelta && loylyDelta.humidity > 0 && (
                <span key={loylyDelta.id} className="meter-delta" aria-hidden="true">
                  +{loylyDelta.humidity}
                </span>
              )}
              {Math.round(humidity)}%
            </div>
          </div>
        </div>
        <StayTimer seconds={seconds} targetSeconds={STAY_TARGET_SECONDS.SAUNA} />

        {/* 体感温度 & 心拍数情報 */}
        <details className="stage-details">
          <summary>からだの様子を見る</summary>
          <div className="sauna-info-panel">
            <div className="stage-info-row">
              <span className="reading-label">体感温度</span>
              <span className="dashboard-value">{heatIndex.toFixed(1)}°C</span>
            </div>

            <HeartRateRow heartRate={heartRate} />
          </div>

          <p className="detail-note">数値は体験内のシミュレーションです。</p>
        </details>
        <div className="dock-actions sauna-action-btn-container">
          <button className="primary-btn sauna-loyly-btn" onClick={handleLoyly} aria-keyshortcuts="Space">
            <ActionIcon name="steam" /> ロウリュ{' '}
            <kbd className="button-shortcut" aria-hidden="true">
              Space
            </kbd>
          </button>
          <button className="primary-btn sauna-next-stage-btn" onClick={handleLeave}>
            水風呂へ <ActionIcon name="arrow" />
          </button>
        </div>
      </StageDock>

      {/* サウナストーンからの上昇蒸気パーティクル */}
      {steams.map((steam) => (
        <div key={steam.id} className="sauna-steam-particle" style={{ left: steam.left }} />
      ))}
    </div>
  );
};

export default SaunaRoom;
