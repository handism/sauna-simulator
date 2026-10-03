import { useRef, useCallback, useMemo } from 'react';
import { createSpatialAudio, type SpatialPose } from './spatialAudio';
import { generateNoise, type NoiseType } from './noiseWorkerClient';

export type AmbientEnv = 'sauna' | 'water' | 'totonou';

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
  spatialBus: 'stove' | 'water';
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
      type: 'lowpass',
      frequency: 250,
    },
    targetGain: 0.35,
    fadeInTimeConstant: 1.0,
    noiseType: 'saunaNoise',
    bufferSeconds: 2,
    spatialBus: 'stove',
  },
  water: {
    filterSettings: {
      type: 'bandpass',
      frequency: 1200,
      Q: 0.6,
    },
    targetGain: 0.45,
    fadeInTimeConstant: 1.0,
    noiseType: 'saunaNoise',
    bufferSeconds: 2,
    spatialBus: 'water',
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
      type: 'lowpass',
      frequency: 200, // 低い風のささやき
    },
    baseGain: 0.04,
    lfoFrequency: 0.08, // 超低頻度 (約12.5秒周期)
    lfoGain: 0.03, // ゲインの揺れ幅
    noiseType: 'windNoise',
    bufferSeconds: 3,
  },
  loyly: {
    noiseType: 'whiteNoise',
    bufferSeconds: 2,
  },
};

export interface AudioEngine {
  setSpatialPose: (pose: SpatialPose | null) => void;
  init: () => void;
  playAmbient: (env: AmbientEnv) => void;
  stopAmbient: () => void;
  playLoyly: () => void;
  setMuted: (muted: boolean) => void;
}

function applyFilterSettings(filter: BiquadFilterNode, settings: AudioEffectSettings) {
  filter.type = settings.type;
  filter.frequency.value = settings.frequency;
  if (settings.Q !== undefined) filter.Q.value = settings.Q;
  if (settings.gain !== undefined) filter.gain.value = settings.gain;
}

// ループするノイズ → フィルタ → ゲイン。出力先への接続と開始は呼び出し側で行う
function createNoiseLoop(ctx: AudioContext, buffer: AudioBuffer, filterSettings: AudioEffectSettings) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  applyFilterSettings(filter, filterSettings);

  const gain = ctx.createGain();
  source.connect(filter);
  filter.connect(gain);
  return { source, gain };
}

