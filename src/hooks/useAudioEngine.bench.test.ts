import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioEngine } from './useAudioEngine';

// Make sure mocked objects chain properly
const createMockGain = () => {
  const gain = {
    gain: { value: 1, setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn((node) => node)
  };
  return gain;
};

const mockCreateGain = vi.fn(createMockGain);

const mockCreateBiquadFilter = vi.fn(() => ({
  connect: vi.fn((node) => node),
  frequency: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  Q: { value: 1 },
  type: 'lowpass'
}));
const mockCreateOscillator = vi.fn(() => ({
  connect: vi.fn((node) => node),
  start: vi.fn(),
  frequency: { value: 1 }
}));
const mockCreateStereoPanner = vi.fn(() => ({ pan: { value: 1 } }));
const mockCreateBufferSource = vi.fn(() => ({
  connect: vi.fn((node) => node),
  start: vi.fn(),
  stop: vi.fn(),
  buffer: null
}));
const mockCreateBuffer = vi.fn((channels, length, sampleRate) => ({
  copyToChannel: vi.fn()
}));

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

const originalAudioContext = window.AudioContext;
(window as any).AudioContext = MockAudioContext;

describe('useAudioEngine performance', () => {
  let mockWorkerPostMessage: any;
  let originalWorker: any;
  let originalCrypto: any;

  beforeEach(() => {
    mockWorkerPostMessage = vi.fn();
    originalWorker = (window as any).Worker;

    class MockWorker {
      onmessage: any = null;
      postMessage = (data: any) => {
        mockWorkerPostMessage(data);
        setTimeout(() => {
          if (this.onmessage) {
            this.onmessage({ data: { id: data.id, data: new Float32Array(data.length) } });
          }
        }, 100);
      };
    }

    (window as any).Worker = MockWorker;

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
    (window as any).Worker = originalWorker;
    Object.defineProperty(window, 'crypto', { value: originalCrypto, writable: true });
  });

  it('should not spawn multiple worker tasks for the same buffer concurrently', async () => {
    const { result } = renderHook(() => useAudioEngine());
    act(() => { result.current.init(); });

    // Trigger multiple playLoyly which needs whiteNoise buffer
    await act(async () => {
      const p1 = result.current.playLoyly();
      const p2 = result.current.playLoyly();
      const p3 = result.current.playLoyly();
      const p4 = result.current.playLoyly();
      const p5 = result.current.playLoyly();
      await Promise.all([p1, p2, p3, p4, p5]);
    });

    console.log(`Worker postMessage calls: ${mockWorkerPostMessage.mock.calls.length}`);
    expect(mockWorkerPostMessage).toHaveBeenCalledTimes(1);
  });
});
