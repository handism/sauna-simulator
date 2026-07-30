import { useRef, useCallback, useMemo } from "react";
import AudioWorker from "./audioWorker?worker";

export type AmbientEnv = "sauna" | "water" | "totonou";

export interface AudioEffectSettings {
  type: BiquadFilterType;
  frequency: number;
  gain?: number;
  Q?: number;
}

export interface EnvironmentConfig {
  filterSettings: AudioEffectSettings;
  targetGain: number;
  noiseType: "whiteNoise" | "saunaNoise" | "windNoise";
}

export interface BinauralBeatConfig {
  frequencyLeft: number;
  frequencyRight: number;
  panLeft: number;
  panRight: number;
  targetGain: number;
  timeConstant: number;
}

export interface WindNoiseConfig {
  filterSettings: AudioEffectSettings;
  baseGain: number;
  lfoFrequency: number;
  lfoGain: number;
}

export interface AudioPresets {
  sauna: EnvironmentConfig;
  water: EnvironmentConfig;
  totonouBinaural: BinauralBeatConfig;
  totonouWind: WindNoiseConfig;
}

export const AUDIO_PRESETS: AudioPresets = {
  sauna: {
    filterSettings: {
      type: "lowpass",
      frequency: 250,
    },
    targetGain: 0.35,
    noiseType: "saunaNoise",
  },
  water: {
    filterSettings: {
      type: "bandpass",
      frequency: 1200,
      Q: 0.6,
    },
    targetGain: 0.45,
    noiseType: "saunaNoise",
  },
  totonouBinaural: {
    frequencyLeft: 110,
    frequencyRight: 112.5,
    panLeft: -0.8,
    panRight: 0.8,
    targetGain: 0.25,
    timeConstant: 2.0,
  },
  totonouWind: {
    filterSettings: {
      type: "lowpass",
      frequency: 200,
    },
    baseGain: 0.04,
    lfoFrequency: 0.08,
    lfoGain: 0.03,
  },
};

export interface AudioEngine {
  init: () => void;
  playAmbient: (env: AmbientEnv) => void;
  playLoyly: () => void;
  setMuted: (muted: boolean) => void;
}

let audioWorker: Worker | null = null;
let msgIdCounter = 0;
type ResolverType = {
  resolve: (data: Float32Array<ArrayBuffer>) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};
const resolvers = new Map<number, ResolverType>();
const ongoingGenerations = new Map<string, Promise<Float32Array<ArrayBuffer>>>();

// A wrapper to handle concurrent requests to the worker
function generateBufferAsync(
  type: "whiteNoise" | "saunaNoise" | "windNoise",
  length: number,
): Promise<Float32Array<ArrayBuffer>> {
  const cacheKey = `${type}-${length}`;
  const existingPromise = ongoingGenerations.get(cacheKey);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = new Promise<Float32Array<ArrayBuffer>>((resolve, reject) => {
    if (!audioWorker) {
      audioWorker = new AudioWorker();
      audioWorker.onmessage = (e) => {
        const { id, data } = e.data;
        const resolver = resolvers.get(id);
        if (resolver) {
          clearTimeout(resolver.timeoutId);
          resolver.resolve(data);
          resolvers.delete(id);
        }
      };
      audioWorker.onerror = (e) => {
        console.error("AudioWorker error:", e);
      };
    }

    const id = msgIdCounter++;
    const timeoutId = setTimeout(() => {
      resolvers.delete(id);
      reject(new Error(`Worker timeout for message id ${id}`));
    }, 10000);

    resolvers.set(id, { resolve, reject, timeoutId });
    audioWorker.postMessage({ id, type, length });
  }).finally(() => {
    ongoingGenerations.delete(cacheKey);
  });

  ongoingGenerations.set(cacheKey, promise);
  return promise;
}

