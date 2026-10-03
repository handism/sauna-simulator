// 入室時の安静時心拍数。セッションの初期値とサウナ室の開始値で共有する
export const RESTING_HEART_RATE = 75;

export const calculateHeatIndex = (temperature: number, humidity: number): number => {
  return temperature + humidity * 0.45;
};

export const calculateTotonouScore = (saunaTime: number, waterTime: number, loylyCount: number) => {
  // サウナスコア (最大60点): 50秒以上滞在で50点、ロウリュ1回につき+5点 (上限10点)
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

// 心拍1回あたりの秒数。脈動アニメーションの周期に使う
export const beatSeconds = (heartRate: number): number => 60 / heartRate;
