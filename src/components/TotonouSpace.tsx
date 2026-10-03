import { useState, useEffect, useMemo, useRef } from 'react';
import { calculateTotonouScore, TOTONOU_TIERS } from '../utils/saunaUtils';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';

export interface TotonouSpaceProps {
  saunaTime: number;
  waterTime: number;
  loylyCount: number;
  /** 入室してから外気浴まで終えたセットのととのい度（今回のセットが末尾） */
  scoreHistory: readonly number[];
  onNext: () => void;
}

// ととのい度の表示色。閾値の高い順に並べ、最初に達した段階の色を使う（段階はフィードバック文と共通）
const SCORE_COLORS = [
  { min: TOTONOU_TIERS.EXCELLENT, color: '#34d399' },
  { min: TOTONOU_TIERS.GOOD, color: '#60a5fa' },
  { min: 0, color: '#a78bfa' },
] as const;

const scoreColor = (score: number) => SCORE_COLORS.find(({ min }) => score >= min)?.color ?? SCORE_COLORS[2].color;

const TotonouSpace = ({ saunaTime, waterTime, loylyCount, scoreHistory, onNext }: TotonouSpaceProps) => {
  const [isInhaling, setIsInhaling] = useState<boolean>(true);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const totonouTextRef = useRef<HTMLSpanElement>(null);
  const totonouBarRef = useRef<HTMLDivElement>(null);

  // ととのいスコアの計算とフィードバックの決定 (useMemo で宣言的に算出)
  const { maxTotonou, feedback } = useMemo(() => {
    return calculateTotonouScore(saunaTime, waterTime, loylyCount);
  }, [saunaTime, waterTime, loylyCount]);

  // 呼吸の切り替えサイクル (4秒吸って、4秒吐く)
  useEffect(() => {
    const breathInterval = setInterval(() => {
      setIsInhaling((prev) => !prev);
    }, 4000);

    return () => clearInterval(breathInterval);
  }, []);

  useKeyboardShortcut(' ', onNext, { scope: rootRef });

  // ととのいメーターの上昇アニメーション (requestAnimationFrame で最適化)
  // ステージごとにマウントし直されるため、表示中に maxTotonou は変わらない
  useEffect(() => {
    let animationFrameId: number;
    let currentLevel = 0;
    let feedbackShown = false;

    // FPS非依存のイージングのために前回時刻を記録
    let lastTime = performance.now();

    const animate = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      if (currentLevel >= maxTotonou) {
        currentLevel = maxTotonou;
      } else {
        // 徐々に減速しながら目標値に近づくイージング (deltaTimeを用いて補正)
        // 元の100ms間隔に合わせたステップ幅の補正
        const timeScale = deltaTime / 100;
        const step = Math.max((maxTotonou - currentLevel) * 0.05, 0.2) * timeScale;
        currentLevel = Math.min(currentLevel + step, maxTotonou);
      }

      // DOM直接更新で再レンダリングを回避
      if (totonouTextRef.current) {
        const rounded = Math.round(currentLevel);
        totonouTextRef.current.textContent = `${rounded}%`;
        totonouTextRef.current.style.color = scoreColor(rounded);
      }

      if (totonouBarRef.current) {
        totonouBarRef.current.style.width = `${currentLevel}%`;
      }

      // フィードバック表示は一度だけ setState を呼ぶ
      if (!feedbackShown && currentLevel >= maxTotonou * 0.95) {
        feedbackShown = true;
        setShowFeedback(true);
      }

      if (currentLevel < maxTotonou) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, [maxTotonou]);

  return (
    <div ref={rootRef} className="scene-container" data-breath={isInhaling ? 'inhale' : 'exhale'}>
      {/* プレミアムオーロラ背景 (呼吸に合わせて透明度と光が微細に揺らぐ。index.css の data-breath) */}
      <div className="aurora-container">
        <div className="aurora-blob one" />
        <div className="aurora-blob two" />
        <div className="aurora-blob three" />
      </div>

      <div className="totonou-title-container">
        <h2 className="totonou-title">外気浴</h2>
        <p className="totonou-subtitle">風の音に身を任せて</p>
        {scoreHistory.length > 0 && <p className="totonou-set-label">{scoreHistory.length}セット目</p>}
      </div>

      {/* 呼吸サークル (プレミアム仕様、吸う/吐くに合わせて伸縮しグローが強まる) */}
      <div className="breathing-circle-premium">
        <div className="breathing-label">{isInhaling ? '吸って...' : '吐いて...'}</div>
      </div>

      {/* 「ととのい度」情報パネル */}
      <div className="glass-panel totonou-info-panel">
        <div className="totonou-info-row">
          <span className="totonou-info-label">ととのい度:</span>
          <span ref={totonouTextRef} className="dashboard-value totonou-progress-val" style={{ color: scoreColor(0) }}>
            0%
          </span>
        </div>

        {/* プログレスバー */}
        <div className="totonou-progress-bg">
          <div ref={totonouBarRef} className="totonou-progress-bar" style={{ width: '0%' }} />
        </div>

        {/* フィードバックコメント。表示時に読み上げるため、ライブリージョンは常に置いておく */}
        <div aria-live="polite">{showFeedback && <p className="totonou-feedback">{feedback}</p>}</div>

        {/* これまでのセットの推移（2セット目以降） */}
        {scoreHistory.length > 1 && (
          <ol className="totonou-history" aria-label="セットごとのととのい度">
            {scoreHistory.map((score, i) => (
              <li key={i} className="totonou-history-item">
                <span className="totonou-history-set">{i + 1}セット</span>
                <span className="dashboard-value" style={{ color: scoreColor(score) }}>
                  {score}%
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="totonou-next-btn-container">
        <button className="primary-btn totonou-next-btn" onClick={onNext} aria-keyshortcuts="Space">
          もう一度サウナへ 🔄
        </button>
      </div>
    </div>
  );
};

export default TotonouSpace;
