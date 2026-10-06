import StageDock from './StageDock';
import { useState, useEffect, useMemo, useRef } from 'react';
import { calculateTotonouScore, formatMinutesSeconds } from '../utils/saunaUtils';
import { scoreColor } from '../utils/scoreColor';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { ActionIcon } from './ActionIcon';
import ScoreHistory from './ScoreHistory';
import StageStep from './StageStep';

export interface TotonouSpaceProps {
  saunaTime: number;
  waterTime: number;
  loylyCount: number;
  /** 入室してから外気浴まで終えたセットのととのい度（今回のセットが末尾） */
  scoreHistory: readonly number[];
  onNext: () => void;
  onFinish?: () => void;
}

const TotonouSpace = ({ saunaTime, waterTime, loylyCount, scoreHistory, onNext, onFinish }: TotonouSpaceProps) => {
  const [isInhaling, setIsInhaling] = useState<boolean>(true);
  // メーターはスコアを初めて開いたときに上がり始める（閉じたまま演出が終わらないように）。
  // 言葉のフィードバックは数値を待たずに開いた時点で出す
  const [isRevealed, setIsRevealed] = useState<boolean>(false);

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
    if (!isRevealed) return;
    let animationFrameId: number;
    let currentLevel = 0;

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
      }

      if (totonouBarRef.current) {
        totonouBarRef.current.style.width = `${currentLevel}%`;
        totonouBarRef.current.style.background = scoreColor(Math.round(currentLevel));
      }

      if (currentLevel < maxTotonou) {
        animationFrameId = requestAnimationFrame(animate);
      }
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, [maxTotonou, isRevealed]);

  return (
    <div ref={rootRef} className="scene-container" data-breath={isInhaling ? 'inhale' : 'exhale'}>
      {/* プレミアムオーロラ背景 (呼吸に合わせて透明度と光が微細に揺らぐ。index.css の data-breath) */}
      <div className="aurora-container">
        <div className="aurora-blob one" />
        <div className="aurora-blob two" />
        <div className="aurora-blob three" />
      </div>

      <header className="stage-heading totonou-title-container">
        <StageStep index={2} setNumber={scoreHistory.length} />
        <h2 className="totonou-title" tabIndex={-1}>
          外気浴
        </h2>
        <p className="totonou-subtitle">風の音に身を任せて</p>
      </header>

      {/* 呼吸サークル (プレミアム仕様、吸う/吐くに合わせて伸縮しグローが強まる) */}
      <div className="breathing-circle-premium">
        {/* 1回の吸う／吐く（4秒）で縁を一周する。切り替えのたびに作り直して最初から描く */}
        <svg className="breathing-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle key={isInhaling ? 'inhale' : 'exhale'} cx="50" cy="50" r="49" pathLength={100} />
        </svg>
        <div className="breathing-label">{isInhaling ? '吸って…' : '吐いて…'}</div>
      </div>

      {/* 「ととのい度」情報パネル */}
      <StageDock className="rest-dock">
        <details className="stage-details rest-details" name="rest-review">
          <summary>今回の休息を振り返る</summary>
          <dl className="rest-summary">
            <div>
              <dt>過ごしたセット</dt>
              <dd>{scoreHistory.length} セット</dd>
            </div>
            <div>
              <dt>サウナ / 水風呂</dt>
              <dd>
                {formatMinutesSeconds(saunaTime)} / {formatMinutesSeconds(waterTime)}
              </dd>
            </div>
          </dl>
          <p className="detail-note">自分のペースで過ごせたら、それで十分。</p>
        </details>
        {/* スコアは振り返りと並べて置き、開いたときだけ見せる（入れ子にすると2段開く必要がある）。
            同じ name で片方だけ開き、パネルが伸びて操作ボタンが画面外に出ないようにする */}
        <details className="stage-details score-details" name="rest-review">
          <summary onClick={() => setIsRevealed(true)}>体験内のスコアを見る</summary>
          <p className="detail-note">ととのい度は体験内の遊びの指標です。</p>
          <div className="totonou-info-panel">
            {/* 数値より先に言葉で伝える。開いた時点で読み上げるため、ライブリージョンは常に置いておく */}
            <div aria-live="polite">{isRevealed && <p className="totonou-feedback">{feedback}</p>}</div>

            <div className="totonou-info-row">
              <span className="reading-label">ととのい度</span>
              <span ref={totonouTextRef} className="dashboard-value totonou-progress-val">
                0%
              </span>
            </div>

            {/* プログレスバー */}
            <div className="totonou-progress-bg">
              <div
                ref={totonouBarRef}
                className="totonou-progress-bar"
                style={{ width: '0%', background: scoreColor(0) }}
              />
            </div>

            {/* これまでのセットの推移（2セット目以降） */}
            {scoreHistory.length > 1 && <ScoreHistory scores={scoreHistory} />}
          </div>
        </details>
        <div className="dock-actions">
          <button className="primary-btn totonou-next-btn" onClick={onNext} aria-keyshortcuts="Space">
            <ActionIcon name="repeat" /> もう一度サウナへ{' '}
            <kbd className="button-shortcut" aria-hidden="true">
              Space
            </kbd>
          </button>
          {onFinish && (
            <button className="primary-btn finish-btn" onClick={onFinish}>
              今日はここまで <ActionIcon name="check" />
            </button>
          )}
        </div>
      </StageDock>
    </div>
  );
};

export default TotonouSpace;
