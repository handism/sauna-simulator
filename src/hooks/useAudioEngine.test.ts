import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAudioEngine } from './useAudioEngine';

describe('useAudioEngine', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockAudioContext: any;
  let gainNodes: any[] = [];

  beforeEach(() => {
    gainNodes = [];
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock Web Audio API
    mockAudioContext = {
      state: 'suspended',
      resume: vi.fn(),
      currentTime: 0,
      sampleRate: 44100,
      destination: {},
      createGain: vi.fn(() => {
        const gainNode = {
          gain: {
            value: 0,
            setTargetAtTime: vi.fn(),
            cancelScheduledValues: vi.fn(),
          },
          connect: vi.fn(),
        };
        gainNodes.push(gainNode);
        return gainNode;
      }),
      createBuffer: vi.fn(() => ({
        getChannelData: vi.fn(() => new Float32Array(44100)),
      })),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        loop: false,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createBiquadFilter: vi.fn(() => ({
        type: 'lowpass',
        frequency: { value: 0 },
        Q: { value: 0 },
        connect: vi.fn(),
      })),
      createOscillator: vi.fn(() => ({
        type: 'sine',
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
      })),
    };

    vi.stubGlobal('AudioContext', vi.fn().mockImplementation(function() { return mockAudioContext; }));

    // Mock crypto for generateSecureWhiteNoise
    Object.defineProperty(window, 'crypto', {
      value: {
        getRandomValues: vi.fn((arr: any) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 4294967296);
          }
          return arr;
        })
      },
      writable: true
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('catches and logs errors when fading out gains during stopAmbient', () => {
    const { result } = renderHook(() => useAudioEngine());

    // Initialize AudioContext
    act(() => {
      result.current.init();
    });

    // Populate activeGainsRef by calling playAmbient
    act(() => {
      result.current.playAmbient('sauna');
    });

    // We expect gainNodes to be populated
    expect(gainNodes.length).toBeGreaterThan(0);

    // Mock cancelScheduledValues to throw an error
    const testError = new Error('Test fade out error');
    // The active gain is the last one created (after master gain)
    const activeGain = gainNodes[gainNodes.length - 1];
    activeGain.gain.cancelScheduledValues = vi.fn().mockImplementation(() => {
      throw testError;
    });

    // Call playAmbient again to trigger stopAmbient internally
    act(() => {
      result.current.playAmbient('water');
    });

    // Verify console.error was called with the correct message and error
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fade out gain', testError);
  });
});
