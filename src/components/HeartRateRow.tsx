import { beatSeconds } from '../utils/saunaUtils';

export interface HeartRateRowProps {
  heartRate: number;
  icon: string;
}

// 情報パネル下段の心拍数表示。アイコンは心拍に合わせて脈打つ
const HeartRateRow = ({ heartRate, icon }: HeartRateRowProps) => (
  <div className="stage-info-row stage-info-row-divided">
    <span className="stage-info-label">心拍数:</span>
    <span className="heart-rate">
      <span
        className="heart-rate-icon"
        style={{
          animation: `breathe ${beatSeconds(heartRate)}s infinite ease-in-out`,
        }}
      >
        {icon}
      </span>
      <span className="dashboard-value heart-rate-value">
        {Math.round(heartRate)} <span className="heart-rate-unit">BPM</span>
      </span>
    </span>
  </div>
);

export default HeartRateRow;
