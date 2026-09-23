import { useRef, useCallback, useMemo } from "react";
import { createSpatialAudio, type SpatialPose } from "./spatialAudio";
import AudioWorker from "./audioWorker?worker";

export type AmbientEnv = "sauna" | "water" | "totonou";

type NoiseType = "whiteNoise" | "saunaNoise" | "windNoise";

export interface AudioEffectSettings {
  type: BiquadFilterType;
  frequency: number;
  gain?: number;
  Q?: number;
}

export interface NoiseSourceConfig {
  noiseType: NoiseType;
  /** ループ用バッファの長さ（秒） */
  bufferSeconds: number;
}

export interface EnvironmentConfig extends NoiseSourceConfig {
  filterSettings: AudioEffectSettings;
  targetGain: number;
  fadeInTimeConstant: number;
  /** 3D表示中に定位させる音源位置 */
  spatialBus: "stove" | "water";
}

export interface BinauralBeatConfig {
  frequencyLeft: number;
  frequencyRight: number;
  panLeft: number;
  panRight: number;
  targetGain: number;
  timeConstant: number;
}

export interface WindNoiseConfig extends NoiseSourceConfig {
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
  loyly: NoiseSourceConfig;
}

export const AUDIO_PRESETS: AudioPresets = {
  sauna: {
    filterSettings: {
      type: "lowpass",
      frequency: 250,
    },
    targetGain: 0.35,
    fadeInTimeConstant: 1.0,
    noiseType: "saunaNoise",
    bufferSeconds: 2,
    spatialBus: "stove",
  },
  water: {
    filterSettings: {
      type: "bandpass",
      frequency: 1200,
      Q: 0.6,
    },
    targetGain: 0.45,
    fadeInTimeConstant: 1.0,
    noiseType: "saunaNoise",
    bufferSeconds: 2,
    spatialBus: "water",
  },
  // ととのい誘発バイノーラルビート (A2: 110Hz と 112.5Hz)
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
      frequency: 200, // 低い風のささやき
    },
    baseGain: 0.04,
    lfoFrequency: 0.08, // 超低頻度 (約12.5秒周期)
    lfoGain: 0.03, // ゲインの揺れ幅
    noiseType: "windNoise",
    bufferSeconds: 3,
  },
  loyly: {
    noiseType: "whiteNoise",
    bufferSeconds: 2,
  },
};

