import { useState, useEffect, useRef } from 'react';
import { getSecureRandom } from '../utils/saunaUtils';

interface CoolingBathProps {
  initialHeartRate: number;
  onNext: (heartRate: number, duration: number) => void;
}

interface Ripple {
  id: number;
  left: string;
  top: string;
}

const COOLING_CONFIG = {
  TARGET_HR: 60,
  HR_DECAY_FACTOR: 0.16,
  MIN_HR: 56,
  RIPPLE_INTERVAL_MS: 1500
};

const CoolingBath = ({ initialHeartRate, onNext }: CoolingBathProps) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [heartRate, setHeartRate] = useState<number>(initialHeartRate);
  
  const secondsRef = useRef<number>(0);

  // 波紋（リップル）の定期生成
  useEffect(() => {
    const int = setInterval(() => {
      const newRipple: Ripple = {
        id: Date.now(),
        left: getSecureRandom() * 80 + 10 + '%',
        top: getSecureRandom() * 80 + 10 + '%',
      };
      setRipples(prev => [...prev.slice(-4), newRipple]); // 最大5つの波紋
    }, COOLING_CONFIG.RIPPLE_INTERVAL_MS);
    return () => clearInterval(int);
  }, []);

  // 心拍数低下シミュレーション (1秒ごと)
  useEffect(() => {
    const interval = setInterval(() => {
      secondsRef.current += 1;
      
      setHeartRate(prev => {
        // 目標心拍数 TARGET_HR bpm に向けてイージングで急低下
        const diff = (COOLING_CONFIG.TARGET_HR - prev) * COOLING_CONFIG.HR_DECAY_FACTOR;
        const nextHR = prev + diff;
        // わずかにランダムなゆらぎを加えて自然にする
        const jitter = (getSecureRandom() - 0.5) * 0.5;
        return Math.max(nextHR + jitter, COOLING_CONFIG.MIN_HR);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const handleLeave = () => {
    onNext(Math.round(heartRate), secondsRef.current);
  };

  // 心拍に同期するアニメーション速度
  const pulseSpeed = 60 / heartRate;

  return (
    <div className="scene-container">
      {/* 冷気インセットグローオーバーレイ。心拍と同期して脈動 */}
      <div 
        className="cooling-glow" 
        style={{ 
          animation: `glow-pulse ${pulseSpeed}s infinite ease-in-out` 
        }} 
      />
      
      <div className="glass-panel cooling-panel">
        <h2 className="cooling-title">水風呂</h2>
        
        <div className="cooling-desc">
          ゆっくりと粗熱を取る...
        </div>

        {/* シミュレーター情報ダッシュボード */}
        <div className="cooling-info-panel">
          <div className="cooling-info-row">
            <span className="cooling-info-label">水温:</span>
            <span className="dashboard-value cooling-info-val-temp">16.0°C</span>
          </div>

          <div className="cooling-info-row-bottom">
            <span className="cooling-info-label">心拍数:</span>
            <span className="cooling-info-val-hr">
              <span 
                className="cooling-heart-icon"
                style={{ animation: `breathe ${pulseSpeed}s infinite ease-in-out` }}
              >
                💙
              </span>
              <span className="dashboard-value cooling-hr-bpm-val">
                {Math.round(heartRate)} <span className="cooling-hr-bpm-label">BPM</span>
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 外気浴へ遷移 */}
      <div className="cooling-next-btn-container">
         <button className="primary-btn cooling-next-btn" onClick={handleLeave}>
            外気浴へ 🍃
         </button>
      </div>

      {/* 水面の波紋エフェクト */}
      {ripples.map(r => (
        <div 
          key={r.id}
          className="cooling-ripple-effect"
          style={{ top: r.top, left: r.left }}
        />
      ))}
    </div>
  );
}

export default CoolingBath;
