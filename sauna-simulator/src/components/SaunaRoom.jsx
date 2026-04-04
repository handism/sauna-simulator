import React, { useState, useEffect } from 'react';

function SaunaRoom({ audio, onNext }) {
  const [temperature, setTemperature] = useState(90);
  const [steams, setSteams] = useState([]);

  const handleLoyly = () => {
    audio.playLoyly();
    setTemperature(prev => Math.min(prev + 2, 110));
    
    const newSteam = {
      id: Date.now(),
      left: Math.random() * 60 + 20 + '%'
    };
    setSteams(prev => [...prev, newSteam]);

    setTimeout(() => {
      setSteams(prev => prev.filter(s => s.id !== newSteam.id));
    }, 4000);
  };

  // Slowly lose heat over time
  useEffect(() => {
    const int = setInterval(() => {
      setTemperature(prev => Math.max(prev - 0.2, 85));
    }, 3000);
    return () => clearInterval(int);
  }, []);

  return (
    <div style={{
      width: '100%', height: '100%', 
      display: 'flex', flexDirection: 'column', 
      alignItems: 'center', justifyContent: 'center',
      position: 'relative'
    }}>
      
      <div className="glass-panel" style={{ textAlign: 'center', minWidth: '300px', zIndex: 10 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 300, color: '#fca5a5' }}>SAUNA ROOM</h2>
        <div style={{ fontSize: '5rem', fontWeight: 600, margin: '20px 0', textShadow: '0 0 20px rgba(239,68,68,0.5)' }}>
          {temperature.toFixed(1)}°C
        </div>
        
        <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', marginTop: '20px' }}>
          <button className="primary-btn" onClick={handleLoyly} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
            ロウリュ (Löyly)
          </button>
        </div>
      </div>

      <div style={{position: 'absolute', bottom: '40px', zIndex: 10}}>
         <button className="primary-btn" onClick={onNext} style={{ background: 'rgba(56,189,248,0.2)', borderColor: 'rgba(56,189,248,0.5)'}}>
            限界.. 水風呂へ 💧
         </button>
      </div>

      {/* Renders steam animations */}
      {steams.map(steam => (
        <div 
          key={steam.id}
          style={{
            position: 'absolute',
            bottom: '-10%',
            left: steam.left,
            width: '150px',
            height: '150px',
            background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)',
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
