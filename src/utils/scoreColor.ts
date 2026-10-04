import { TOTONOU_TIERS } from './saunaUtils';

// ととのい度の表示色。閾値の高い順に並べ、最初に達した段階の色を使う（段階はフィードバック文と共通）。
// 色はバーにだけ付け、数値の文字色は本文色のまま（色だけで段階を伝えない）
const SCORE_COLORS = [
  { min: TOTONOU_TIERS.EXCELLENT, color: '#c5d5bb' },
  { min: TOTONOU_TIERS.GOOD, color: '#b9d1d4' },
  { min: 0, color: '#e2cfb4' },
] as const;

export const scoreColor = (score: number) =>
  SCORE_COLORS.find(({ min }) => score >= min)?.color ?? SCORE_COLORS[2].color;
