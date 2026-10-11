import { formatMinutesSeconds } from '../utils/saunaUtils';

export interface StayTimerProps {
  seconds: number;
  /** ととのい度が満点になる滞在時間。バーはここで満ちる */
  targetSeconds: number;
}

// ステージの滞在時間と目安までの進み具合を1行とバーで示す。目安を過ぎても数え続ける
const StayTimer = ({ seconds, targetSeconds }: StayTimerProps) => (
  <div className="stay-timer" data-reached={seconds >= targetSeconds}>
    <div className="stay-timer-row">
      <span className="reading-label">滞在時間</span>
      <span className="dashboard-value stay-timer-value">
        {formatMinutesSeconds(seconds)}
        <span className="stay-timer-goal"> / 目安 {targetSeconds}秒</span>
      </span>
    </div>
    <div className="stay-timer-track" aria-hidden="true">
      <div className="stay-timer-bar" style={{ width: `${Math.min(seconds / targetSeconds, 1) * 100}%` }} />
    </div>
  </div>
);

export default StayTimer;
