import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { AudioEngine } from '../hooks/useAudioEngine';
import type { QualityMode } from './3d/quality';
import type { LightingMode } from './3d/lighting';
import type { Stage } from '../context/SaunaContext';

class SceneModuleError extends Error {}
const SaunaScene = lazy(() => import('./3d/SaunaScene').catch(() => {
  throw new SceneModuleError('The 3D module could not be loaded');
}));
const STORAGE_KEY = 'sui-view-mode';
export function initialSceneMode(): boolean {
  const query = new URLSearchParams(window.location.search).get('view');
  if (query === '3d' || query === '2d') {
    try { localStorage.setItem(STORAGE_KEY, query); } catch { /* Storage can be disabled. */ }
    return query === '3d';
  }
  try { return localStorage.getItem(STORAGE_KEY) === '3d'; } catch { return false; }
}
class SceneBoundary extends Component<{ children: ReactNode; onError: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { this.props.onError(error); }
  render() { return this.state.failed ? null : this.props.children; }
}
function ActiveScene({ stage, opacity, loylyEvents, lightingMode, quality, audio }: { quality: QualityMode; audio: AudioEngine; lightingMode: LightingMode; stage: Exclude<Stage, 'start'>; opacity: number; loylyEvents: EventTarget }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'reload-required'>('loading');
  const ready = useCallback(() => setStatus(current => current === 'loading' ? 'ready' : current), []);
  const failed = useCallback(() => setStatus('failed'), []);
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
  return <>
    <div className="scene-3d-layer" style={{ opacity }}>
    {(status === 'loading' || status === 'ready') && <SceneBoundary onError={boundaryFailed}><Suspense fallback={null}>
      <SaunaScene quality={quality} audio={audio} lightingMode={lightingMode} stage={stage} loylyEvents={loylyEvents} onReady={ready} onError={failed} />
    </Suspense></SceneBoundary>}
    </div>
    <div className="scene-status" role="status">
      {status === 'loading' ? '3Dを読み込み中 · 2Dで体験を続けられます' : status === 'reload-required' ? <>
        3Dの読み込みに失敗したため、2Dで続けています。3Dを再試行するには再読み込みが必要です。体験は最初からになります。
        <button type="button" onClick={() => window.location.reload()}>最初から再読み込み</button>
      </> : status === 'failed' ? '3Dを表示できないため、2Dで続けています' : 'ドラッグ / スワイプで見回す'}
    </div>
  </>;
}
export default function SceneMode({ stage, opacity = 1, loylyEvents, audio }: { audio: AudioEngine; stage: Stage; opacity?: number; loylyEvents: EventTarget }) {
  const [lightingMode, setLightingMode] = useState<LightingMode>(() => {
    try {
      const saved = localStorage.getItem('sui-lighting-mode');
      return saved === 'day' || saved === 'evening' ? saved : 'auto';
    } catch { return 'auto'; }
  });
  const [quality, setQuality] = useState<QualityMode>(() => {
    try { const saved = localStorage.getItem('sui-quality'); return saved === 'low' || saved === 'high' ? saved : 'standard'; }
    catch { return 'standard'; }
  });
  const [enabled, setEnabled] = useState(initialSceneMode);
  const toggle = () => {
    const next = !enabled; setEnabled(next);
    try { localStorage.setItem(STORAGE_KEY, next ? '3d' : '2d'); } catch { /* Optional preference. */ }
    // Keep an explicit URL choice consistent with the switch, including reloads.
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) { url.searchParams.set('view', next ? '3d' : '2d'); window.history.replaceState(null, '', url); }
  };
  return <>
    {enabled && stage !== 'start' && <ActiveScene quality={quality} audio={audio} lightingMode={lightingMode} stage={stage} opacity={opacity} loylyEvents={loylyEvents} />}
    <div className="scene-mode-controls">
      <button type="button" onClick={toggle} aria-pressed={enabled}> {enabled ? '2Dに切り替え' : '3Dを試す'} </button>
      {enabled && <label className="scene-lighting-control">時間帯
        <select aria-label="3Dの時間帯" value={lightingMode} onChange={event => {
          const next = event.target.value as LightingMode;
          setLightingMode(next);
          try { localStorage.setItem('sui-lighting-mode', next); } catch { /* Optional preference. */ }
        }}>
          <option value="auto">自動</option><option value="day">昼</option><option value="evening">夕暮れ</option>
        </select>
      </label>}
      {enabled && <label className="scene-lighting-control">画質
        <select aria-label="3Dの画質" value={quality} onChange={event => {
          const next = event.target.value as QualityMode;
          setQuality(next);
          try { localStorage.setItem('sui-quality', next); } catch { /* Optional preference. */ }
        }}>
          <option value="low">軽量</option><option value="standard">標準</option><option value="high">高精細</option>
        </select>
      </label>}
      {enabled && <a href={`${import.meta.env.BASE_URL}models/CREDITS.md`} target="_blank" rel="noreferrer">素材クレジット</a>}
      {enabled && stage === 'start' && <span>入室すると3Dで体験できます</span>}
    </div>
  </>;
}
