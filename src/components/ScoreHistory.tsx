import { scoreColor } from '../utils/scoreColor';

// 100%のときの棒の高さ（px）
const BAR_MAX_HEIGHT = 40;

export interface ScoreHistoryProps {
  scores: readonly number[];
}

// セットごとのととのい度を、0〜100%を同じ高さの軸にとった小さな縦棒で並べる。外気浴と終了画面で共有する
const ScoreHistory = ({ scores }: ScoreHistoryProps) => (
  <ol className="score-history" aria-label="セットごとのととのい度">
    {scores.map((score, i) => (
      <li key={i} className="score-history-item">
        {/* 値は棒の真上に置く。0%でも基線上に棒が見えるよう最小の高さを残す */}
        <span className="score-history-column">
          <span className="dashboard-value score-history-value">{score}%</span>
          <span
            className="score-history-bar"
            aria-hidden="true"
            style={{ height: `${Math.max((score * BAR_MAX_HEIGHT) / 100, 2)}px`, background: scoreColor(score) }}
          />
        </span>
        <span className="score-history-set">{i + 1}セット</span>
      </li>
    ))}
  </ol>
);

export default ScoreHistory;
