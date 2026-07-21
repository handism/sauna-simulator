import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAudioEngine } from './useAudioEngine';

// --- Mocks ---

class MockAudioParam {
  value = 0;
  cancelScheduledValues = vi.fn();
  setTargetAtTime = vi.fn();
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}

class MockGainNode {
  gain = new MockAudioParam();
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
}

class MockBiquadFilterNode {
  type = 'lowpass';
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
}

class MockOscillatorNode {
  type = 'sine';
  frequency = new MockAudioParam();
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockStereoPannerNode {
  pan = new MockAudioParam();
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
}

class MockAudioBufferSourceNode {
  buffer = null;
  loop = false;
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioBuffer {
  length: number;
  sampleRate: number;
  constructor(channels: number, length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
  }
  getChannelData = vi.fn().mockImplementation(() => new Float32Array(this.length));
  copyToChannel = vi.fn();
  set = vi.fn();
}

const mockCreateGain = vi.fn(() => new MockGainNode());
const mockCreateBiquadFilter = vi.fn(() => new MockBiquadFilterNode());
const mockCreateOscillator = vi.fn(() => new MockOscillatorNode());
const mockCreateStereoPanner = vi.fn(() => new MockStereoPannerNode());
const mockCreateBufferSource = vi.fn(() => new MockAudioBufferSourceNode());
const mockCreateBuffer = vi.fn((channels, length, sampleRate) => new MockAudioBuffer(channels, length, sampleRate));

class MockAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};

  resume = vi.fn().mockResolvedValue(undefined);
  createGain = mockCreateGain;
  createBiquadFilter = mockCreateBiquadFilter;
  createOscillator = mockCreateOscillator;
  createStereoPanner = mockCreateStereoPanner;
  createBufferSource = mockCreateBufferSource;
  createBuffer = mockCreateBuffer;
}

