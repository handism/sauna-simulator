import { useState, useEffect, useRef } from 'react';
import { AudioEngine } from '../hooks/useAudioEngine';
import { calculateHeatIndex } from '../utils/saunaUtils';

interface SaunaRoomProps {
  audio: AudioEngine;
  onNext: (heartRate: number, duration: number, loylyCount: number) => void;
}

interface Steam {
  id: number;
  left: string;
}

const SaunaRoom = ({ audio, onNext }: SaunaRoomProps) => {
  const [saunaState, setSaunaState] = useState<{
    temperature: number;
    humidity: number;
    heartRate: number;
  }>({
    temperature: 90,
    humidity: 15,
    heartRate: 75,
  });
  const [steams, setSteams] = useState<Steam[]>([]);
  const [isSteaming, setIsSteaming] = useState<boolean>(false);
  
  const secondsRef = useRef<number>(0);
  const loylyCountRef = useRef<number>(0);
  const steamTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { temperature, humidity, heartRate } = saunaState;

  // ロウリュ実行
  const handleLoyly = () => {
    audio.playLoyly();
    setSaunaState(prev => ({
      ...prev,
      temperature: Math.min(prev.temperature + 3, 110),
      humidity: Math.min(prev.humidity + 25, 90),
    }));
    loylyCountRef.current += 1;
    
    // スチーム曇り演出トリガー
    setIsSteaming(false); // 一度リセットして再起動できるようにする
    setTimeout(() => {
      setIsSteaming(true);
    }, 10);

    if (steamTimeoutRef.current) clearTimeout(steamTimeoutRef.current);
    steamTimeoutRef.current = setTimeout(() => {
      setIsSteaming(false);
    }, 7000); // index.css の steam-blur-fade アニメーション長と同期

    // サウナストーンからの蒸気パーティクル
    const newSteam: Steam = {
      id: Date.now(),
      left: Math.random() * 60 + 20 + '%'
    };
    setSteams(prev => [...prev, newSteam]);
    setTimeout(() => {
      setSteams(prev => prev.filter(s => s.id !== newSteam.id));
    }, 4000);
  };

  // メインシミュレーションループ (1秒ごと)
  useEffect(() => {
    const interval = setInterval(() => {
      // 滞在時間カウント
      secondsRef.current += 1;

      setSaunaState(prev => {
        // 自然減衰 (温度と湿度は徐々に下がる)
        const nextTemp = Math.max(prev.temperature - 0.05, 85);
        const nextHum = Math.max(prev.humidity - 0.4, 12);

        // 体感温度の算出 (簡易Heat Index)
        // 湿度が上がると体感温度が急激に上がる
        const heatIndex = calculateHeatIndex(nextTemp, nextHum);
        
        // 体感温度に応じて心拍数が徐々に上昇
        const hrIncrease = (heatIndex - 70) * 0.006;
        const nextHeartRate = Math.min(prev.heartRate + Math.max(hrIncrease, 0.02), 155);

        return {
          temperature: nextTemp,
          humidity: nextHum,
          heartRate: nextHeartRate
        };
      });

    }, 1000);

    return () => {
      clearInterval(interval);
      if (steamTimeoutRef.current) clearTimeout(steamTimeoutRef.current);
    };
  }, []);

  // 体感温度のリアルタイム計算
  const heatIndex = calculateHeatIndex(temperature, humidity);

  const handleLeave = () => {
    onNext(Math.round(heartRate), secondsRef.current, loylyCountRef.current);
  };

  // 心拍数に応じたアニメーション周期 (BPMを1秒あたりの秒数に変換)
  const pulseSpeed = 60 / heartRate;

  return (
    <div style={{
      width: '100%', height: '100%', 
      display: 'flex', flexDirection: 'column', 
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* スチームオーバーレイ曇り演出 */}
      <div className={`steam-overlay ${isSteaming ? 'active' : ''}`} />
      
      <div className="glass-panel" style={{ textAlign: 'center', zIndex: 10, width: '92%', maxWidth: '420px', padding: '2.5rem 2rem' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 300, color: '#fca5a5', letterSpacing: '4px', marginBottom: '1.5rem' }}>サウナルーム</h2>
        
        {/* メインデジタルメーター */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', margin: '20px 0' }}>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px 10px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.8rem', color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '1px' }}>温度</span>
            <div className="dashboard-value" style={{ fontSize: '2rem', marginTop: '5px' }}>
              {temperature.toFixed(1)}°C
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '15px 10px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ fontSize: '0.8rem', color: '#93c5fd', textTransform: 'uppercase', letterSpacing: '1px' }}>湿度</span>
            <div className="dashboard-value" style={{ fontSize: '2rem', marginTop: '5px', color: '#93c5fd' }}>
              {Math.round(humidity)}%
            </div>
          </div>
        </div>

        {/* 体感温度 & 心拍数情報 */}
        <div style={{ background: 'rgba(255,255,255,0.03)', padding: '15px', borderRadius: '16px', marginBottom: '25px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}>
            <span style={{ color: '#cbd5e1' }}>体感温度:</span>
            <span className="dashboard-value" style={{ color: '#f87171', fontWeight: 600 }}>{heatIndex.toFixed(1)}°C</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.95rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
            <span style={{ color: '#cbd5e1' }}>心拍数:</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span 
                style={{ 
                  color: '#ef4444', 
                  display: 'inline-block',
                  animation: `breathe ${pulseSpeed}s infinite ease-in-out`
                }}
              >
                ❤️
              </span>
              <span className="dashboard-value" style={{ fontWeight: 600 }}>{Math.round(heartRate)} <span style={{ fontSize: '0.75rem', fontWeight: 300 }}>BPM</span></span>
            </span>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
          <button className="primary-btn" onClick={handleLoyly} style={{ borderColor: 'var(--accent)', color: 'var(--accent)', width: '100%', fontSize: '1.1rem' }}>
            ロウリュ (Löyly)
          </button>
        </div>
      </div>

      {/* 水風呂への遷移アクションボタン */}
      <div style={{ position: 'absolute', bottom: 'calc(clamp(20px, 8vh, 60px) + env(safe-area-inset-bottom, 0px))', zIndex: 12 }}>
         <button className="primary-btn" onClick={handleLeave} style={{ background: 'rgba(56,189,248,0.2)', borderColor: 'rgba(56,189,248,0.6)', boxShadow: '0 4px 20px rgba(56,189,248,0.15)' }}>
            限界.. 水風呂へ 💧
         </button>
      </div>

      {/* サウナストーンからの上昇蒸気パーティクル */}
      {steams.map(steam => (
        <div 
          key={steam.id}
          style={{
            position: 'absolute',
            bottom: '-5%',
            left: steam.left,
            width: '180px',
            height: '180px',
            background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
            borderRadius: '50%',
            animation: 'steam-rise 4s ease-out forwards',
            pointerEvents: 'none',
            zIndex: 5
          }}
        />
      ))}
    </div>
  );
}

export default SaunaRoom;

