// 入室時の安静時心拍数。セッションの初期値とサウナ室の開始値で共有する
export const RESTING_HEART_RATE = 75;

export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + humidity * 0.45;
};

// ととのい度の段階。フィードバック文と外気浴の表示色で共有する
export const TOTONOU_TIERS = {
  EXCELLENT: 90,
  GOOD: 70,
} as const;

export const calculateTotonouScore = (saunaTime: number, waterTime: number, loylyCount: number) => {
  // サウナスコア (最大60点): 50秒以上滞在で50点、ロウリュ1回につき+5点 (上限10点)
  const saunaScore = Math.min(saunaTime / 50, 1.0) * 50 + Math.min(loylyCount * 5, 10);
  // 水風呂スコア (最大40点): 20秒以上滞在で満点
  const waterScore = Math.min(waterTime / 20, 1.0) * 40;

  const totalScore = Math.min(Math.round(saunaScore + waterScore), 100);

  // スコアに応じたフィードバック
  let text = '';
  if (totalScore >= TOTONOU_TIERS.EXCELLENT) {
    text = '深い余韻を、そのままゆっくり味わって。';
  } else if (totalScore >= TOTONOU_TIERS.GOOD) {
    text = '心地よい余韻が広がっています。';
  } else if (saunaTime < 15) {
    text = '短いひと息も、大切な休息です。';
  } else if (waterTime < 8) {
    text = '自分のペースで、風に身を任せて。';
  } else {
    text = '心地よい休息です。このまま、ひと息。';
  }

  return { maxTotonou: totalScore, feedback: text };
};

// 心拍1回あたりの秒数。脈動アニメーションの周期に使う
export const beatSeconds = (heartRate: number): number => 60 / heartRate;
