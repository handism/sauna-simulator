import StageDock from './StageDock';
import { useState, useEffect, useRef } from 'react';
import { beatSeconds, STAY_TARGET_SECONDS } from '../utils/saunaUtils';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { useSecondTicker } from '../hooks/useSecondTicker';
import HeartRateRow from './HeartRateRow';
import StayTimer from './StayTimer';
import { ActionIcon } from './ActionIcon';
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
  const seconds = useSecondTicker(() => {
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
    onNext({ heartRate: Math.round(heartRate), waterTime: seconds });
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

      <header className="stage-heading">
        <p className="stage-step">02 / 03 · 水風呂</p>
        <h2 className="cooling-title" tabIndex={-1}>
          水風呂
        </h2>
        <p>水の音に耳を澄ませて。</p>
      </header>
      <StageDock className="cooling-panel">
        <StayTimer seconds={seconds} targetSeconds={STAY_TARGET_SECONDS.WATER} />
        <details className="stage-details">
          <summary>からだの様子を見る</summary>
          <div className="cooling-info-panel">
            <div className="stage-info-row">
              <span className="reading-label">水温</span>
              <span className="dashboard-value">{COOLING_CONFIG.WATER_TEMP.toFixed(1)}°C</span>
            </div>
            <HeartRateRow heartRate={heartRate} />
          </div>
          <p className="detail-note">数値は体験内のシミュレーションです。</p>
        </details>
        <button className="primary-btn cooling-next-btn" onClick={handleLeave} aria-keyshortcuts="Space">
          外気浴へ <ActionIcon name="arrow" />{' '}
          <kbd className="button-shortcut" aria-hidden="true">
            Space
          </kbd>
        </button>
      </StageDock>

      {/* 水面の波紋エフェクト */}
      {ripples.map((r) => (
        <div key={r.id} className="cooling-ripple-effect" style={{ top: r.top, left: r.left }} />
      ))}
    </div>
  );
};

export default CoolingBath;
