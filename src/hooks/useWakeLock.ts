import { useEffect } from 'react';

/**
 * 有効な間、画面の自動消灯を防ぐ（Screen Wake Lock API）。
 * ブラウザはタブが隠れると解除するので、表示に戻ったときに取り直す。
 * 非対応・拒否（省電力モード等）の環境では何もしない。
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return;
    let active = true;
    let sentinel: WakeLockSentinel | null = null;

    const acquire = () => {
      if (document.visibilityState !== 'visible' || (sentinel !== null && !sentinel.released)) return;
      navigator.wakeLock.request('screen').then(
        (lock) => {
          // 取得を待つ間に無効になったら、すぐに返す
          if (active) sentinel = lock;
          else void lock.release().catch(() => {});
        },
        () => {},
      );
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
