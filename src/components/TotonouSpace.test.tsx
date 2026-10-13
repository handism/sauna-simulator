import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import TotonouSpace from './TotonouSpace';
import { calculateTotonouScore } from '../utils/saunaUtils';

describe('calculateTotonouScore', () => {
  it('should calculate perfect score correctly', () => {
    // 50s sauna = 50 pts, 20s water = 40 pts, 2 loyly = 10 pts
    const { maxTotonou, feedback } = calculateTotonouScore(50, 20, 2);
    expect(maxTotonou).toBe(100);
    expect(feedback).toBe('深い余韻を、そのままゆっくり味わって。');
  });

  it('should not exceed max values for sauna and water score', () => {
    // 100s sauna = max 50 pts, 50s water = max 40 pts, 5 loyly = max 10 pts -> total max 100
    const { maxTotonou, feedback } = calculateTotonouScore(100, 50, 5);
    expect(maxTotonou).toBe(100);
    expect(feedback).toBe('深い余韻を、そのままゆっくり味わって。');
  });

  it('should handle saunaTime < 15 correctly', () => {
    // 10s sauna = 10 pts, 20s water = 40 pts, 0 loyly = 0 pts -> total 50
    const { maxTotonou, feedback } = calculateTotonouScore(10, 20, 0);
    expect(maxTotonou).toBe(50);
    expect(feedback).toBe('短いひと息も、大切な休息です。');
  });

  it('should handle waterTime < 8 correctly', () => {
    // 50s sauna = 50 pts, 5s water = 10 pts, 0 loyly = 0 pts -> total 60
    const { maxTotonou, feedback } = calculateTotonouScore(50, 5, 0);
    expect(maxTotonou).toBe(60);
    expect(feedback).toBe('自分のペースで、風に身を任せて。');
  });

  it('should return 70s feedback', () => {
    // 35s sauna = 35 pts, 18s water = 36 pts, 0 loyly = 0 pts -> total 71
    const { maxTotonou, feedback } = calculateTotonouScore(35, 18, 0);
    expect(maxTotonou).toBe(71);
    expect(feedback).toBe('心地よい余韻が広がっています。');
  });

  it('should handle default feedback correctly', () => {
    // 20s sauna = 20 pts, 10s water = 20 pts, 0 loyly = 0 pts -> total 40
    const { maxTotonou, feedback } = calculateTotonouScore(20, 10, 0);
    expect(maxTotonou).toBe(40);
    expect(feedback).toBe('心地よい休息です。このまま、ひと息。');
  });

  it('should handle 0 inputs correctly', () => {
    // 0s sauna = 0 pts, 0s water = 0 pts, 0 loyly = 0 pts -> total 0
    const { maxTotonou, feedback } = calculateTotonouScore(0, 0, 0);
    expect(maxTotonou).toBe(0);
    // saunaTime < 15 triggers the sauna error message
    expect(feedback).toBe('短いひと息も、大切な休息です。');
  });

  it('should calculate partial loyly score correctly', () => {
    // 50s sauna = 50 pts, 20s water = 40 pts, 1 loyly = 5 pts -> total 95
    const { maxTotonou, feedback } = calculateTotonouScore(50, 20, 1);
    expect(maxTotonou).toBe(95);
    expect(feedback).toBe('深い余韻を、そのままゆっくり味わって。');
  });

  it('should handle edge cases strictly around sauna 15s and water 8s boundaries', () => {
    // Exactly 15s sauna = 15 pts, exactly 8s water = 16 pts, 0 loyly = 0 pts -> total 31
    const { maxTotonou, feedback } = calculateTotonouScore(15, 8, 0);
    expect(maxTotonou).toBe(31);
    expect(feedback).toBe('心地よい休息です。このまま、ひと息。');
  });
});

describe('TotonouSpace Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the tier name and feedback without anything to open', () => {
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />);
    expect(screen.getByText('外気浴')).toBeInTheDocument();
    expect(screen.getByText('深い余韻')).toBeVisible();
    expect(screen.getByText('深い余韻を、そのままゆっくり味わって。')).toBeVisible();
    expect(screen.queryByText('スコア', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText('吸って…')).toBeInTheDocument();
  });

  it('should change breathing text cyclically', () => {
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />);
    expect(screen.getByText('吸って…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('吐いて…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText('吸って…')).toBeInTheDocument();
  });

  it('should call onNext when button is clicked', () => {
    const mockOnNext = vi.fn();
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={mockOnNext} />);

    fireEvent.click(screen.getByRole('button', { name: /もう一度サウナへ/ }));
    expect(mockOnNext).toHaveBeenCalledTimes(1);
  });

  it('returns to the sauna with the Space key', () => {
    const mockOnNext = vi.fn();
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={mockOnNext} />);

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(mockOnNext).toHaveBeenCalledTimes(1);
  });

  it('shows the set number and leaves the per-set scores to the end screen', () => {
    render(<TotonouSpace saunaTime={35} waterTime={18} loylyCount={0} scoreHistory={[50, 71]} onNext={() => {}} />);
    expect(screen.getByText('2セット目')).toBeInTheDocument();
    expect(screen.getByText('心地よい余韻')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'セットごとのととのい度' })).not.toBeInTheDocument();
  });
});
