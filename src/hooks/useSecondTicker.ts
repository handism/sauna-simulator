import { useEffect, useEffectEvent, useRef } from 'react';

/**
 * マウント中は1秒ごとに経過秒数を数え、onTick を呼ぶ。
 * 経過秒数は再描画を起こさない ref で返す（ステージ完了時に読むだけのため）。
 */
export function useSecondTicker(onTick: () => void) {
  const secondsRef = useRef<number>(0);
  const tick = useEffectEvent(onTick);

  useEffect(() => {
    const interval = setInterval(() => {
      secondsRef.current += 1;
      tick();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return secondsRef;
}
