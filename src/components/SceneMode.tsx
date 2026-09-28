import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AudioEngine } from '../hooks/useAudioEngine';
import type { QualityMode } from './3d/quality';
import type { LightingMode } from './3d/lighting';
import type { Stage } from '../context/SaunaContext';
import { readPreference, writePreference } from '../utils/preferences';

class SceneModuleError extends Error {}
const SaunaScene = lazy(() =>
  import('./3d/SaunaScene').catch(() => {
    throw new SceneModuleError('The 3D module could not be loaded');
  }),
);
const STORAGE_KEY = 'sui-view-mode';
const LIGHTING_KEY = 'sui-lighting-mode';
const QUALITY_KEY = 'sui-quality';
function initialSceneMode(): boolean {
  const query = new URLSearchParams(window.location.search).get('view');
  if (query === '3d' || query === '2d') {
    writePreference(STORAGE_KEY, query);
    return query === '3d';
  }
  return readPreference(STORAGE_KEY, ['2d', '3d'], '2d') === '3d';
}
class SceneBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
function usePreference<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => readPreference(key, allowed, fallback));
  const update = (next: T) => {
    setValue(next);
    writePreference(key, next);
  };
  return [value, update] as const;
}
function PreferenceSelect<T extends string>({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (next: T) => void;
}) {
  return (
    <label className="scene-lighting-control">
      {label}
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
const LIGHTING_OPTIONS = [
  ['auto', '自動'],
  ['day', '昼'],
  ['evening', '夕暮れ'],
] as const satisfies readonly (readonly [LightingMode, string])[];
const QUALITY_OPTIONS = [
  ['low', '軽量'],
  ['standard', '標準'],
  ['high', '高精細'],
] as const satisfies readonly (readonly [QualityMode, string])[];
const LIGHTING_VALUES = LIGHTING_OPTIONS.map(([value]) => value);
const QUALITY_VALUES = QUALITY_OPTIONS.map(([value]) => value);
function ActiveScene({
  stage,
  opacity,
  loylyEvents,
  lightingMode,
  quality,
  audio,
}: {
  quality: QualityMode;
  audio: AudioEngine;
  lightingMode: LightingMode;
  stage: Exclude<Stage, 'start'>;
  opacity: number;
  loylyEvents: EventTarget;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'reload-required'>('loading');
  const ready = useCallback(() => setStatus((current) => (current === 'loading' ? 'ready' : current)), []);
  const failed = useCallback(() => setStatus('failed'), []);
  // The woodland foliage arrives after the scene is ready (SaunaScene).
  const [gardenLoading, setGardenLoading] = useState(false);
  const boundaryFailed = useCallback((error: Error) => {
    setStatus(error instanceof SceneModuleError ? 'reload-required' : 'failed');
  }, []);
  // Cover the lazy JavaScript download as well as the scene/model load.
  // Stage and setting changes must not extend the deadline.
  useEffect(() => {
    if (status !== 'loading') return;
    const timeout = window.setTimeout(failed, 30_000);
    return () => window.clearTimeout(timeout);
  }, [status, failed]);
  return (
    <>
      <div className="scene-3d-layer" style={{ opacity }}>
        {(status === 'loading' || status === 'ready') && (
          <SceneBoundary onError={boundaryFailed}>
            <Suspense fallback={null}>
              <SaunaScene
                quality={quality}
                audio={audio}
                lightingMode={lightingMode}
                stage={stage}
                loylyEvents={loylyEvents}
                onReady={ready}
                onError={failed}
                onGardenLoading={setGardenLoading}
              />
            </Suspense>
          </SceneBoundary>
        )}
      </div>
      <div className="scene-status" role="status">
        {status === 'loading' ? (
          '3Dを読み込み中 · 2Dで体験を続けられます'
        ) : status === 'reload-required' ? (
          <>
            3Dの読み込みに失敗したため、2Dで続けています。3Dを再試行するには再読み込みが必要です。体験は最初からになります。
            <button type="button" onClick={() => window.location.reload()}>
              最初から再読み込み
            </button>
          </>
        ) : status === 'failed' ? (
          '3Dを表示できないため、2Dで続けています'
        ) : gardenLoading ? (
          'ドラッグ / スワイプで見回す · 庭の木々を読み込み中'
        ) : (
          'ドラッグ / スワイプで見回す'
        )}
      </div>
    </>
  );
}
export default function SceneMode({
  stage,
  opacity = 1,
  loylyEvents,
  audio,
}: {
  audio: AudioEngine;
  stage: Stage;
  opacity?: number;
  loylyEvents: EventTarget;
}) {
  const [lightingMode, setLightingMode] = usePreference<LightingMode>(LIGHTING_KEY, LIGHTING_VALUES, 'auto');
  const [quality, setQuality] = usePreference<QualityMode>(QUALITY_KEY, QUALITY_VALUES, 'standard');
  const [enabled, setEnabled] = useState(initialSceneMode);
  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    writePreference(STORAGE_KEY, next ? '3d' : '2d');
    // Keep an explicit URL choice consistent with the switch, including reloads.
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) {
      url.searchParams.set('view', next ? '3d' : '2d');
      window.history.replaceState(null, '', url);
    }
  };
  return (
    <>
      {enabled && stage !== 'start' && (
        <ActiveScene
          quality={quality}
          audio={audio}
          lightingMode={lightingMode}
          stage={stage}
          opacity={opacity}
          loylyEvents={loylyEvents}
        />
      )}
      <div className="scene-mode-controls">
        <button type="button" onClick={toggle} aria-pressed={enabled}>
          {enabled ? '2Dに切り替え' : '3Dを試す'}
        </button>
        {enabled && (
          <>
            <PreferenceSelect
              label="時間帯"
              ariaLabel="3Dの時間帯"
              value={lightingMode}
              options={LIGHTING_OPTIONS}
              onChange={setLightingMode}
            />
            <PreferenceSelect
              label="画質"
              ariaLabel="3Dの画質"
              value={quality}
              options={QUALITY_OPTIONS}
              onChange={setQuality}
            />
            <a href={`${import.meta.env.BASE_URL}models/CREDITS.md`} target="_blank" rel="noreferrer">
              素材クレジット
            </a>
            {stage === 'start' && <span>入室すると3Dで体験できます</span>}
          </>
        )}
      </div>
    </>
  );
}
