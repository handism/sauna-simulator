import { useState, useEffect, useRef } from 'react';
import { beatSeconds } from '../utils/saunaUtils';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { useSecondTicker } from '../hooks/useSecondTicker';
import HeartRateRow from './HeartRateRow';
import type { WaterResult } from '../hooks/useSaunaSession';

interface Ripple {
  id: number;
  left: string;
  top: string;
}

export interface CoolingBathProps {
  initialHeartRate: number;
  onNext: (result: WaterResult) => void;
}

const COOLING_CONFIG = {
  WATER_TEMP: 16,
  TARGET_HR: 60,
  HR_DECAY_FACTOR: 0.16,
  MIN_HR: 56,
  RIPPLE_INTERVAL_MS: 1500,
};

const CoolingBath = ({ initialHeartRate, onNext }: CoolingBathProps) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [heartRate, setHeartRate] = useState<number>(initialHeartRate);

  const rootRef = useRef<HTMLDivElement>(null);
  const rippleIdRef = useRef<number>(0);

  // 波紋（リップル）の定期生成
  useEffect(() => {
    const int = setInterval(() => {
      const newRipple: Ripple = {
        id: rippleIdRef.current++,
        left: Math.random() * 80 + 10 + '%',
        top: Math.random() * 80 + 10 + '%',
      };
      setRipples((prev) => [...prev.slice(-4), newRipple]); // 最大5つの波紋
    }, COOLING_CONFIG.RIPPLE_INTERVAL_MS);
    return () => clearInterval(int);
  }, []);

  // 心拍数低下シミュレーション (1秒ごと。滞在時間も数える)
  const secondsRef = useSecondTicker(() => {
    setHeartRate((prev) => {
      // 目標心拍数 TARGET_HR bpm に向けてイージングで急低下
      const diff = (COOLING_CONFIG.TARGET_HR - prev) * COOLING_CONFIG.HR_DECAY_FACTOR;
      const nextHR = prev + diff;
      // わずかにランダムなゆらぎを加えて自然にする
      const jitter = (Math.random() - 0.5) * 0.5;
      return Math.max(nextHR + jitter, COOLING_CONFIG.MIN_HR);
    });
  });

  const handleLeave = () => {
    onNext({ heartRate: Math.round(heartRate), waterTime: secondsRef.current });
  };

  useKeyboardShortcut(' ', handleLeave, { scope: rootRef });

  return (
    <div ref={rootRef} className="scene-container">
      {/* 冷気インセットグローオーバーレイ。心拍と同期して脈動 */}
      <div
        className="cooling-glow"
        style={{
          animation: `glow-pulse ${beatSeconds(heartRate)}s infinite ease-in-out`,
        }}
      />

      <div className="glass-panel cooling-panel">
        <h2 className="cooling-title">水風呂</h2>

        <div className="cooling-desc">ゆっくりと粗熱を取る...</div>

        {/* シミュレーター情報ダッシュボード */}
        <div className="cooling-info-panel">
          <div className="stage-info-row">
            <span className="stage-info-label">水温:</span>
            <span className="dashboard-value cooling-info-val-temp">{COOLING_CONFIG.WATER_TEMP.toFixed(1)}°C</span>
          </div>

          <HeartRateRow heartRate={heartRate} icon="💙" />
        </div>
      </div>

      {/* 外気浴へ遷移 */}
      <div className="cooling-next-btn-container">
        <button className="primary-btn cooling-next-btn" onClick={handleLeave} aria-keyshortcuts="Space">
          外気浴へ 🍃
        </button>
      </div>

      {/* 水面の波紋エフェクト */}
      {ripples.map((r) => (
        <div key={r.id} className="cooling-ripple-effect" style={{ top: r.top, left: r.left }} />
      ))}
    </div>
  );
};

export default CoolingBath;
