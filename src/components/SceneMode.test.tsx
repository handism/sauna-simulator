import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SceneMode from './SceneMode';
import type { SceneProps } from './3d/SaunaScene';

const steam = vi.hoisted(() => vi.fn());
const mountScene = vi.hoisted(() => vi.fn());
vi.mock('./3d/SaunaScene', () => ({ default: function MockScene({stage, loylyEvents, onReady, onError}: SceneProps) {
  useEffect(() => { mountScene(); }, []);
  useEffect(() => {
    onReady(); if (stage !== 'sauna') return; loylyEvents.addEventListener('loyly', steam);
    return () => loylyEvents.removeEventListener('loyly', steam);
  }, [stage, loylyEvents, onReady]);
  return <button onClick={onError}>simulate context loss</button>;
}}));

describe('3D mode lifecycle', () => {
  beforeEach(() => { const storage = new Map<string, string>(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }); window.history.replaceState(null, '', '/'); steam.mockClear(); mountScene.mockClear(); });
  it('defaults to 2D and honors a stored choice and explicit URL override', () => {
    const events = new EventTarget();
    const first = render(<SceneMode stage="sauna" loylyEvents={events} />);
    expect(screen.getByRole('button', {name:'3Dを試す'})).toHaveAttribute('aria-pressed', 'false');
    first.unmount(); localStorage.setItem('sui-view-mode', '3d');
    window.history.replaceState(null, '', '/?view=2d');
    render(<SceneMode stage="sauna" loylyEvents={events} />);
    expect(screen.getByRole('button', {name:'3Dを試す'})).toBeInTheDocument();
    expect(localStorage.getItem('sui-view-mode')).toBe('2d');
  });
  it('consumes live loyly once and never replays events across modes or stages', async () => {
    const events = new EventTarget();
    const view = render(<SceneMode stage="sauna" loylyEvents={events} />);
    events.dispatchEvent(new Event('loyly'));
    fireEvent.click(screen.getByRole('button', {name:'3Dを試す'}));
    await screen.findByRole('button', {name:'simulate context loss'});
    expect(steam).not.toHaveBeenCalled();
    events.dispatchEvent(new Event('loyly')); expect(steam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name:'2Dに切り替え'}));
    events.dispatchEvent(new Event('loyly')); expect(steam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name:'3Dを試す'}));
    await screen.findByRole('button', {name:'simulate context loss'});
    const mounts = mountScene.mock.calls.length;
    view.rerender(<SceneMode stage="water" loylyEvents={events} />);
    expect(mountScene).toHaveBeenCalledTimes(mounts);
    events.dispatchEvent(new Event('loyly')); expect(steam).toHaveBeenCalledTimes(1);
    view.rerender(<SceneMode stage="sauna" loylyEvents={events} />);
    await screen.findByRole('button', {name:'simulate context loss'});
    expect(steam).toHaveBeenCalledTimes(1);
    expect(mountScene).toHaveBeenCalledTimes(mounts);
  });
  it('falls back on failure without changing the saved selection and can retry', async () => {
    window.history.replaceState(null, '', '/?view=3d');
    render(<SceneMode stage="sauna" loylyEvents={new EventTarget()} />);
    fireEvent.click(await screen.findByRole('button', {name:'simulate context loss'}));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2Dで続けています'));
    expect(localStorage.getItem('sui-view-mode')).toBe('3d');
    fireEvent.click(screen.getByRole('button', {name:'2Dに切り替え'}));
    expect(window.location.search).toBe('?view=2d');
    fireEvent.click(screen.getByRole('button', {name:'3Dを試す'}));
    expect(await screen.findByRole('button', {name:'simulate context loss'})).toBeInTheDocument();
  });
});
