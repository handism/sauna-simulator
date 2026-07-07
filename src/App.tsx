import { useState } from 'react';
import './index.css';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { useAudioEngine, AmbientEnv } from './hooks/useAudioEngine';

type Stage = 'start' | AmbientEnv;

const BACKGROUNDS: { stage: Stage; gradient: string; image: string }[] = [
  { stage: 'sauna', gradient: 'rgba(0,0,0,0.45), rgba(0,0,0,0.75)', image: 'sauna_bg.png' },
  { stage: 'water', gradient: 'rgba(0,0,0,0.25), rgba(0,0,0,0.65)', image: 'water_bg.png' },
  { stage: 'totonou', gradient: 'rgba(0,0,0,0.55), rgba(0,0,0,0.85)', image: 'totonou_bg.png' },
];

function UiToggleButton({ isUiHidden, onToggle }: { isUiHidden: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mute-btn ui-toggle-btn"
      style={{ right: '72px', opacity: isUiHidden ? 0.3 : 1 }}
      onClick={onToggle}
      aria-label={isUiHidden ? 'UI表示' : 'UI非表示'}
      aria-pressed={isUiHidden}
    >
      {isUiHidden ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      )}
    </button>
  );
}

function MuteButton({ isMuted, onToggle }: { isMuted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mute-btn"
      onClick={onToggle}
      aria-label={isMuted ? 'ミュート解除' : 'ミュート'}
      aria-pressed={isMuted}
    >
      {isMuted ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
}

function App() {
  const [stage, setStage] = useState<Stage>('start');
  const [opacity, setOpacity] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isUiHidden, setIsUiHidden] = useState<boolean>(false);
  
  // シミュレーション用パラメータの連携管理
  const [heartRate, setHeartRate] = useState<number>(75);
  const [saunaTime, setSaunaTime] = useState<number>(0);
  const [loylyCount, setLoylyCount] = useState<number>(0);
  const [waterTime, setWaterTime] = useState<number>(0);

  const audio = useAudioEngine();

  const changeStage = (nextStage: Stage) => {
    setOpacity(0);
    setTimeout(() => {
      setStage(nextStage);
      setOpacity(1);
    }, 1000);
  };

  const handleStart = (withSound: boolean) => {
    audio.init();
    setIsMuted(!withSound);
    audio.setMuted(!withSound);
    audio.playAmbient('sauna');
    
    // ステート初期化
    setHeartRate(75);
    setSaunaTime(0);
    setLoylyCount(0);
    setWaterTime(0);

    changeStage('sauna');
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    audio.setMuted(next);
  };

  const toggleUiVisibility = () => {
    setIsUiHidden(!isUiHidden);
  };

  return (
    <div className={`app-container ${isUiHidden ? 'ui-hidden' : ''}`} style={{ background: '#000' }}>

      {/* Background image crossfading */}
      {BACKGROUNDS.map(({ stage: s, gradient, image }) => (
        <div key={s} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: stage === s ? 1 : 0, transition: 'opacity 2s ease', backgroundImage: `linear-gradient(${gradient}), url(${import.meta.env.BASE_URL}${image})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
      ))}

      <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
        {stage !== 'start' && (
          <>
            <UiToggleButton isUiHidden={isUiHidden} onToggle={toggleUiVisibility} />
            <MuteButton isMuted={isMuted} onToggle={toggleMute} />
          </>
        )}
        
        {stage === 'start' && (
          <div style={{ textAlign: 'center', opacity: opacity, transition: 'opacity 1s', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <h1 style={{ fontSize: 'clamp(2.2rem, 8vw, 3.5rem)', marginBottom: '0.5rem', fontWeight: 600, letterSpacing: '6px', textTransform: 'uppercase', textShadow: '0 4px 16px rgba(0,0,0,0.6)', textAlign: 'center' }}>ブラウザサウナ</h1>
            <p style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)', marginBottom: '1.5rem', color: '#cbd5e1', textShadow: '0 2px 8px rgba(0,0,0,0.6)', textAlign: 'center', fontWeight: 300 }}>プレミアムな疑似サウナ体験</p>
            
            <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '2.5rem', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.05)', padding: '8px 16px', borderRadius: '30px', border: '1px solid rgba(255,255,255,0.1)' }}>
              <span>🎧</span> ヘッドホン・イヤホン推奨
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', width: '100%', maxWidth: '280px' }}>
              <button className="primary-btn" onClick={() => handleStart(true)} style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}>
                音ありで入室する
              </button>
              <button className="primary-btn" onClick={() => handleStart(false)} style={{ background: 'rgba(255,255,255,0.1)', fontSize: '1rem', padding: '12px 24px' }}>
                静かに入室する
              </button>
            </div>
          </div>
        )}

        {stage === 'sauna' && (
          <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
            <SaunaRoom 
              audio={audio} 
              onNext={(finalHeartRate, duration, loylys) => {
                setHeartRate(finalHeartRate);
                setSaunaTime(duration);
                setLoylyCount(loylys);
                audio.playAmbient('water');
                changeStage('water');
              }} 
            />
          </div>
        )}

        {stage === 'water' && (
          <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
            <CoolingBath 
              initialHeartRate={heartRate}
              onNext={(finalHeartRate, duration) => {
                setHeartRate(finalHeartRate);
                setWaterTime(duration);
                audio.playAmbient('totonou');
                changeStage('totonou');
              }} 
            />
          </div>
        )}

        {stage === 'totonou' && (
          <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
            <TotonouSpace 
              saunaTime={saunaTime}
              waterTime={waterTime}
              loylyCount={loylyCount}
              onNext={() => {
                audio.playAmbient('sauna');
                changeStage('sauna');
              }} 
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

