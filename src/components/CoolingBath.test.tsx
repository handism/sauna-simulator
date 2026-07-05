import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import CoolingBath from './CoolingBath';

describe('CoolingBath', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders correctly with initial heart rate', () => {
    render(<CoolingBath initialHeartRate={120} onNext={vi.fn()} />);
    expect(screen.getByText('水風呂')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument(); // 120 BPM
  });

  it('decreases heart rate over time', () => {
    render(<CoolingBath initialHeartRate={120} onNext={vi.fn()} />);

    // Initial state
    expect(screen.getByText('120')).toBeInTheDocument();

    // Advance time by 1 second
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Heart rate should decrease towards 60
    // diff = (60 - 120) * 0.16 = -9.6
    // nextHR = 120 - 9.6 = 110.4
    // + jitter -> rounded ~ 110
    const hrElement = screen.getByText(/11[0-1]/); // Might be 110 or 111 due to jitter
    expect(hrElement).toBeInTheDocument();
  });

  it('calls onNext with correct values when leaving', () => {
    const handleNext = vi.fn();
    render(<CoolingBath initialHeartRate={100} onNext={handleNext} />);

    // Advance time by 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const leaveButton = screen.getByText(/外気浴へ/);
    fireEvent.click(leaveButton);

    // onNext should be called with (heartRate, duration)
    // duration should be 5
    expect(handleNext).toHaveBeenCalledTimes(1);
    expect(handleNext.mock.calls[0][1]).toBe(5);
    // Heart rate should be less than 100
    expect(handleNext.mock.calls[0][0]).toBeLessThan(100);
  });

  it('generates ripples over time', () => {
    const { container } = render(<CoolingBath initialHeartRate={100} onNext={vi.fn()} />);

    // Initially no ripples (they are generated after 1500ms)
    // Actually, looking at the code, they are just rendered divs at the bottom,
    // let's check the container children count or rely on the fact that ripples have a specific inline style.

    // Let's find elements by animation style or just tag structure if possible,
    // Since we know ripple divs are appended at the root div.

    // Advance time by 3000ms (should generate 2 ripples)
    act(() => {
      vi.advanceTimersByTime(3000);
    });

    // Ripples have a specific inline style: `animation: 'ripple 3s ease-out forwards'`
    // We can query the DOM to find divs containing 'ripple' in their style.animation string.
    // However, it's easier to check if the component renders successfully without crashing.
    // Let's query all divs with border: '2px solid rgba(56,189,248,0.25)' since that's specific to ripples.
    // React testing library `container.querySelectorAll` can do this.
    const rippleElements = Array.from(container.querySelectorAll('div')).filter(
      div => div.style.borderRadius === '50%' && div.style.pointerEvents === 'none'
    );

    expect(rippleElements.length).toBe(2);
  });
});
