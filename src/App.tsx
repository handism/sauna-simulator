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

function App() {
  const [stage, setStage] = useState<Stage>('start');
  const [opacity, setOpacity] = useState<number>(1);
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

  return (
    <div className="app-container" style={{ background: '#000' }}>

      {/* All backgrounds stay mounted for smooth crossfading */}
      {BACKGROUNDS.map(({ stage: s, gradient, image }) => (
        <div key={s} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: stage === s ? 1 : 0, transition: 'opacity 2s ease', backgroundImage: `linear-gradient(${gradient}), url(${import.meta.env.BASE_URL}${image})`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
      ))}

      <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
        {stage === 'start' && (
          <div style={{ textAlign: 'center', opacity: opacity, transition: 'opacity 1s', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '1rem', letterSpacing: '4px', textTransform: 'uppercase', textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>ブラウザサウナ</h1>
            <p style={{ marginBottom: '3rem', color: '#eaeaea', textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}>プレミアムな疑似サウナ体験</p>
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
