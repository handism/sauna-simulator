import { beatSeconds } from '../utils/saunaUtils';
import { ActionIcon } from './ActionIcon';

export interface HeartRateRowProps {
  heartRate: number;
}

// 情報パネル下段の心拍数表示。アイコンは心拍に合わせて脈打つ
const HeartRateRow = ({ heartRate }: HeartRateRowProps) => (
  <div className="stage-info-row stage-info-row-divided">
    <span className="stage-info-label">心拍数:</span>
    <span className="heart-rate">
      <span
        className="heart-rate-icon"
        style={{
          animation: `breathe ${beatSeconds(heartRate)}s infinite ease-in-out`,
        }}
      >
        <ActionIcon name="heart" />
      </span>
      <span className="dashboard-value heart-rate-value">
        {Math.round(heartRate)} <span className="heart-rate-unit">BPM</span>
      </span>
    </span>
  </div>
);

export default HeartRateRow;
