import { formatMinutesSeconds } from '../utils/saunaUtils';

export interface StayTimerProps {
  seconds: number;
  /** ととのい度が満点になる滞在時間。バーはここで満ちる */
  targetSeconds: number;
}

// ステージの滞在時間と目安までの進み具合。目安を過ぎても数え続ける
const StayTimer = ({ seconds, targetSeconds }: StayTimerProps) => {
  const reached = seconds >= targetSeconds;
  return (
    <div className="stay-timer" data-reached={reached}>
      <div className="stay-timer-row">
        <span className="stay-timer-label">滞在時間</span>
        <span className="dashboard-value stay-timer-value">{formatMinutesSeconds(seconds)}</span>
      </div>
      <div className="stay-timer-track" aria-hidden="true">
        <div className="stay-timer-bar" style={{ width: `${Math.min(seconds / targetSeconds, 1) * 100}%` }} />
      </div>
      <p className="stay-timer-target">
        {reached ? '目安に届きました。出るのはいつでも。' : `体験の目安 ${formatMinutesSeconds(targetSeconds)}`}
      </p>
    </div>
  );
};

export default StayTimer;
