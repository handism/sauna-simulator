import { beatSeconds } from '../utils/saunaUtils';
import { ActionIcon } from './ActionIcon';

export interface HeartRateRowProps {
  heartRate: number;
  /** 上に区切り線を引く（情報パネルの下段に置くとき） */
  divided?: boolean;
}

// 情報パネル下段の心拍数表示。アイコンは心拍に合わせて脈打つ
const HeartRateRow = ({ heartRate, divided = true }: HeartRateRowProps) => (
  <div className={`stage-info-row heart-rate-row${divided ? ' stage-info-row-divided' : ''}`}>
    <span className="reading-label">心拍数</span>
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
