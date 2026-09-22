import { Component, lazy, Suspense, useCallback, useState, type ReactNode } from 'react';
import type { Stage } from '../context/SaunaContext';

const SaunaScene = lazy(() => import('./3d/SaunaScene'));
const STORAGE_KEY = 'sui-view-mode';
export function initialSceneMode(): boolean {
  const query = new URLSearchParams(window.location.search).get('view');
  if (query === '3d' || query === '2d') {
    try { localStorage.setItem(STORAGE_KEY, query); } catch { /* Storage can be disabled. */ }
    return query === '3d';
  }
  try { return localStorage.getItem(STORAGE_KEY) === '3d'; } catch { return false; }
}
class SceneBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}
function ActiveScene({ stage, opacity, loylyEvents }: { stage: Exclude<Stage, 'start'>; opacity: number; loylyEvents: EventTarget }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  const ready = useCallback(() => setStatus('ready'), []);
  const failed = useCallback(() => setStatus('failed'), []);
  return <>
    <div className="scene-3d-layer" style={{ opacity }}>
    {status !== 'failed' && <SceneBoundary onError={failed}><Suspense fallback={null}>
      <SaunaScene stage={stage} loylyEvents={loylyEvents} onReady={ready} onError={failed} />
    </Suspense></SceneBoundary>}
    </div>
    <div className="scene-status" role="status">
      {status === 'loading' ? '3Dを読み込み中 · 2Dで体験を続けられます' : status === 'failed' ? '3Dを表示できないため、2Dで続けています' : 'ドラッグ / スワイプで見回す'}
    </div>
  </>;
}
export default function SceneMode({ stage, opacity = 1, loylyEvents }: { stage: Stage; opacity?: number; loylyEvents: EventTarget }) {
  const [enabled, setEnabled] = useState(initialSceneMode);
  const toggle = () => {
    const next = !enabled; setEnabled(next);
    try { localStorage.setItem(STORAGE_KEY, next ? '3d' : '2d'); } catch { /* Optional preference. */ }
    // Keep an explicit URL choice consistent with the switch, including reloads.
    const url = new URL(window.location.href);
    if (url.searchParams.has('view')) { url.searchParams.set('view', next ? '3d' : '2d'); window.history.replaceState(null, '', url); }
  };
  return <>
    {enabled && stage !== 'start' && <ActiveScene stage={stage} opacity={opacity} loylyEvents={loylyEvents} />}
    <div className="scene-mode-controls">
      <button type="button" onClick={toggle} aria-pressed={enabled}> {enabled ? '2Dに切り替え' : '3Dを試す'} </button>
      {enabled && <a href={`${import.meta.env.BASE_URL}models/CREDITS.md`} target="_blank" rel="noreferrer">素材クレジット</a>}
      {enabled && stage === 'start' && <span>入室すると3Dで体験できます</span>}
    </div>
  </>;
}
