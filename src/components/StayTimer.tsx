import { formatMinutesSeconds } from '../utils/saunaUtils';

export interface StayTimerProps {
  seconds: number;
  /** ととのい度が満点になる滞在時間。バーはここで満ちる */
  targetSeconds: number;
}

// ステージの滞在時間と目安までの進み具合。目安は経過時間の横に並べて一度に読めるようにし、目安を過ぎても数え続ける
const StayTimer = ({ seconds, targetSeconds }: StayTimerProps) => {
  const reached = seconds >= targetSeconds;
  return (
    <div className="stay-timer" data-reached={reached}>
      <div className="stay-timer-row">
        <span className="reading-label stay-timer-label">
          滞在時間
          {/* 届いたことは見出し側に添え、行の高さを変えない */}
          {reached && <span className="stay-timer-reached">目安に届きました</span>}
        </span>
        <span className="dashboard-value stay-timer-value">
          {formatMinutesSeconds(seconds)}
          <span className="stay-timer-goal">
            {' · 目安 '}
            {targetSeconds}秒
          </span>
        </span>
      </div>
      <p className="stay-timer-note">好きなタイミングで次へ</p>
      <div className="stay-timer-track" aria-hidden="true">
        <div className="stay-timer-bar" style={{ width: `${Math.min(seconds / targetSeconds, 1) * 100}%` }} />
      </div>
    </div>
  );
};

export default StayTimer;
