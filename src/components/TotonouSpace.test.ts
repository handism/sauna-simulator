import { describe, it, expect } from 'vitest';
import { calculateTotonouScore } from './TotonouSpace';

describe('calculateTotonouScore', () => {
  it('should calculate perfect score correctly', () => {
    // 50s sauna = 50 pts, 20s water = 40 pts, 2 loyly = 10 pts
    const { maxTotonou, feedback } = calculateTotonouScore(50, 20, 2);
    expect(maxTotonou).toBe(100);
    expect(feedback).toBe('完璧な温冷交代浴です！ディープリラックスの境地へ... 🌌');
  });

  it('should not exceed max values for sauna and water score', () => {
    // 100s sauna = max 50 pts, 50s water = max 40 pts, 5 loyly = max 10 pts -> total max 100
    const { maxTotonou, feedback } = calculateTotonouScore(100, 50, 5);
    expect(maxTotonou).toBe(100);
    expect(feedback).toBe('完璧な温冷交代浴です！ディープリラックスの境地へ... 🌌');
  });

  it('should handle saunaTime < 15 correctly', () => {
    // 10s sauna = 10 pts, 20s water = 40 pts, 0 loyly = 0 pts -> total 50
    const { maxTotonou, feedback } = calculateTotonouScore(10, 20, 0);
    expect(maxTotonou).toBe(50);
    expect(feedback).toBe('サウナ室の温まりが少し足りなかったようです。次はじっくり汗を流しましょう 🔥');
  });

  it('should handle waterTime < 8 correctly', () => {
    // 50s sauna = 50 pts, 5s water = 10 pts, 0 loyly = 0 pts -> total 60
    const { maxTotonou, feedback } = calculateTotonouScore(50, 5, 0);
    expect(maxTotonou).toBe(60);
    expect(feedback).toBe('水風呂の冷却が短かったようです。羽衣を感じるまで浸かってみましょう 💧');
  });

  it('should return 70s feedback', () => {
    // 35s sauna = 35 pts, 18s water = 36 pts, 0 loyly = 0 pts -> total 71
    const { maxTotonou, feedback } = calculateTotonouScore(35, 18, 0);
    expect(maxTotonou).toBe(71);
    expect(feedback).toBe('しっかり「ととのい」の波が押し寄せています 🧘');
  });

  it('should handle default feedback correctly', () => {
    // 20s sauna = 20 pts, 10s water = 20 pts, 0 loyly = 0 pts -> total 40
    const { maxTotonou, feedback } = calculateTotonouScore(20, 10, 0);
    expect(maxTotonou).toBe(40);
    expect(feedback).toBe('心地よい休息です。回数を重ねて自分のペースを見つけましょう 🍃');
  });

  it('should handle 0 inputs correctly', () => {
    // 0s sauna = 0 pts, 0s water = 0 pts, 0 loyly = 0 pts -> total 0
    const { maxTotonou, feedback } = calculateTotonouScore(0, 0, 0);
    expect(maxTotonou).toBe(0);
    // saunaTime < 15 triggers the sauna error message
    expect(feedback).toBe('サウナ室の温まりが少し足りなかったようです。次はじっくり汗を流しましょう 🔥');
  });

  it('should calculate partial loyly score correctly', () => {
    // 50s sauna = 50 pts, 20s water = 40 pts, 1 loyly = 5 pts -> total 95
    const { maxTotonou, feedback } = calculateTotonouScore(50, 20, 1);
    expect(maxTotonou).toBe(95);
    expect(feedback).toBe('完璧な温冷交代浴です！ディープリラックスの境地へ... 🌌');
  });

  it('should handle edge cases strictly around sauna 15s and water 8s boundaries', () => {
    // Exactly 15s sauna = 15 pts, exactly 8s water = 16 pts, 0 loyly = 0 pts -> total 31
    const { maxTotonou, feedback } = calculateTotonouScore(15, 8, 0);
    expect(maxTotonou).toBe(31);
    expect(feedback).toBe('心地よい休息です。回数を重ねて自分のペースを見つけましょう 🍃');
  });
});
