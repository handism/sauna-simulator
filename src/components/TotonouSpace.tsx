import { useState, useEffect, useMemo, useRef } from "react";
import { calculateTotonouScore } from "../utils/saunaUtils";

interface TotonouSpaceProps {}

const TotonouSpace = () => {
  const { saunaTime, waterTime, loylyCount, completeTotonou } =
    useSaunaContext();
  const [breathText, setBreathText] = useState<string>("吸って...");
  const [isInhaling, setIsInhaling] = useState<boolean>(true);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);

  const totonouTextRef = useRef<HTMLSpanElement>(null);
  const totonouBarRef = useRef<HTMLDivElement>(null);

  // ととのいスコアの計算とフィードバックの決定 (useMemo で宣言的に算出)
  const { maxTotonou, feedback } = useMemo(() => {
    return calculateTotonouScore(saunaTime, waterTime, loylyCount);
  }, [saunaTime, waterTime, loylyCount]);

  // 呼吸の切り替えサイクル (4秒吸って、4秒吐く)
  useEffect(() => {
    const breathInterval = setInterval(() => {
      setIsInhaling((prev) => {
        const next = !prev;
        setBreathText(next ? "吸って..." : "吐いて...");
        return next;
      });
    }, 4000);

    return () => clearInterval(breathInterval);
  }, []);

  const maxTotonouRef = useRef(maxTotonou);

  useEffect(() => {
    maxTotonouRef.current = maxTotonou;
  }, [maxTotonou]);

  // ととのいメーターの上昇アニメーション (requestAnimationFrame で最適化)
  useEffect(() => {
    let animationFrameId: number;
    let currentLevel = 0;
    let feedbackShown = false;

    // FPS非依存のイージングのために前回時刻を記録
    let lastTime = performance.now();

    const animate = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      const currentMaxTotonou = maxTotonouRef.current;

      if (currentLevel >= currentMaxTotonou) {
        currentLevel = currentMaxTotonou;
      } else {
        // 徐々に減速しながら目標値に近づくイージング (deltaTimeを用いて補正)
        // 元の100ms間隔に合わせたステップ幅の補正
        const timeScale = deltaTime / 100;
        const step =
          Math.max((currentMaxTotonou - currentLevel) * 0.05, 0.2) * timeScale;
        currentLevel = Math.min(currentLevel + step, currentMaxTotonou);
      }

      // DOM直接更新で再レンダリングを回避
      if (totonouTextRef.current) {
        const rounded = Math.round(currentLevel);
        totonouTextRef.current.innerText = `${rounded}%`;
        // 色の更新
        if (rounded >= 90) {
          totonouTextRef.current.style.color = "#34d399";
        } else if (rounded >= 60) {
          totonouTextRef.current.style.color = "#60a5fa";
        } else {
          totonouTextRef.current.style.color = "#a78bfa";
        }
      }

      if (totonouBarRef.current) {
        totonouBarRef.current.style.width = `${currentLevel}%`;
      }

      // フィードバック表示は一度だけ setState を呼ぶ
      if (!feedbackShown && currentLevel >= currentMaxTotonou * 0.95) {
        feedbackShown = true;
        setShowFeedback(true);
      }

      if (currentLevel < currentMaxTotonou) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <div className="scene-container">
      {/* プレミアムオーロラ背景 (呼吸に合わせて透明度と光が微細に揺らぐ) */}
      <div
        className="aurora-container"
        style={{
          opacity: isInhaling ? 0.75 : 0.45,
          transition: "opacity 4s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div className="aurora-blob one" />
        <div className="aurora-blob two" />
        <div className="aurora-blob three" />
      </div>

      <div className="totonou-title-container">
        <h2 className="totonou-title">外気浴</h2>
        <p className="totonou-subtitle">風の音に身を任せて</p>
      </div>

      {/* 呼吸サークル (プレミアム仕様、吸う/吐くに合わせて伸縮しグローが強まる) */}
      <div
        className="breathing-circle-premium"
        style={{
          transform: isInhaling ? "scale(1.15)" : "scale(0.92)",
          boxShadow: isInhaling
            ? "0 0 50px rgba(6, 182, 212, 0.15), inset 0 0 40px rgba(6, 182, 212, 0.1)"
            : "0 0 30px rgba(139, 92, 246, 0.08), inset 0 0 20px rgba(139, 92, 246, 0.05)",
          background: isInhaling
            ? "radial-gradient(circle, rgba(6, 182, 212, 0.1) 0%, rgba(6, 182, 212, 0.01) 60%, transparent 80%)"
            : "radial-gradient(circle, rgba(139, 92, 246, 0.06) 0%, rgba(139, 92, 246, 0.01) 60%, transparent 80%)",
          borderColor: isInhaling
            ? "rgba(6, 182, 212, 0.25)"
            : "rgba(139, 92, 246, 0.15)",
        }}
      >
        <div
          style={{
            fontSize: "1.4rem",
            fontWeight: 300,
            letterSpacing: "6px",
            color: isInhaling ? "#a5f3fc" : "#ddd6fe",
            zIndex: 10,
            transition: "color 4s ease",
            marginLeft: "4px", // letterSpacingによる右寄り解消
          }}
        >
          {breathText}
        </div>
      </div>

      {/* 「ととのい度」情報パネル */}
      <div className="glass-panel totonou-info-panel">
        <div className="totonou-info-row">
          <span className="totonou-info-label">ととのい度:</span>
          <span
            ref={totonouTextRef}
            className="dashboard-value totonou-progress-val"
            style={{ color: "#a78bfa" }}
          >
            0%
          </span>
        </div>

        {/* プログレスバー */}
        <div className="totonou-progress-bg">
          <div
            ref={totonouBarRef}
            className="totonou-progress-bar"
            style={{ width: "0%" }}
          />
        </div>

        {/* フィードバックコメント */}
        {showFeedback && <p className="totonou-feedback">{feedback}</p>}
      </div>

      <div className="totonou-next-btn-container">
        <button className="primary-btn totonou-next-btn" onClick={onNext}>
          もう一度サウナへ 🔄
        </button>
      </div>
    </div>
  );
};

export default TotonouSpace;
