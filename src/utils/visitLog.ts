// 終了操作ごとの来訪記録。表示設定と同じく任意の保存先で、ストレージが無効な環境では記録せずに動作する。

const VISIT_LOG_KEY = 'sui-visit-log';
// 古い記録から捨てる。通算の回数・セット数は別に持つので、件数の上限で累計は減らない
const MAX_RECENT_VISITS = 30;

export interface Visit {
  /** 終了操作の時刻（Date.now） */
  at: number;
  sets: number;
  seconds: number;
}

interface VisitLog {
  visits: number;
  totalSets: number;
  recent: Visit[];
}

/** 終了画面に出す、今回を含めた通算と前回の来訪 */
export interface VisitTotals {
  visits: number;
  totalSets: number;
  /** 前回の終了時刻。今回が初めてなら null */
  previousAt: number | null;
}

const EMPTY_LOG: VisitLog = { visits: 0, totalSets: 0, recent: [] };

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isVisit = (value: unknown): value is Visit => {
  if (typeof value !== 'object' || value === null) return false;
  const { at, sets, seconds } = value as Record<string, unknown>;
  return typeof at === 'number' && Number.isFinite(at) && isCount(sets) && isCount(seconds);
};

// 壊れた値・別形式の値は記録なしとして扱う（記録は任意なので体験を止めない）
function readLog(): VisitLog {
  try {
    const saved = localStorage.getItem(VISIT_LOG_KEY);
    if (saved === null) return EMPTY_LOG;
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_LOG;
    const { visits, totalSets, recent } = parsed as Record<string, unknown>;
    if (!isCount(visits) || !isCount(totalSets) || !Array.isArray(recent)) return EMPTY_LOG;
    return { visits, totalSets, recent: recent.filter(isVisit) };
  } catch {
    return EMPTY_LOG;
  }
}

/** 来訪を1回分追記し、今回を含めた通算を返す。保存に失敗しても今回分を数えた値を返す */
export function recordVisit(visit: Visit): VisitTotals {
  const log = readLog();
  const next: VisitLog = {
    visits: log.visits + 1,
    totalSets: log.totalSets + visit.sets,
    recent: [...log.recent, visit].slice(-MAX_RECENT_VISITS),
  };
  try {
    localStorage.setItem(VISIT_LOG_KEY, JSON.stringify(next));
  } catch {
    /* Optional record. */
  }
  return {
    visits: next.visits,
    totalSets: next.totalSets,
    previousAt: log.recent[log.recent.length - 1]?.at ?? null,
  };
}

/** 前回の来訪日を「今日」「昨日」「10月15日」で表す（暦日で比べる） */
export function formatPreviousVisit(previousAt: number, now: number = Date.now()): string {
  const dayStart = (time: number) => {
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const days = Math.round((dayStart(now) - dayStart(previousAt)) / 86_400_000);
  if (days === 0) return '今日';
  if (days === 1) return '昨日';
  const previous = new Date(previousAt);
  const sameYear = previous.getFullYear() === new Date(now).getFullYear();
  return `${sameYear ? '' : `${previous.getFullYear()}年`}${previous.getMonth() + 1}月${previous.getDate()}日`;
}