export function useAudioEngine(): AudioEngine {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // 稼働中のソースとゲインを追跡し、フェードアウト後に安全に停止する
  const activeSourcesRef = useRef<{ stop: () => void }[]>([]);
  const activeGainsRef = useRef<GainNode[]>([]);

  // 音源バッファのキャッシュ
  const saunaNoiseBufferRef = useRef<AudioBuffer | null>(null);
  const totonouWindBufferRef = useRef<AudioBuffer | null>(null);
  const loylyWhiteNoiseBufferRef = useRef<AudioBuffer | null>(null);

  const init = useCallback(() => {
    if (!ctxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (
          window as Window &
            typeof globalThis & { webkitAudioContext?: typeof AudioContext }
        ).webkitAudioContext;
      if (!AudioCtx) {
        console.error("AudioContext is not supported in this browser");
        return;
      }
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume();
    }
    if (!masterGainRef.current && ctxRef.current) {
      const master = ctxRef.current.createGain();
      master.gain.value = 0; // デフォルトミュート
      master.connect(ctxRef.current.destination);
      masterGainRef.current = master;
    }
  }, []);

  const currentEnvRef = useRef<AmbientEnv | null>(null);

  const stopAmbient = useCallback(() => {
    currentEnvRef.current = null;
    if (!ctxRef.current) return;
    const now = ctxRef.current.currentTime;

    // 全ての進行中ゲインを滑らかにフェードアウト
    activeGainsRef.current.forEach((gain) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.4);
      } catch (e) {
        console.error("Failed to fade out gain", e);
      }
    });

    const sourcesToStop = [...activeSourcesRef.current];
    activeSourcesRef.current = [];
    activeGainsRef.current = [];

    // フェードアウト完了後に停止
    setTimeout(() => {
      sourcesToStop.forEach((src) => {
        try {
          src.stop();
        } catch (e) {
          console.error("Failed to stop source", e);
        }
      });
    }, 1200);
  }, []);

  const playSauna = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;

    if (!saunaNoiseBufferRef.current) {
      const bufferSize = ctx.sampleRate * 2;
      try {
        const generatedData = await generateBufferAsync(
          "saunaNoise",
          bufferSize,
        );
        if (currentEnvRef.current !== "sauna") return;

        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        buffer.copyToChannel(generatedData, 0);
        saunaNoiseBufferRef.current = buffer;
      } catch (e) {
        console.error("Failed to generate sauna noise buffer", e);
        return;
      }
    }

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = saunaNoiseBufferRef.current;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 250;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.35, now, 1.0);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGainRef.current);
    source.start();

    activeSourcesRef.current.push(source);
    activeGainsRef.current.push(gain);
  }, []);

  const playWater = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;

    if (!saunaNoiseBufferRef.current) {
      const bufferSize = ctx.sampleRate * 2;
      try {
        const generatedData = await generateBufferAsync(
          "saunaNoise",
          bufferSize,
        );
        if (currentEnvRef.current !== "water") return;

        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        buffer.copyToChannel(generatedData, 0);
        saunaNoiseBufferRef.current = buffer;
      } catch (e) {
        console.error("Failed to generate water noise buffer", e);
        return;
      }
    }

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = saunaNoiseBufferRef.current;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.6;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.45, now, 1.0);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(masterGainRef.current);
    source.start();

    activeSourcesRef.current.push(source);
    activeGainsRef.current.push(gain);
  }, []);

  const playTotonou = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;
    const now = ctx.currentTime;

    // 1. とをどい誘発バイノーラルビート (A2: 110Hz と 112.5Hz)
    const oscL = ctx.createOscillator();
    oscL.type = "sine";
    oscL.frequency.value = 110;

    const oscR = ctx.createOscillator();
    oscR.type = "sine";
    oscR.frequency.value = 112.5;

    const pannerL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const pannerR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pannerL) pannerL.pan.value = -0.8;
    if (pannerR) pannerR.pan.value = 0.8;

    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.gain.setTargetAtTime(0.25, now, 2.0);

    if (pannerL && pannerR) {
      oscL.connect(pannerL).connect(humGain);
      oscR.connect(pannerR).connect(humGain);
    } else {
      oscL.connect(humGain);
      oscR.connect(humGain);
    }

    oscL.start();
    oscR.start();
    activeSourcesRef.current.push(oscL, oscR);
    activeGainsRef.current.push(humGain);
    humGain.connect(masterGainRef.current);

    // 2. そよ風ノイズの合成・キャッシュ
    if (!totonouWindBufferRef.current) {
      const windBufferSize = ctx.sampleRate * 3;
      try {
        const generatedData = await generateBufferAsync(
          "windNoise",
          windBufferSize,
        );
        if (currentEnvRef.current !== "totonou") return;

        const windBuffer = ctx.createBuffer(1, windBufferSize, ctx.sampleRate);
        windBuffer.copyToChannel(generatedData, 0);
        totonouWindBufferRef.current = windBuffer;
      } catch (e) {
        console.error("Failed to generate wind noise buffer", e);
        return;
      }
    }

    const windSource = ctx.createBufferSource();
    windSource.buffer = totonouWindBufferRef.current;
    windSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass";
    windFilter.frequency.value = 200; // 低い風のささやき

    const windGain = ctx.createGain();
    windGain.gain.value = 0.04;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08; // 超低頻度 (約12.5秒周期)

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03; // ゲインの揺れ幅

    lfo.connect(lfoGain);
    lfoGain.connect(windGain.gain);

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGainRef.current);

    windSource.start();
    lfo.start();

    activeSourcesRef.current.push(windSource, lfo);
    activeGainsRef.current.push(windGain);
  }, []);

  const playAmbient = useCallback(
    async (env: AmbientEnv) => {
      if (!ctxRef.current || !masterGainRef.current) return;

      stopAmbient();
      currentEnvRef.current = env;

      switch (env) {
        case "sauna":
          await playSauna();
          break;
        case "water":
          await playWater();
          break;
        case "totonou":
          await playTotonou();
          break;
      }
    },
    [stopAmbient, playSauna, playWater, playTotonou],
  );

  const playLoyly = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;

    if (!loylyWhiteNoiseBufferRef.current) {
      const bufferSize = Math.floor(ctx.sampleRate * 2.0);
      try {
        const generatedData = await generateBufferAsync(
          "whiteNoise",
          bufferSize,
        );
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        buffer.copyToChannel(generatedData, 0);
        loylyWhiteNoiseBufferRef.current = buffer;
      } catch (e) {
        console.error("Failed to generate loyly white noise buffer", e);
        return;
      }
    }

    const now = ctx.currentTime;

    // --- 1. 高音のジュワー音 (瞬発的な沸騰) ---
    const sourceSizzle = ctx.createBufferSource();
    sourceSizzle.buffer = loylyWhiteNoiseBufferRef.current;

    const filterSizzle = ctx.createBiquadFilter();
    filterSizzle.type = "highpass";
    filterSizzle.frequency.setValueAtTime(3500, now);
    filterSizzle.frequency.exponentialRampToValueAtTime(7000, now + 0.6);

    const gainSizzle = ctx.createGain();
    gainSizzle.gain.setValueAtTime(0.55, now);
    gainSizzle.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

    sourceSizzle
      .connect(filterSizzle)
      .connect(gainSizzle)
      .connect(masterGainRef.current);
    sourceSizzle.start(now);
    sourceSizzle.stop(now + 0.8);

    // --- 2. 低音・中音のフシュー音 (スチームの対流・部屋への拡散) ---
    const sourceSteam = ctx.createBufferSource();
    sourceSteam.buffer = loylyWhiteNoiseBufferRef.current;

    const filterSteam = ctx.createBiquadFilter();
    filterSteam.type = "bandpass";
    filterSteam.frequency.setValueAtTime(800, now);
    filterSteam.frequency.exponentialRampToValueAtTime(2500, now + 1.2);
    filterSteam.Q.value = 1.0;

    const gainSteam = ctx.createGain();
    // 少し遅れて立ち上がるようにする
    gainSteam.gain.setValueAtTime(0, now);
    gainSteam.gain.linearRampToValueAtTime(0.35, now + 0.25);
    gainSteam.gain.exponentialRampToValueAtTime(0.005, now + 2.0);

    sourceSteam
      .connect(filterSteam)
      .connect(gainSteam)
      .connect(masterGainRef.current);
    sourceSteam.start(now);
    sourceSteam.stop(now + 2.0);
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    if (masterGainRef.current && ctxRef.current) {
      const now = ctxRef.current.currentTime;
      masterGainRef.current.gain.cancelScheduledValues(now);
      masterGainRef.current.gain.setTargetAtTime(muted ? 0 : 1, now, 0.08);
    }
  }, []);

  return useMemo(
    () => ({ init, playAmbient, playLoyly, setMuted }),
    [init, playAmbient, playLoyly, setMuted],
  );
}
