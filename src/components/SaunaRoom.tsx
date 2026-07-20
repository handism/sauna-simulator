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

const SAUNA_CONFIG = {
  INITIAL_TEMP: 90,
  INITIAL_HUMIDITY: 15,
  INITIAL_HEART_RATE: 75,
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
  STEAM_DURATION_MS: 7000,
  STEAM_PARTICLE_DURATION_MS: 4000
};

const SaunaRoom = ({ audio, onNext }: SaunaRoomProps) => {
  const [saunaState, setSaunaState] = useState<{
    temperature: number;
    humidity: number;
    heartRate: number;
  }>({
    temperature: SAUNA_CONFIG.INITIAL_TEMP,
    humidity: SAUNA_CONFIG.INITIAL_HUMIDITY,
    heartRate: SAUNA_CONFIG.INITIAL_HEART_RATE,
  });
  const [steams, setSteams] = useState<Steam[]>([]);
  const [isSteaming, setIsSteaming] = useState<boolean>(false);
  
  const secondsRef = useRef<number>(0);
  const loylyCountRef = useRef<number>(0);
  const steamTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const { temperature, humidity, heartRate } = saunaState;

  // ロウリュ実行
  const handleLoyly = () => {
    audio.playLoyly();
    setSaunaState(prev => ({
      ...prev,
      temperature: Math.min(prev.temperature + SAUNA_CONFIG.LOYLY_TEMP_INC, SAUNA_CONFIG.MAX_TEMP),
      humidity: Math.min(prev.humidity + SAUNA_CONFIG.LOYLY_HUMIDITY_INC, SAUNA_CONFIG.MAX_HUMIDITY),
    }));
    loylyCountRef.current += 1;
    
    // スチーム曇り演出トリガー
    setIsSteaming(false); // 一度リセットして再起動できるようにする
    setTimeout(() => {
      if (isMountedRef.current) {
        setIsSteaming(true);
      }
    }, 10);

    if (steamTimeoutRef.current) clearTimeout(steamTimeoutRef.current);
    steamTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setIsSteaming(false);
      }
    }, SAUNA_CONFIG.STEAM_DURATION_MS); // index.css の steam-blur-fade アニメーション長と同期

    // サウナストーンからの蒸気パーティクル
    const newSteam: Steam = {
      id: Date.now(),
      left: Math.random() * 60 + 20 + '%'
    };
    setSteams(prev => [...prev, newSteam]);
    setTimeout(() => {
      if (isMountedRef.current) {
        setSteams(prev => prev.filter(s => s.id !== newSteam.id));
      }
    }, SAUNA_CONFIG.STEAM_PARTICLE_DURATION_MS);
  };

  // メインシミュレーションループ (1秒ごと)
  useEffect(() => {
    const interval = setInterval(() => {
      // 滞在時間カウント
      secondsRef.current += 1;

      setSaunaState(prev => {
        // 自然減衰 (温度と湿度は徐々に下がる)
        const nextTemp = Math.max(prev.temperature - SAUNA_CONFIG.TEMP_DECAY, SAUNA_CONFIG.MIN_TEMP);
        const nextHum = Math.max(prev.humidity - SAUNA_CONFIG.HUMIDITY_DECAY, SAUNA_CONFIG.MIN_HUMIDITY);

        // 体感温度の算出 (簡易Heat Index)
        // 湿度が上がると体感温度が急激に上がる
        const heatIndex = calculateHeatIndex(nextTemp, nextHum);
        
        // 体感温度に応じて心拍数が徐々に上昇
        const hrIncrease = (heatIndex - SAUNA_CONFIG.HEAT_INDEX_BASE) * SAUNA_CONFIG.HR_INCREASE_MULTIPLIER;
        const nextHeartRate = Math.min(prev.heartRate + Math.max(hrIncrease, SAUNA_CONFIG.HR_BASE_INCREASE), SAUNA_CONFIG.MAX_HEART_RATE);

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
    <div className="scene-container">
      {/* スチームオーバーレイ曇り演出 */}
      <div className={`steam-overlay ${isSteaming ? 'active' : ''}`} />
      
      <div className="glass-panel sauna-room-panel">
        <h2 className="sauna-room-title">サウナルーム</h2>
        
        {/* メインデジタルメーター */}
        <div className="sauna-meters-grid">
          <div className="sauna-meter-box">
            <span className="sauna-meter-label-temp">温度</span>
            <div className="dashboard-value sauna-meter-val-temp">
              {temperature.toFixed(1)}°C
            </div>
          </div>
          <div className="sauna-meter-box">
            <span className="sauna-meter-label-hum">湿度</span>
            <div className="dashboard-value sauna-meter-val-hum">
              {Math.round(humidity)}%
            </div>
          </div>
        </div>

        {/* 体感温度 & 心拍数情報 */}
        <div className="sauna-info-panel">
          <div className="sauna-info-row">
            <span className="sauna-info-label">体感温度:</span>
            <span className="dashboard-value sauna-info-val-heat">{heatIndex.toFixed(1)}°C</span>
          </div>

          <div className="sauna-info-row-bottom">
            <span className="sauna-info-label">心拍数:</span>
            <span className="sauna-info-val-hr">
              <span 
                className="sauna-heart-icon"
                style={{ animation: `breathe ${pulseSpeed}s infinite ease-in-out` }}
              >
                ❤️
              </span>
              <span className="dashboard-value" style={{ fontWeight: 600 }}>
                {Math.round(heartRate)} <span className="sauna-hr-bpm">BPM</span>
              </span>
            </span>
          </div>
        </div>
        
        <div className="sauna-action-btn-container">
          <button className="primary-btn sauna-loyly-btn" onClick={handleLoyly}>
            ロウリュ (Löyly)
          </button>
        </div>
      </div>

      {/* 水風呂への遷移アクションボタン */}
      <div className="sauna-next-stage-btn-container">
         <button className="primary-btn sauna-next-stage-btn" onClick={handleLeave}>
            限界.. 水風呂へ 💧
         </button>
      </div>

      {/* サウナストーンからの上昇蒸気パーティクル */}
      {steams.map(steam => (
        <div 
          key={steam.id}
          className="sauna-steam-particle"
          style={{ left: steam.left }}
        />
      ))}
    </div>
  );
}

export default SaunaRoom;