describe('useAudioEngine', () => {
  let originalAudioContext: any;
  let originalCrypto: any;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockCreateGain.mockClear();
    mockCreateBiquadFilter.mockClear();
    mockCreateOscillator.mockClear();
    mockCreateStereoPanner.mockClear();
    mockCreateBufferSource.mockClear();
    mockCreateBuffer.mockClear();

    // Mock Web Audio API
    originalAudioContext = window.AudioContext;
    (window as any).AudioContext = MockAudioContext;
    (window as any).webkitAudioContext = MockAudioContext;

    // Mock crypto for generateSecureWhiteNoise
    originalCrypto = window.crypto;
    Object.defineProperty(window, 'crypto', {
      value: {
        getRandomValues: vi.fn((arr: Uint32Array) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 4294967295);
          }
          return arr;
        }),
      },
      writable: true,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    (window as any).AudioContext = originalAudioContext;
    (window as any).webkitAudioContext = originalAudioContext;
    Object.defineProperty(window, 'crypto', { value: originalCrypto, writable: true });
  });

  it('initializes the audio context and master gain', () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    // 1 master gain
    expect(mockCreateGain).toHaveBeenCalledTimes(1);
    const masterGain = mockCreateGain.mock.results[0].value;
    expect(masterGain.gain.value).toBe(0);
  });

  it('handles setMuted correctly', () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    const masterGain = mockCreateGain.mock.results[0].value;

    act(() => {
      result.current.setMuted(false); // Unmute
    });
    expect(masterGain.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(1, expect.any(Number), 0.08);

    act(() => {
      result.current.setMuted(true); // Mute
    });
    expect(masterGain.gain.setTargetAtTime).toHaveBeenCalledWith(0, expect.any(Number), 0.08);
  });

  it('plays sauna ambient sound', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    mockCreateGain.mockClear();

    await act(async () => {
      await result.current.playAmbient('sauna');
    });

    expect(mockCreateBuffer).toHaveBeenCalledTimes(1);
    expect(mockCreateBufferSource).toHaveBeenCalledTimes(1);
    expect(mockCreateBiquadFilter).toHaveBeenCalledTimes(1);
    expect(mockCreateGain).toHaveBeenCalledTimes(1); // One for the source

    const filter = mockCreateBiquadFilter.mock.results[0].value;
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(250);

    const source = mockCreateBufferSource.mock.results[0].value;
    expect(source.start).toHaveBeenCalled();
    expect(source.loop).toBe(true);

    const gain = mockCreateGain.mock.results[0].value;
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(0.35, expect.any(Number), 1.0);
  });

  it('plays water ambient sound', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    mockCreateGain.mockClear();

    await act(async () => {
      await result.current.playAmbient('water');
    });

    const filter = mockCreateBiquadFilter.mock.results[0].value;
    expect(filter.type).toBe('bandpass');
    expect(filter.frequency.value).toBe(1200);
    expect(filter.Q.value).toBe(0.6);

    const gain = mockCreateGain.mock.results[0].value;
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(0.45, expect.any(Number), 1.0);
  });

  it('plays totonou ambient sound (binaural beats + wind)', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    mockCreateGain.mockClear();
    mockCreateOscillator.mockClear();
    mockCreateBufferSource.mockClear();

    await act(async () => {
      await result.current.playAmbient('totonou');
    });

    // 2 sine oscillators for binaural, 1 for LFO
    expect(mockCreateOscillator).toHaveBeenCalledTimes(3);

    // 1 humGain, 1 windGain, 1 lfoGain
    expect(mockCreateGain).toHaveBeenCalledTimes(3);

    // 1 wind noise source
    expect(mockCreateBufferSource).toHaveBeenCalledTimes(1);

    const oscL = mockCreateOscillator.mock.results[0].value;
    const oscR = mockCreateOscillator.mock.results[1].value;
    const lfo = mockCreateOscillator.mock.results[2].value;

    expect(oscL.frequency.value).toBe(110);
    expect(oscR.frequency.value).toBe(112.5);
    expect(lfo.frequency.value).toBe(0.08);

    expect(oscL.start).toHaveBeenCalled();
    expect(oscR.start).toHaveBeenCalled();
    expect(lfo.start).toHaveBeenCalled();

    const windSource = mockCreateBufferSource.mock.results[0].value;
    expect(windSource.start).toHaveBeenCalled();
  });

  it('plays loyly sounds (sizzle and steam)', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    mockCreateGain.mockClear();
    mockCreateBiquadFilter.mockClear();
    mockCreateBufferSource.mockClear();

    await act(async () => {
      await result.current.playLoyly();
    });

    // Sizzle and Steam sources
    expect(mockCreateBufferSource).toHaveBeenCalledTimes(2);
    // Sizzle and Steam filters
    expect(mockCreateBiquadFilter).toHaveBeenCalledTimes(2);
    // Sizzle and Steam gains
    expect(mockCreateGain).toHaveBeenCalledTimes(2);

    const filterSizzle = mockCreateBiquadFilter.mock.results[0].value;
    expect(filterSizzle.type).toBe('highpass');
    expect(filterSizzle.frequency.setValueAtTime).toHaveBeenCalledWith(3500, expect.any(Number));

    const filterSteam = mockCreateBiquadFilter.mock.results[1].value;
    expect(filterSteam.type).toBe('bandpass');
    expect(filterSteam.frequency.setValueAtTime).toHaveBeenCalledWith(800, expect.any(Number));
  });

  it('stops previous ambient sounds when playing new one', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    await act(async () => {
      await result.current.playAmbient('sauna');
    });

    const initialSource = mockCreateBufferSource.mock.results[0].value;
    const initialGain = mockCreateGain.mock.results[1].value; // 0 is master gain, 1 is sauna gain

    await act(async () => {
      await result.current.playAmbient('water');
    });

    expect(initialGain.gain.cancelScheduledValues).toHaveBeenCalled();
    expect(initialGain.gain.setTargetAtTime).toHaveBeenCalledWith(0, expect.any(Number), 0.4);

    // Fade out takes 1200ms
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(initialSource.stop).toHaveBeenCalled();
  });

  it('catches and logs errors when fading out gains during stopAmbient', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    await act(async () => {
      await result.current.playAmbient('sauna');
    });

    const testError = new Error('Test fade out error');
    const activeGain = mockCreateGain.mock.results[mockCreateGain.mock.results.length - 1].value;
    activeGain.gain.cancelScheduledValues.mockImplementation(() => {
      throw testError;
    });

    await act(async () => {
      await result.current.playAmbient('water');
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fade out gain', testError);
  });

  it('catches and logs errors when stopping sources during stopAmbient', async () => {
    const { result } = renderHook(() => useAudioEngine());

    act(() => {
      result.current.init();
    });

    await act(async () => {
      await result.current.playAmbient('sauna');
    });

    const testError = new Error('Test stop error');
    const activeSource = mockCreateBufferSource.mock.results[mockCreateBufferSource.mock.results.length - 1].value;
    activeSource.stop.mockImplementation(() => {
      throw testError;
    });

    await act(async () => {
      await result.current.playAmbient('water');
    });

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to stop source', testError);
  });
});
