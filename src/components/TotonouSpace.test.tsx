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
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reveals the final score immediately when reduced motion is requested', () => {
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList);
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { container } = render(
      <TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />,
    );
    fireEvent.click(screen.getByText('体験内のスコアを見る'));
    expect(container.querySelector('.totonou-progress-val')).toHaveTextContent('100%');
    expect(container.querySelector('.totonou-progress-bar')).toHaveStyle({ width: '100%' });
    expect(raf).not.toHaveBeenCalled();
  });

  it('should render correctly and display initial breathing text', () => {
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />);
    expect(screen.getByText('外気浴')).toBeInTheDocument();
    expect(screen.getByText('風の音に身を任せて')).toBeInTheDocument();
    expect(screen.getByText('吸って…')).toBeInTheDocument();
  });

  it('should change breathing text cyclically', () => {
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />);

    // Initially "吸って…"
    expect(screen.getByText('吸って…')).toBeInTheDocument();

    // Advance by 4000ms
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // Should change to "吐いて…"
    expect(screen.getByText('吐いて…')).toBeInTheDocument();

    // Advance by another 4000ms
    act(() => {
      vi.advanceTimersByTime(4000);
    });

    // Should change back to "吸って…"
    expect(screen.getByText('吸って…')).toBeInTheDocument();
  });

  it('should call onNext when button is clicked', () => {
    const mockOnNext = vi.fn();
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={mockOnNext} />);

    const button = screen.getByRole('button', { name: /もう一度サウナへ/ });
    fireEvent.click(button);
    expect(mockOnNext).toHaveBeenCalledTimes(1);
  });

  it('returns to the sauna with the Space key', () => {
    const mockOnNext = vi.fn();
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={mockOnNext} />);

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(mockOnNext).toHaveBeenCalledTimes(1);
  });

  it('announces the feedback through a polite live region', () => {
    render(<TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />);
    const feedback = '深い余韻を、そのままゆっくり味わって。';
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    // The meter only starts rising once the reflection is opened.
    expect(screen.queryByText(feedback)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('今回の休息を振り返る'));
    fireEvent.click(screen.getByText('体験内のスコアを見る'));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByText(feedback).closest('[aria-live="polite"]')).not.toBeNull();
  });

  it('shows the set number and, from the second set, each set score', () => {
    const { unmount } = render(
      <TotonouSpace saunaTime={50} waterTime={20} loylyCount={2} scoreHistory={[100]} onNext={() => {}} />,
    );
    expect(screen.getByText('1セット目')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'セットごとのととのい度' })).not.toBeInTheDocument();
    unmount();

    render(<TotonouSpace saunaTime={35} waterTime={18} loylyCount={0} scoreHistory={[50, 71]} onNext={() => {}} />);
    expect(screen.getByText('2セット目')).toBeInTheDocument();
    fireEvent.click(screen.getByText('今回の休息を振り返る'));
    fireEvent.click(screen.getByText('体験内のスコアを見る'));
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['50%1セット', '71%2セット']);
    // 71 is in the same tier as the "心地よい余韻" feedback, so its column shares that tier's color.
    const bar = (item: HTMLElement) => item.querySelector('.score-history-bar');
    expect(bar(items[1])).toHaveStyle({ background: '#b9d1d4', height: '28.4px' });
    expect(bar(items[0])).toHaveStyle({ background: '#e2cfb4', height: '20px' });
  });
});
