export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + (humidity * 0.45);
};

/**
 * Cryptographically secure random number generator in [0, 1) range,
 * equivalent to Math.random() but using Web Crypto API when available.
 */
export const getSecureRandom = (): number => {
  const cryptoObj =
    typeof globalThis !== 'undefined' && globalThis.crypto
      ? globalThis.crypto
      : typeof window !== 'undefined'
      ? window.crypto
      : undefined;

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const array = new Uint32Array(1);
    cryptoObj.getRandomValues(array);
    return array[0] / (0xffffffff + 1);
  }

  return Math.random();
};

export const calculateTotonouScore = (saunaTime: number, waterTime: number, loylyCount: number) => {
  // サウナスコア (最大55点): 50秒以上滞在で満点、ロウリュ1回につき+5点
  const saunaScore = Math.min(saunaTime / 50, 1.0) * 50 + Math.min(loylyCount * 5, 10);
  // 水風呂スコア (最大40点): 20秒以上滞在で満点
  const waterScore = Math.min(waterTime / 20, 1.0) * 40;

  const totalScore = Math.min(Math.round(saunaScore + waterScore), 100);

  // スコアに応じたフィードバック
  let text = '';
  if (totalScore >= 90) {
    text = '完璧な温冷交代浴です！ディープリラックスの境地へ... 🌌';
  } else if (totalScore >= 70) {
    text = 'しっかり「ととのい」の波が押し寄せています 🧘';
  } else if (saunaTime < 15) {
    text = 'サウナ室の温まりが少し足りなかったようです。次はじっくり汗を流しましょう 🔥';
  } else if (waterTime < 8) {
    text = '水風呂の冷却が短かったようです。羽衣を感じるまで浸かってみましょう 💧';
  } else {
    text = '心地よい休息です。回数を重ねて自分のペースを見つけましょう 🍃';
  }

  return { maxTotonou: totalScore, feedback: text };
};
