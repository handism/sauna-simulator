import { useState, useEffect, useMemo } from 'react';

interface TotonouSpaceProps {
  saunaTime: number;
  waterTime: number;
  loylyCount: number;
  onNext: () => void;
}

const TotonouSpace = ({ saunaTime, waterTime, loylyCount, onNext }: TotonouSpaceProps) => {
  const [breathText, setBreathText] = useState<string>('吸って...');
  const [isInhaling, setIsInhaling] = useState<boolean>(true);
  const [totonouLevel, setTotonouLevel] = useState<number>(0);

  // ととのいスコアの計算とフィードバックの決定 (useMemo で宣言的に算出)
  const { maxTotonou, feedback } = useMemo(() => {
    // サウナスコア (最大55点): 50秒以上滞在で満点、ロウリュ1回につき+5点
    const saunaScore = Math.min(saunaTime / 50, 1.0) * 50 + Math.min(loylyCount * 5, 10);
    // 水風呂スコア (最大40点): 20秒以上滞在で満点
    const waterScore = Math.min(waterTime / 20, 1.0) * 40;
    
    const totalScore = Math.min(Math.round(saunaScore + waterScore), 100);

    // スコアに応じたフィードバック
    let text = '';
    if (totalScore >= 90) {
      text = '完璧な温冷交代浴です！ディープリラックスの境地へ... 🌌';
    } else if (totalScore >= 70) {
      text = 'しっかり「ととのい」の波が押し寄せています 🧘';
    } else if (saunaTime < 15) {
      text = 'サウナ室の温まりが少し足りなかったようです。次はじっくり汗を流しましょう 🔥';
    } else if (waterTime < 8) {
      text = '水風呂の冷却が短かったようです。羽衣を感じるまで浸かってみましょう 💧';
    } else {
      text = '心地よい休息です。回数を重ねて自分のペースを見つけましょう 🍃';
    }

    return { maxTotonou: totalScore, feedback: text };
  }, [saunaTime, waterTime, loylyCount]);

  // 呼吸の切り替えサイクル (4秒吸って、4秒吐く)
  useEffect(() => {
    const breathInterval = setInterval(() => {
      setIsInhaling(prev => {
        const next = !prev;
        setBreathText(next ? '吸って...' : '吐いて...');
        return next;
      });
    }, 4000);

    return () => clearInterval(breathInterval);
  }, []);

  // ととのいメーターの上昇アニメーション (0.1秒ごとに少しずつ上昇)
  useEffect(() => {
    const totonouInterval = setInterval(() => {
      setTotonouLevel(prev => {
        if (prev >= maxTotonou) {
          clearInterval(totonouInterval);
          return maxTotonou;
        }
        // 徐々に減速しながら目標値に近づくイージング
        const step = Math.max((maxTotonou - prev) * 0.05, 0.2);
        return Math.min(prev + step, maxTotonou);
      });
    }, 100);

    return () => clearInterval(totonouInterval);
  }, [maxTotonou]);

  return (
    <div style={{
      width: '100%', height: '100%', 
      display: 'flex', flexDirection: 'column', 
      alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    }}>
      
      {/* プレミアムオーロラ背景 (呼吸に合わせて透明度と光が微細に揺らぐ) */}
      <div 
        className="aurora-container" 
        style={{ 
          opacity: isInhaling ? 0.75 : 0.45,
          transition: 'opacity 4s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        <div className="aurora-blob one" />
        <div className="aurora-blob two" />
        <div className="aurora-blob three" />
      </div>

      <div style={{ position: 'absolute', top: 'calc(clamp(15px, 8vh, 6%) + env(safe-area-inset-top, 0px))', zIndex: 10, textAlign: 'center', width: '90%' }}>
        <h2 style={{ fontSize: 'clamp(1.4rem, 6vw, 1.8rem)', fontWeight: 200, letterSpacing: '10px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>外気浴</h2>
        <p style={{ fontSize: '0.9rem', color: '#64748b', letterSpacing: '2px' }}>風の音に身を任せて</p>
      </div>

      {/* 呼吸サークル (プレミアム仕様、吸う/吐くに合わせて伸縮しグローが強まる) */}
      <div 
        className="breathing-circle-premium"
        style={{
          transform: isInhaling ? 'scale(1.15)' : 'scale(0.92)',
          boxShadow: isInhaling 
            ? '0 0 50px rgba(6, 182, 212, 0.15), inset 0 0 40px rgba(6, 182, 212, 0.1)' 
            : '0 0 30px rgba(139, 92, 246, 0.08), inset 0 0 20px rgba(139, 92, 246, 0.05)',
          background: isInhaling 
            ? 'radial-gradient(circle, rgba(6, 182, 212, 0.1) 0%, rgba(6, 182, 212, 0.01) 60%, transparent 80%)'
            : 'radial-gradient(circle, rgba(139, 92, 246, 0.06) 0%, rgba(139, 92, 246, 0.01) 60%, transparent 80%)',
          borderColor: isInhaling ? 'rgba(6, 182, 212, 0.25)' : 'rgba(139, 92, 246, 0.15)'
        }}
      >
        <div 
          style={{ 
            fontSize: '1.4rem', 
            fontWeight: 300, 
            letterSpacing: '6px', 
            color: isInhaling ? '#a5f3fc' : '#ddd6fe', 
            zIndex: 10,
            transition: 'color 4s ease',
            marginLeft: '4px' // letterSpacingによる右寄り解消
          }}
        >
          {breathText}
        </div>
      </div>

      {/* 「ととのい度」情報パネル */}
      <div 
        className="glass-panel" 
        style={{ 
          marginTop: '40px', 
          background: 'rgba(255,255,255,0.03)', 
          zIndex: 10, 
          width: '90%', 
          maxWidth: '380px',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>ととのい度:</span>
          <span 
            className="dashboard-value" 
            style={{ 
              fontSize: '2.2rem', 
              color: totonouLevel >= 90 ? '#34d399' : totonouLevel >= 60 ? '#60a5fa' : '#a78bfa',
              textShadow: '0 0 15px rgba(255,255,255,0.1)'
            }}
          >
            {Math.round(totonouLevel)}%
          </span>
        </div>

        {/* プログレスバー */}
        <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
          <div 
            style={{ 
              width: `${totonouLevel}%`, 
              height: '100%', 
              background: 'linear-gradient(90deg, #8b5cf6, #3b82f6, #10b981)',
              borderRadius: '3px',
              transition: 'width 0.1s linear'
            }} 
          />
        </div>

        {/* フィードバックコメント */}
        {totonouLevel >= maxTotonou * 0.95 && (
          <p 
            style={{ 
              fontSize: '0.85rem', 
              color: '#cbd5e1', 
              textAlign: 'center', 
              lineHeight: '1.5',
              marginTop: '5px',
              animation: 'steam-blur-fade 1.5s ease-out'
            }}
          >
            {feedback}
          </p>
        )}
      </div>

      <div style={{ position: 'absolute', bottom: 'calc(clamp(20px, 8vh, 60px) + env(safe-area-inset-bottom, 0px))', zIndex: 12 }}>
         <button className="primary-btn" onClick={onNext} style={{ background: 'rgba(255,255,255,0.08)', fontSize: '0.95rem', padding: '12px 28px', border: '1px solid rgba(255,255,255,0.2)' }}>
            もう一度サウナへ 🔄
         </button>
      </div>
      
    </div>
  );
}

export default TotonouSpace;

