import { useRef, useCallback } from 'react';

export interface AudioEngine {
  init: () => void;
  playAmbient: (env: string) => void;
  playLoyly: () => void;
}

export function useAudioEngine(): AudioEngine {
  const ctxRef = useRef<AudioContext | null>(null);
  const ambientNodesRef = useRef<{
    source: AudioBufferSourceNode | OscillatorNode | { stop: () => void };
    filter?: BiquadFilterNode;
    gain: GainNode;
  } | null>(null);
  const currentEnvRef = useRef<string>('none');

  const init = useCallback(() => {
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }
  }, []);

  const stopAmbient = () => {
    if (ambientNodesRef.current) {
      const { source, gain } = ambientNodesRef.current;
      if (ctxRef.current) {
        gain.gain.setTargetAtTime(0, ctxRef.current.currentTime, 0.5);
      }
      setTimeout(() => {
        try { source.stop(); } catch(e){}
      }, 1000);
      ambientNodesRef.current = null;
    }
  };

  const playAmbient = useCallback((env: string) => {
    if (!ctxRef.current) return;
    const ctx = ctxRef.current;
    
    stopAmbient();
    currentEnvRef.current = env;

    if (env === 'sauna' || env === 'water') {
      // Brown noise generator
      const bufferSize = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (lastOut + (0.02 * white)) / 1.02;
        lastOut = data[i];
        data[i] *= 3.5;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = env === 'sauna' ? 'lowpass' : 'bandpass';
      filter.frequency.value = env === 'sauna' ? 300 : 1500;
      if (env === 'water') {
         filter.Q.value = 0.5;
      }

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(env === 'sauna' ? 0.3 : 0.4, ctx.currentTime, 1);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start();

      ambientNodesRef.current = { source, filter, gain };

    } else if (env === 'totonou') {
      const source = ctx.createOscillator();
      source.type = 'sine';
      source.frequency.value = 110; // low deep hum (A2)
      
      const source2 = ctx.createOscillator();
      source2.type = 'sine';
      source2.frequency.value = 112; // binaural beats effect

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.2, ctx.currentTime, 2);

      source.connect(gain);
      source2.connect(gain);
      gain.connect(ctx.destination);
      source.start();
      source2.start();

      ambientNodesRef.current = { 
        source: {
          stop: () => { source.stop(); source2.stop(); }
        }, 
        gain 
      };
    }
  }, []);

  const playLoyly = useCallback(() => {
    if (!ctxRef.current) return;
    const ctx = ctxRef.current;
    
    // Quick burst of white noise for steam sizzle
    const bufferSize = ctx.sampleRate * 1.5;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(3000, ctx.currentTime + 1.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.5);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    source.start();
    source.stop(ctx.currentTime + 1.5);
  }, []);

  return { init, playAmbient, playLoyly };
}
