import React, { useState, useEffect } from 'react';
import './index.css';
import SaunaRoom from './components/SaunaRoom';
import CoolingBath from './components/CoolingBath';
import TotonouSpace from './components/TotonouSpace';
import { useAudioEngine } from './hooks/useAudioEngine';

function App() {
  const [stage, setStage] = useState('start'); // start, sauna, water, totonou
  const [opacity, setOpacity] = useState(1);
  const audio = useAudioEngine();

  // Handle cross-fading stage transitions
  const changeStage = (nextStage) => {
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

  const getBackground = () => {
    switch (stage) {
      case 'sauna':
        return 'linear-gradient(180deg, var(--sauna-bg-start) 0%, var(--sauna-bg-end) 100%)';
      case 'water':
        return 'linear-gradient(180deg, var(--water-bg-start) 0%, var(--water-bg-end) 100%)';
      case 'totonou':
        return 'radial-gradient(circle at center, var(--totonou-bg-start) 0%, var(--totonou-bg-end) 100%)';
      default:
        return '#111';
    }
  };

  return (
    <div className="app-container" style={{ background: getBackground() }}>
      {stage === 'start' && (
        <div style={{ textAlign: 'center', opacity: opacity, transition: 'opacity 1s', zIndex: 10 }}>
          <h1 style={{ fontSize: '3rem', marginBottom: '1rem', letterSpacing: '4px', textTransform: 'uppercase' }}>Browser Sauna</h1>
          <p style={{ marginBottom: '3rem', color: '#ccc' }}>プレミアムな疑似サウナ体験</p>
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
          <CoolingBath audio={audio} onNext={() => {
            audio.playAmbient('totonou');
            changeStage('totonou');
          }} />
        </div>
      )}

      {stage === 'totonou' && (
        <div style={{ opacity: opacity, transition: 'opacity 1s', width: '100%', height: '100%' }}>
          <TotonouSpace audio={audio} onNext={() => {
            audio.playAmbient('sauna');
            changeStage('sauna');
          }} />
        </div>
      )}
    </div>
  );
}

export default App;
