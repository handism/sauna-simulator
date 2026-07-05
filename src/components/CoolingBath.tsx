import { useState, useEffect, useRef } from 'react';

interface CoolingBathProps {
  initialHeartRate: number;
  onNext: (heartRate: number, duration: number) => void;
}

interface Ripple {
  id: number;
  left: string;
  top: string;
}

const CoolingBath = ({ initialHeartRate, onNext }: CoolingBathProps) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [heartRate, setHeartRate] = useState<number>(initialHeartRate);
  
  const secondsRef = useRef<number>(0);

  // 波紋（リップル）の定期生成
  useEffect(() => {
    const int = setInterval(() => {
      const newRipple: Ripple = {
        id: Date.now(),
        left: Math.random() * 80 + 10 + '%',
        top: Math.random() * 80 + 10 + '%',
      };
      setRipples(prev => [...prev.slice(-4), newRipple]); // 最大5つの波紋
    }, 1500);
    return () => clearInterval(int);
  }, []);

  // 心拍数低下シミュレーション (1秒ごと)
  useEffect(() => {
    const interval = setInterval(() => {
      secondsRef.current += 1;
      
      setHeartRate(prev => {
        // 目標心拍数 60 bpm に向けてイージングで急低下
        const diff = (60 - prev) * 0.16;
        const nextHR = prev + diff;
        // わずかにランダムなゆらぎを加えて自然にする
        const jitter = (Math.random() - 0.5) * 0.5;
        return Math.max(nextHR + jitter, 56);
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
      
      <div className="glass-panel" style={{ textAlign: 'center', zIndex: 10, background: 'rgba(255,255,255,0.04)', width: '92%', maxWidth: '420px', padding: '2.5rem 2rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 300, color: '#bae6fd', letterSpacing: '4px', marginBottom: '1.5rem' }}>水風呂</h2>
        
        <div style={{ fontSize: '1.1rem', fontWeight: 300, margin: '15px 0', color: '#e0f2fe', lineHeight: 1.6 }}>
          ゆっくりと粗熱を取る...
        </div>

        {/* シミュレーター情報ダッシュボード */}
        <div style={{ background: 'rgba(56,189,248,0.05)', padding: '15px', borderRadius: '16px', margin: '20px 0 25px 0', display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid rgba(56,189,248,0.1)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem' }}>
            <span style={{ color: '#bae6fd' }}>水温:</span>
            <span className="dashboard-value" style={{ color: '#38bdf8', fontWeight: 600 }}>16.0°C</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
            <span style={{ color: '#bae6fd' }}>心拍数:</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span 
                style={{ 
                  color: '#38bdf8', 
                  display: 'inline-block',
                  animation: `breathe ${pulseSpeed}s infinite ease-in-out`
                }}
              >
                💙
              </span>
              <span className="dashboard-value" style={{ fontWeight: 600, color: '#e0f2fe' }}>
                {Math.round(heartRate)} <span style={{ fontSize: '0.75rem', fontWeight: 300 }}>BPM</span>
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* 外気浴へ遷移 */}
      <div style={{position: 'absolute', bottom: 'calc(clamp(20px, 8vh, 60px) + env(safe-area-inset-bottom, 0px))', zIndex: 12}}>
         <button className="primary-btn" onClick={handleLeave} style={{ background: 'rgba(192,132,252,0.25)', borderColor: 'rgba(192,132,252,0.6)', boxShadow: '0 4px 20px rgba(192,132,252,0.15)'}}>
            外気浴へ 🍃
         </button>
      </div>

      {/* 水面の波紋エフェクト */}
      {ripples.map(r => (
        <div 
          key={r.id}
          style={{
            position: 'absolute',
            top: r.top,
            left: r.left,
            width: '120px',
            height: '120px',
            border: '2px solid rgba(56,189,248,0.25)',
            borderRadius: '50%',
            animation: 'ripple 3s ease-out forwards',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      ))}
    </div>
  );
}

export default CoolingBath;