export function useAudioEngine(): AudioEngine {
  const ctxRef = useRef<AudioContext | null>(null);
  const spatialRef = useRef<ReturnType<typeof createSpatialAudio>>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // 稼働中のソースとゲインを追跡し、フェードアウト後に安全に停止する
  const activeSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const activeGainsRef = useRef<GainNode[]>([]);

  // 音源バッファのキャッシュ（ノイズの種類と長さごと。同じ種類でも長さが違えば別のバッファ）
  const noiseBuffersRef = useRef(new Map<string, AudioBuffer>());

  const init = useCallback(() => {
    if (!ctxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) {
        console.error('AudioContext is not supported in this browser');
        return;
      }
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === 'suspended') {
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

  // 再生中の環境音の要求。同じ環境へ戻った場合も、前の要求とは別に扱う
  const currentRequestRef = useRef<object | null>(null);

  /**
   * キャッシュ済みのノイズバッファを返す。未生成なら Worker で生成する。
   * 再生要求が最新かの確認は、キャッシュの有無にかかわらず呼び出し側の await 後に行う。
   */
  const getNoiseBuffer = useCallback(
    async (
      ctx: AudioContext,
      { noiseType, bufferSeconds }: NoiseSourceConfig,
      label: string,
    ): Promise<AudioBuffer | null> => {
      const bufferSize = Math.floor(ctx.sampleRate * bufferSeconds);
      const cacheKey = `${noiseType}-${bufferSize}`;
      const cached = noiseBuffersRef.current.get(cacheKey);
      if (cached) return cached;
      try {
        const generatedData = await generateNoise(noiseType, bufferSize);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        buffer.copyToChannel(generatedData, 0);
        // 環境が切り替わっていても生成結果は次回のためにキャッシュする
        noiseBuffersRef.current.set(cacheKey, buffer);
        return buffer;
      } catch (e) {
        console.error(`Failed to generate ${label} buffer`, e);
        return null;
      }
    },
    [],
  );

  const stopAmbient = useCallback(() => {
    currentRequestRef.current = null;
    if (!ctxRef.current) return;
    const now = ctxRef.current.currentTime;

    // 全ての進行中ゲインを滑らかにフェードアウト
    activeGainsRef.current.forEach((gain) => {
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(0, now, 0.4);
      } catch (e) {
        console.error('Failed to fade out gain', e);
      }
    });

    // フェードアウト完了後に停止するようオーディオクロック上で予約する
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop(now + 1.2);
      } catch (e) {
        console.error('Failed to stop source', e);
      }
    });
    activeSourcesRef.current = [];
    activeGainsRef.current = [];
  }, []);

  // サウナ・水風呂: フィルタを通したノイズのループを定位用バスへ流す
  const playNoiseAmbient = useCallback(
    async (env: 'sauna' | 'water', request: object) => {
      if (!ctxRef.current || !masterGainRef.current) return;
      const ctx = ctxRef.current;
      const preset = AUDIO_PRESETS[env];

      const buffer = await getNoiseBuffer(ctx, preset, `${env} noise`);
      if (!buffer || currentRequestRef.current !== request) return;

      const now = ctx.currentTime;
      const { source, gain } = createNoiseLoop(ctx, buffer, preset.filterSettings);
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(preset.targetGain, now, preset.fadeInTimeConstant);
      gain.connect(spatialRef.current?.[preset.spatialBus] ?? masterGainRef.current);
      source.start();

      activeSourcesRef.current.push(source);
      activeGainsRef.current.push(gain);
    },
    [getNoiseBuffer],
  );

  const playTotonou = useCallback(
    async (request: object) => {
      if (!ctxRef.current || !masterGainRef.current) return;
      const ctx = ctxRef.current;
      const now = ctx.currentTime;
      const binaural = AUDIO_PRESETS.totonouBinaural;
      const wind = AUDIO_PRESETS.totonouWind;

      // 1. バイノーラルビート
      const oscL = ctx.createOscillator();
      oscL.type = 'sine';
      oscL.frequency.value = binaural.frequencyLeft;

      const oscR = ctx.createOscillator();
      oscR.type = 'sine';
      oscR.frequency.value = binaural.frequencyRight;

      const pannerL = ctx.createStereoPanner();
      const pannerR = ctx.createStereoPanner();
      pannerL.pan.value = binaural.panLeft;
      pannerR.pan.value = binaural.panRight;

      const humGain = ctx.createGain();
      humGain.gain.value = 0;
      humGain.gain.setTargetAtTime(binaural.targetGain, now, binaural.timeConstant);

      oscL.connect(pannerL).connect(humGain);
      oscR.connect(pannerR).connect(humGain);

      oscL.start();
      oscR.start();
      activeSourcesRef.current.push(oscL, oscR);
      activeGainsRef.current.push(humGain);
      humGain.connect(masterGainRef.current);

      // 2. そよ風ノイズ
      const windBuffer = await getNoiseBuffer(ctx, wind, 'wind noise');
      if (!windBuffer || currentRequestRef.current !== request) return;

      const { source: windSource, gain: windGain } = createNoiseLoop(ctx, windBuffer, wind.filterSettings);
      windGain.gain.value = wind.baseGain;

      const lfo = ctx.createOscillator();
      lfo.frequency.value = wind.lfoFrequency;

      const lfoGain = ctx.createGain();
      lfoGain.gain.value = wind.lfoGain;

      lfo.connect(lfoGain);
      lfoGain.connect(windGain.gain);
      windGain.connect(masterGainRef.current);

      windSource.start();
      lfo.start();

      activeSourcesRef.current.push(windSource, lfo);
      activeGainsRef.current.push(windGain);
    },
    [getNoiseBuffer],
  );

  const playAmbient = useCallback(
    async (env: AmbientEnv) => {
      if (!ctxRef.current || !masterGainRef.current) return;

      stopAmbient();
      const request = {};
      currentRequestRef.current = request;

      if (env === 'totonou') {
        await playTotonou(request);
      } else {
        await playNoiseAmbient(env, request);
      }
    },
    [stopAmbient, playNoiseAmbient, playTotonou],
  );

  const playLoyly = useCallback(async () => {
    if (!ctxRef.current || !masterGainRef.current) return;
    const ctx = ctxRef.current;

    const buffer = await getNoiseBuffer(ctx, AUDIO_PRESETS.loyly, 'loyly white noise');
    if (!buffer) return;

    const now = ctx.currentTime;
    const output = spatialRef.current?.stove ?? masterGainRef.current;

    // ノイズ → フィルタ → ゲイン → ストーブ位置、の一発音を duration 秒だけ鳴らす
    const playBurst = (duration: number, shape: (filter: BiquadFilterNode, gain: GainNode) => void) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      shape(filter, gain);
      source.connect(filter).connect(gain).connect(output);
      source.start(now);
      source.stop(now + duration);
    };

    // --- 1. 高音のジュワー音 (瞬発的な沸騰) ---
    playBurst(0.8, (filter, gain) => {
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(3500, now);
      filter.frequency.exponentialRampToValueAtTime(7000, now + 0.6);
      gain.gain.setValueAtTime(0.55, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    });

    // --- 2. 低音・中音のフシュー音 (スチームの対流・部屋への拡散) ---
    playBurst(2.0, (filter, gain) => {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(800, now);
      filter.frequency.exponentialRampToValueAtTime(2500, now + 1.2);
      filter.Q.value = 1.0;
      // 少し遅れて立ち上がるようにする
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.35, now + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.005, now + 2.0);
    });
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
    () => ({ init, playAmbient, stopAmbient, playLoyly, setMuted, setSpatialPose }),
    [init, playAmbient, stopAmbient, playLoyly, setMuted, setSpatialPose],
  );
}
