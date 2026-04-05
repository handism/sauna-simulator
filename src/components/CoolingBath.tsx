import { useState, useEffect } from 'react';

interface CoolingBathProps {
  onNext: () => void;
}

interface Ripple {
  id: number;
  left: string;
  top: string;
}

const CoolingBath = ({ onNext }: CoolingBathProps) => {
  const [ripples, setRipples] = useState<Ripple[]>([]);

  useEffect(() => {
    const int = setInterval(() => {
      const newRipple: Ripple = {
        id: Date.now(),
        left: Math.random() * 80 + 10 + '%',
        top: Math.random() * 80 + 10 + '%',
      };
      setRipples(prev => [...prev.slice(-4), newRipple]); // max 5 ripples
    }, 1500);
    return () => clearInterval(int);
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%', 
      display: 'flex', flexDirection: 'column', 
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      
      <div className="glass-panel" style={{ textAlign: 'center', zIndex: 10, background: 'rgba(255,255,255,0.05)' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 300, color: '#bae6fd' }}>水風呂</h2>
        <div style={{ fontSize: '1.2rem', fontWeight: 400, margin: '20px 0', color: '#e0f2fe' }}>
          ゆっくりと粗熱を取る...
        </div>
      </div>

      <div style={{position: 'absolute', bottom: 'clamp(20px, 8vh, 60px)', zIndex: 10}}>
         <button className="primary-btn" onClick={onNext} style={{ background: 'rgba(192,132,252,0.2)', borderColor: 'rgba(192,132,252,0.5)'}}>
            外気浴へ 🍃
         </button>
      </div>

      {ripples.map(r => (
        <div 
          key={r.id}
          style={{
            position: 'absolute',
            top: r.top,
            left: r.left,
            width: '100px',
            height: '100px',
            border: '2px solid rgba(255,255,255,0.3)',
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
