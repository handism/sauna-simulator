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
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);

    const loylyBtn = screen.getByRole('button', { name: /ロウリュ \(Löyly\)/i });
    act(() => {
      fireEvent.click(loylyBtn);
    });

    expect(mockAudioEngine.playLoyly).toHaveBeenCalled();
    // Temperature +3, Humidity +25
    expect(screen.getByText('93.0°C')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('handles leave button interaction and passes correct stats', () => {
    render(<SaunaRoom audio={mockAudioEngine as any} onNext={mockOnNext} />);

    // Advance 5 seconds to increase duration
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const loylyBtn = screen.getByRole('button', { name: /ロウリュ \(Löyly\)/i });
    act(() => {
      fireEvent.click(loylyBtn); // loylyCount = 1
    });

    const leaveBtn = screen.getByRole('button', { name: /限界.. 水風呂へ 💧/i });
    act(() => {
      fireEvent.click(leaveBtn);
    });

    // After 5 seconds and 1 loyly, heartRate will be around 75 + some increase
    // just check it's called with expected shape
    expect(mockOnNext).toHaveBeenCalledTimes(1);
    const [heartRate, duration, loylyCount] = mockOnNext.mock.calls[0];

    expect(typeof heartRate).toBe('number');
    expect(heartRate).toBeGreaterThan(75);
    expect(duration).toBe(5);
    expect(loylyCount).toBe(1);
  });
});
