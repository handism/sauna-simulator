import { useState } from 'react';
import './index.css';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { useAudioEngine } from './hooks/useAudioEngine';

type Stage = 'start' | 'sauna' | 'water' | 'totonou';

function App() {
  const [stage, setStage] = useState<Stage>('start');
  const [opacity, setOpacity] = useState<number>(1);
  const audio = useAudioEngine();

  // Handle cross-fading stage transitions
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
      
      {/* Background Image Layers for smooth crossfading */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: stage === 'sauna' ? 1 : 0, transition: 'opacity 2s ease', backgroundImage: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.7)), url(${import.meta.env.BASE_URL}sauna_bg.png)`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: stage === 'water' ? 1 : 0, transition: 'opacity 2s ease', backgroundImage: `linear-gradient(rgba(0,0,0,0.2), rgba(0,0,0,0.6)), url(${import.meta.env.BASE_URL}water_bg.png)`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: stage === 'totonou' ? 1 : 0, transition: 'opacity 2s ease', backgroundImage: `linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.8)), url(${import.meta.env.BASE_URL}totonou_bg.png)`, backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 0 }} />

      {/* Foreground Content */}
      <div style={{ position: 'relative', zIndex: 10, width: '100%', height: '100%' }}>
        {stage === 'start' && (
          <div style={{ textAlign: 'center', opacity: opacity, transition: 'opacity 1s', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <h1 style={{ fontSize: '3rem', marginBottom: '1rem', letterSpacing: '4px', textTransform: 'uppercase', textShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>ブラウザ・サウナ</h1>
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
