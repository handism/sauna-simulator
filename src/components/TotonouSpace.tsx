import StageDock from './StageDock';
import { useState, useEffect, useMemo, useRef } from 'react';
import { calculateTotonouScore, totonouTierLabel } from '../utils/saunaUtils';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import { ActionIcon } from './ActionIcon';
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
  const rootRef = useRef<HTMLDivElement>(null);

  const { maxTotonou, feedback } = useMemo(
    () => calculateTotonouScore(saunaTime, waterTime, loylyCount),
    [saunaTime, waterTime, loylyCount],
  );

  // 呼吸の切り替えサイクル (4秒吸って、4秒吐く)
  useEffect(() => {
    const breathInterval = setInterval(() => {
      setIsInhaling((prev) => !prev);
    }, 4000);

    return () => clearInterval(breathInterval);
  }, []);

  useKeyboardShortcut(' ', onNext, { scope: rootRef });

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
      </header>

      {/* 呼吸サークル (プレミアム仕様、吸う/吐くに合わせて伸縮しグローが強まる) */}
      <div className="breathing-circle-premium">
        {/* 1回の吸う／吐く（4秒）で縁を一周する。切り替えのたびに作り直して最初から描く */}
        <svg className="breathing-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle key={isInhaling ? 'inhale' : 'exhale'} cx="50" cy="50" r="49" pathLength={100} />
        </svg>
        <div className="breathing-label">{isInhaling ? '吸って…' : '吐いて…'}</div>
      </div>

      {/* 結果は段階名とひと言だけ。数値と推移は終了画面に任せる */}
      <StageDock className="rest-dock">
        <div className="totonou-result">
          <p className="totonou-tier">{totonouTierLabel(maxTotonou)}</p>
          <p className="totonou-feedback">{feedback}</p>
        </div>
        <div className="dock-actions">
          <button className="primary-btn totonou-next-btn" onClick={onNext} aria-keyshortcuts="Space">
            <ActionIcon name="repeat" /> もう一度サウナへ
          </button>
          {onFinish && (
            <button className="primary-btn finish-btn" onClick={onFinish}>
              体験を終える <ActionIcon name="check" />
            </button>
          )}
        </div>
      </StageDock>
    </div>
  );
};

export default TotonouSpace;
