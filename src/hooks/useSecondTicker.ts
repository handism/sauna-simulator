import { useEffect, useEffectEvent, useState } from 'react';

/**
 * マウント中は1秒ごとに経過秒数を数え、onTick を呼ぶ。
 * 経過秒数は画面の滞在時間表示にも使うため state で返す。
 */
export function useSecondTicker(onTick: () => void) {
  const [seconds, setSeconds] = useState<number>(0);
  const tick = useEffectEvent(onTick);

  useEffect(() => {
    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
      tick();
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return seconds;
}
