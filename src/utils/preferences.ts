// 表示設定は任意の保存先。ストレージが無効な環境（プライベートモード等）では既定値で動作する。

export function readPreference<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.find((value) => value === saved) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Optional preference. */
  }
}
