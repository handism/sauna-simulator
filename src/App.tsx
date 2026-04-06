import { useState } from 'react';
import './index.css';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { useAudioEngine, AmbientEnv } from './hooks/useAudioEngine';

type Stage = 'start' | AmbientEnv;

const BACKGROUNDS: { stage: Stage; gradient: string; image: string }[] = [
  { stage: 'sauna', gradient: 'rgba(0,0,0,0.4), rgba(0,0,0,0.7)', image: 'sauna_bg.png' },
  { stage: 'water', gradient: 'rgba(0,0,0,0.2), rgba(0,0,0,0.6)', image: 'water_bg.png' },
  { stage: 'totonou', gradient: 'rgba(0,0,0,0.5), rgba(0,0,0,0.8)', image: 'totonou_bg.png' },
];

function MuteButton({ isMuted, onToggle }: { isMuted: boolean; onToggle: () => void }) {
  return (
    <button className="mute-btn" onClick={onToggle} aria-label={isMuted ? 'ミュート解除' : 'ミュート'}>
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
  const audio = useAudioEngine();

  const changeStage = (nextStage: Stage) => {
    setOpacity(0);
    setTimeout(() => {
      setStage(nextStage);
      setOpacity(1);
    }, 1000);
  };

  const handleStart = () => {
    audio.init();
    audio.playAmbient('sauna');
    changeStage('sauna');
  };

  const toggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    audio.setMuted(next);
  };

  return (
    <div className="app-container" style={{ background: '#000' }}>

      {/* All backgrounds stay mounted for smooth crossfading */}
      {BACKGROUNDS.map(({ stage: s, gradient, image }) => (
        <div key={s} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: stage === s ? 1 : 0, transition: 'opacity 2s ease', backgroundImage: `linear-gradient(${gradient}), url(${import.meta.env.BASE_URL}${image})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
      ))}

      <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
        {stage !== 'start' && <MuteButton isMuted={isMuted} onToggle={toggleMute} />}
        {stage === 'start' && (
          <div style={{ textAlign: 'center', opacity: opacity, transition: 'opacity 1s', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h1 style={{ fontSize: 'clamp(2rem, 8vw, 3rem)', marginBottom: '1rem', letterSpacing: '4px', textTransform: 'uppercase', textShadow: '0 4px 12px rgba(0,0,0,0.5)', textAlign: 'center' }}>ブラウザサウナ</h1>
            <p style={{ fontSize: 'clamp(1rem, 4vw, 1.2rem)', marginBottom: '3rem', color: '#eaeaea', textShadow: '0 2px 8px rgba(0,0,0,0.5)', textAlign: 'center' }}>プレミアムな疑似サウナ体験</p>
            <button className="primary-btn" onClick={handleStart}>
              入室する
            </button>
          </div>
        )}

        {stage === 'sauna' && (
          <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
            <SaunaRoom audio={audio} onNext={() => {
              audio.playAmbient('water');
              changeStage('water');
            }} />
          </div>
        )}

        {stage === 'water' && (
          <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
            <CoolingBath onNext={() => {
              audio.playAmbient('totonou');
              changeStage('totonou');
            }} />
          </div>
        )}

        {stage === 'totonou' && (
          <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
            <TotonouSpace onNext={() => {
              audio.playAmbient('sauna');
              changeStage('sauna');
            }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
