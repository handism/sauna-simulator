import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import SaunaRoom from './SaunaRoom';

// Mock the AudioEngine
const mockAudioEngine = {
  playLoyly: vi.fn(),
  playWater: vi.fn(),
  playHeartbeat: vi.fn(),
  stopHeartbeat: vi.fn(),
  setHeartbeatRate: vi.fn(),
};

describe('SaunaRoom', () => {
  const mockOnNext = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  it('renders initial state correctly', () => {
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);

    // Temperature: 90°C, Humidity: 15%
    expect(screen.getByText('90.0°C')).toBeInTheDocument();
    expect(screen.getByText('15%')).toBeInTheDocument();
    // Heart rate initial: 75
    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  it('updates state periodically', () => {
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    // Total 10 seconds: temp drop 0.05 * 10 = 0.5. 90 - 0.5 = 89.5
    expect(screen.getByText('89.5°C')).toBeInTheDocument();

    // Hum drops 0.4 per second. 15 -> 14.6 -> ... -> 12
    expect(screen.getByText('12%')).toBeInTheDocument();

    // Heart rate increases
    const hrElement = screen.getByText(/BPM/i).parentElement;
    expect(hrElement).not.toHaveTextContent('75 BPM');
  });

  it('handles Loyly button interaction', () => {
    const onLoyly = vi.fn();
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} onLoyly={onLoyly} />);

    const loylyBtn = screen.getByRole('button', { name: /^ロウリュ$/ });
    act(() => {
      fireEvent.click(loylyBtn);
    });

    expect(mockAudioEngine.playLoyly).toHaveBeenCalledTimes(1);
    expect(onLoyly).toHaveBeenCalledTimes(1);
    // Temperature +3, Humidity +25
    expect(screen.getByText('93.0°C')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('shows how much each Löyly raised the readings, without the part clipped at the maximum', () => {
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);
    const loylyBtn = screen.getByRole('button', { name: /^ロウリュ$/ });

    act(() => {
      fireEvent.click(loylyBtn);
    });
    expect(screen.getByText('+3.0')).toBeInTheDocument();
    expect(screen.getByText('+25')).toBeInTheDocument();

    // 40% -> 65% -> 90% (max): the third pour can only show what is left.
    act(() => {
      fireEvent.click(loylyBtn);
    });
    act(() => {
      fireEvent.click(loylyBtn);
    });
    expect(screen.getByText('90%')).toBeInTheDocument();
    act(() => {
      fireEvent.click(loylyBtn);
    });
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
  });

  it('shows the elapsed time against the suggested stay', () => {
    const { container } = render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);
    const value = container.querySelector('.stay-timer-value');
    // The suggestion sits next to the reading; screen readers hear what the second figure means.
    expect(value).toHaveTextContent('0:00 · 目安 50秒');
    expect(screen.queryByText('目安に届きました')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(value).toHaveTextContent('0:50 · 目安 50秒');
    expect(screen.getByText('目安に届きました')).toBeInTheDocument();
  });

  it('pours Löyly with the Space key', () => {
    const onLoyly = vi.fn();
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} onLoyly={onLoyly} />);

    act(() => {
      fireEvent.keyDown(document.body, { key: ' ' });
    });

    expect(mockAudioEngine.playLoyly).toHaveBeenCalledTimes(1);
    expect(onLoyly).toHaveBeenCalledTimes(1);
    expect(screen.getByText('93.0°C')).toBeInTheDocument();
    expect(mockOnNext).not.toHaveBeenCalled();
  });

  it('ignores the Space key while the stage is fading out', () => {
    render(
      <div inert>
        <SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />
      </div>,
    );

    fireEvent.keyDown(document.body, { key: ' ' });
    expect(mockAudioEngine.playLoyly).not.toHaveBeenCalled();
  });

  it('removes every steam particle after rapid Loyly presses', () => {
    const { container } = render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);
    const loylyBtn = screen.getByRole('button', { name: /^ロウリュ$/ });

    // Same millisecond, then a second press before the first particle expires.
    act(() => {
      fireEvent.click(loylyBtn);
      fireEvent.click(loylyBtn);
    });
    act(() => {
      vi.advanceTimersByTime(1000);
      fireEvent.click(loylyBtn);
    });
    expect(container.querySelectorAll('.sauna-steam-particle')).toHaveLength(3);

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(container.querySelectorAll('.sauna-steam-particle')).toHaveLength(0);
  });

  it('restarts the steam overlay animation on every Loyly press', () => {
    const { container } = render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);
    const loylyButton = screen.getByRole('button', { name: 'ロウリュ' });

    expect(container.querySelector('.steam-overlay')).not.toHaveClass('active');

    fireEvent.click(loylyButton);
    const firstOverlay = container.querySelector('.steam-overlay');
    expect(firstOverlay).toHaveClass('active');

    fireEvent.click(loylyButton);
    const secondOverlay = container.querySelector('.steam-overlay');
    expect(secondOverlay).toHaveClass('active');
    // A fresh element makes the CSS animation start over
    expect(secondOverlay).not.toBe(firstOverlay);
  });

  it('handles leave button interaction and passes correct stats', () => {
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);

    // Advance 5 seconds to increase duration
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const loylyBtn = screen.getByRole('button', { name: /^ロウリュ$/ });
    act(() => {
      fireEvent.click(loylyBtn); // loylyCount = 1
    });

    const leaveBtn = screen.getByRole('button', { name: /水風呂へ/i });
    act(() => {
      fireEvent.click(leaveBtn);
    });

    // After 5 seconds and 1 loyly, heartRate will be around 75 + some increase
    // just check it's called with expected shape
    expect(mockOnNext).toHaveBeenCalledTimes(1);
    const [{ heartRate, saunaTime: duration, loylyCount }] = mockOnNext.mock.calls[0];

    expect(typeof heartRate).toBe('number');
    expect(heartRate).toBeGreaterThan(75);
    expect(duration).toBe(5);
    expect(loylyCount).toBe(1);
  });

  it('shows the current set and the Löyly rise for the compact dock', () => {
    render(<SaunaRoom audio={mockAudioEngine as any} setNumber={2} onNext={mockOnNext} />);
    expect(screen.getByText('2セット目')).toBeInTheDocument();
    expect(screen.getByText('3段階中1番目')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ロウリュ/ }));
    expect(screen.getByText('温度 +3.0 · 湿度 +25')).toBeInTheDocument();
  });
});
