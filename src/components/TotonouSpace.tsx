import React, { useState, useEffect } from 'react';
import { AudioEngine } from '../hooks/useAudioEngine';

interface TotonouSpaceProps {
  audio: AudioEngine;
  onNext: () => void;
}

const TotonouSpace: React.FC<TotonouSpaceProps> = ({ onNext }) => {
  const [breathText, setBreathText] = useState<string>('吸って...');

  useEffect(() => {
    // 8-second breathing cycle (4s in, 4s out)
    const int = setInterval(() => {
      setBreathText(prev => prev === '吸って...' ? '吐いて...' : '吸って...');
    }, 4000);
    return () => clearInterval(int);
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%', 
      display: 'flex', flexDirection: 'column', 
      alignItems: 'center', justifyContent: 'center',
      position: 'relative'
    }}>
      
      {/* Breathing Guide */}
      <div className="breathing-circle">
          <div style={{ fontSize: '1.5rem', fontWeight: 300, letterSpacing: '8px', color: '#e2e8f0', zIndex: 10 }}>
              {breathText}
          </div>
      </div>

      <div style={{position: 'absolute', top: '10%', zIndex: 10, textAlign: 'center'}}>
        <h2 style={{ fontSize: '2rem', fontWeight: 200, letterSpacing: '12px', color: '#94a3b8' }}>ととのう</h2>
      </div>

      <div style={{position: 'absolute', bottom: '40px', zIndex: 10}}>
         <button className="primary-btn" onClick={onNext} style={{ background: 'rgba(255,255,255,0.1)', fontSize: '1rem', padding: '12px 24px'}}>
            もう一度サウナへ
         </button>
      </div>
      
    </div>
  );
}

export default TotonouSpace;