export interface AudioEngine {
  setSpatialPose: (pose: SpatialPose | null) => void;
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
  type: NoiseType,
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

function applyFilterSettings(
  filter: BiquadFilterNode,
  settings: AudioEffectSettings,
) {
  filter.type = settings.type;
  filter.frequency.value = settings.frequency;
  if (settings.Q !== undefined) filter.Q.value = settings.Q;
  if (settings.gain !== undefined) filter.gain.value = settings.gain;
}

export function useAudioEngine(): AudioEngine {
  const ctxRef = useRef<AudioContext | null>(null);
  const spatialRef = useRef<ReturnType<typeof createSpatialAudio>>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // 稼働中のソースとゲインを追跡し、フェードアウト後に安全に停止する
  const activeSourcesRef = useRef<{ stop: () => void }[]>([]);
  const activeGainsRef = useRef<GainNode[]>([]);

  // 音源バッファのキャッシュ（ノイズの種類ごと）
  const noiseBuffersRef = useRef(new Map<NoiseType, AudioBuffer>());

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
      spatialRef.current = createSpatialAudio(ctxRef.current, master);
    }
  }, []);

  const currentEnvRef = useRef<AmbientEnv | null>(null);

  /**
   * キャッシュ済みのノイズバッファを返す。未生成なら Worker で生成する。
   * env を渡した場合、生成を待つ間に環境が切り替わっていれば null を返して再生を中止させる。
   */
  const getNoiseBuffer = useCallback(
    async (
      ctx: AudioContext,
      { noiseType, bufferSeconds }: NoiseSourceConfig,
      label: string,
      env?: AmbientEnv,
    ): Promise<AudioBuffer | null> => {
      const cached = noiseBuffersRef.current.get(noiseType);
      if (cached) return cached;
      const bufferSize = Math.floor(ctx.sampleRate * bufferSeconds);
      try {
        const generatedData = await generateBufferAsync(noiseType, bufferSize);
        if (env && currentEnvRef.current !== env) return null;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        buffer.copyToChannel(generatedData, 0);
        noiseBuffersRef.current.set(noiseType, buffer);
        return buffer;
      } catch (e) {
        console.error(`Failed to generate ${label} buffer`, e);
        return null;
      }
    },
    [],
  );

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

  // サウナ・水風呂: フィルタを通したノイズのループを定位用バスへ流す
  const playNoiseAmbient = useCallback(
    async (env: "sauna" | "water") => {
      if (!ctxRef.current || !masterGainRef.current) return;
      const ctx = ctxRef.current;
      const preset = AUDIO_PRESETS[env];

      const buffer = await getNoiseBuffer(ctx, preset, `${env} noise`, env);
      if (!buffer) return;

      const now = ctx.currentTime;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      applyFilterSettings(filter, preset.filterSettings);

      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(
        preset.targetGain,
        now,
        preset.fadeInTimeConstant,
      );

      source.connect(filter);
      filter.connect(gain);
      gain.connect(
        spatialRef.current?.[preset.spatialBus] ?? masterGainRef.current,
      );
      source.start();

      activeSourcesRef.current.push(source);
      activeGainsRef.current.push(gain);
    },
    [getNoiseBuffer],
  );

  const playTotonou = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;
    const now = ctx.currentTime;
    const binaural = AUDIO_PRESETS.totonouBinaural;
    const wind = AUDIO_PRESETS.totonouWind;

    // 1. バイノーラルビート
    const oscL = ctx.createOscillator();
    oscL.type = "sine";
    oscL.frequency.value = binaural.frequencyLeft;

    const oscR = ctx.createOscillator();
    oscR.type = "sine";
    oscR.frequency.value = binaural.frequencyRight;

    const pannerL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const pannerR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pannerL) pannerL.pan.value = binaural.panLeft;
    if (pannerR) pannerR.pan.value = binaural.panRight;

    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    humGain.gain.setTargetAtTime(
      binaural.targetGain,
      now,
      binaural.timeConstant,
    );

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

    // 2. そよ風ノイズ
    const windBuffer = await getNoiseBuffer(ctx, wind, "wind noise", "totonou");
    if (!windBuffer) return;

    const windSource = ctx.createBufferSource();
    windSource.buffer = windBuffer;
    windSource.loop = true;

    const windFilter = ctx.createBiquadFilter();
    applyFilterSettings(windFilter, wind.filterSettings);

    const windGain = ctx.createGain();
    windGain.gain.value = wind.baseGain;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = wind.lfoFrequency;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = wind.lfoGain;

    lfo.connect(lfoGain);
    lfoGain.connect(windGain.gain);

    windSource.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(masterGainRef.current);

    windSource.start();
    lfo.start();

    activeSourcesRef.current.push(windSource, lfo);
    activeGainsRef.current.push(windGain);
  }, [getNoiseBuffer]);

  const playAmbient = useCallback(
    async (env: AmbientEnv) => {
      if (!ctxRef.current || !masterGainRef.current) return;

      stopAmbient();
      currentEnvRef.current = env;

      if (env === "totonou") {
        await playTotonou();
      } else {
        await playNoiseAmbient(env);
      }
    },
    [stopAmbient, playNoiseAmbient, playTotonou],
  );

  const playLoyly = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;

    const buffer = await getNoiseBuffer(
      ctx,
      AUDIO_PRESETS.loyly,
      "loyly white noise",
    );
    if (!buffer) return;

    const now = ctx.currentTime;

    // --- 1. 高音のジュワー音 (瞬発的な沸騰) ---
    const sourceSizzle = ctx.createBufferSource();
    sourceSizzle.buffer = buffer;

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
      .connect(spatialRef.current?.stove ?? masterGainRef.current);
    sourceSizzle.start(now);
    sourceSizzle.stop(now + 0.8);

    // --- 2. 低音・中音のフシュー音 (スチームの対流・部屋への拡散) ---
    const sourceSteam = ctx.createBufferSource();
    sourceSteam.buffer = buffer;

    const filterSteam = ctx.createBiquadFilter();
    filterSteam.type = "bandpass";
    filterSteam.frequency.setValueAtTime(800, now);
    filterSteam.frequency.exponentialRampToValueAtTime(2500, now + 1.2);
    filterSteam.Q.value = 1.0;

    const gainSteam = ctx.createGain();
    // 少し遅れて立ち上がるようにする
    gainSteam.gain.setValueAtTime(0, now);
    gainSteam.gain.linearRampToValueAtTime(0.35, now + 0.25);
    gainSteam.gain.exponentialRampToValueAtTime(0.005, now + 2.0);

    sourceSteam
      .connect(filterSteam)
      .connect(gainSteam)
      .connect(spatialRef.current?.stove ?? masterGainRef.current);
    sourceSteam.start(now);
    sourceSteam.stop(now + 2.0);
  }, [getNoiseBuffer]);

  const setMuted = useCallback((muted: boolean) => {
    if (masterGainRef.current && ctxRef.current) {
      const now = ctxRef.current.currentTime;
      masterGainRef.current.gain.cancelScheduledValues(now);
      masterGainRef.current.gain.setTargetAtTime(muted ? 0 : 1, now, 0.08);
    }
  }, []);

  const setSpatialPose = useCallback((pose: SpatialPose | null) => {
    spatialRef.current?.update(pose);
  }, []);

  return useMemo(
    () => ({ init, playAmbient, playLoyly, setMuted, setSpatialPose }),
    [init, playAmbient, playLoyly, setMuted, setSpatialPose],
  );
}
