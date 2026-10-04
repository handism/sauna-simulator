const STEPS = ['サウナ', '水風呂', '外気浴'] as const;

export interface StageStepProps {
  /** 0: サウナ, 1: 水風呂, 2: 外気浴 */
  index: 0 | 1 | 2;
  /** 何セット目か。ループしても今どこにいるかが分かるよう、全ステージの見出しに出す */
  setNumber?: number;
}

// ステージ見出しの上に置く、3つの点による進み具合と現在のセット数。ステージ名は直下の見出しが示す
const StageStep = ({ index, setNumber }: StageStepProps) => (
  <p className="stage-step">
    <span className="stage-step-dots" aria-hidden="true">
      {STEPS.map((step, i) => (
        <span
          key={step}
          className="stage-step-dot"
          data-state={i < index ? 'done' : i === index ? 'current' : 'next'}
        />
      ))}
    </span>
    <span className="visually-hidden">
      {STEPS.length}段階中{index + 1}番目
    </span>
    {setNumber !== undefined && setNumber > 0 && <span className="stage-step-set">{setNumber}セット目</span>}
  </p>
);

export default StageStep;
