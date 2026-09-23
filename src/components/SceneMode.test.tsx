import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SceneMode from './SceneMode';
import type { SceneProps } from './3d/SaunaScene';

const audio = { init: vi.fn(), playAmbient: vi.fn(), playLoyly: vi.fn(), setMuted: vi.fn(), setSpatialPose: vi.fn() };
const steam = vi.hoisted(() => vi.fn());
const mountScene = vi.hoisted(() => vi.fn());
vi.mock('./3d/SaunaScene', () => ({
  default: function MockScene({ stage, quality, lightingMode, loylyEvents, onReady, onError }: SceneProps) {
    useEffect(() => {
      mountScene();
    }, []);
    useEffect(() => {
      onReady();
      if (stage !== 'sauna') return;
      loylyEvents.addEventListener('loyly', steam);
      return () => loylyEvents.removeEventListener('loyly', steam);
    }, [stage, loylyEvents, onReady]);
    return (
      <button data-quality={quality} data-lighting={lightingMode} onClick={onError}>
        simulate context loss
      </button>
    );
  },
}));

describe('3D mode lifecycle', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    window.history.replaceState(null, '', '/');
    steam.mockClear();
    mountScene.mockClear();
  });
  it('defaults to 2D and honors a stored choice and explicit URL override', () => {
    const events = new EventTarget();
    const first = render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    expect(screen.getByRole('button', { name: '3Dを試す' })).toHaveAttribute('aria-pressed', 'false');
    first.unmount();
    localStorage.setItem('sui-view-mode', '3d');
    window.history.replaceState(null, '', '/?view=2d');
    render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    expect(screen.getByRole('button', { name: '3Dを試す' })).toBeInTheDocument();
    expect(localStorage.getItem('sui-view-mode')).toBe('2d');
  });
  it('consumes live loyly once and never replays events across modes or stages', async () => {
    const events = new EventTarget();
    const view = render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    events.dispatchEvent(new Event('loyly'));
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    await screen.findByRole('button', { name: 'simulate context loss' });
    expect(steam).not.toHaveBeenCalled();
    events.dispatchEvent(new Event('loyly'));
    expect(steam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '2Dに切り替え' }));
    events.dispatchEvent(new Event('loyly'));
    expect(steam).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    await screen.findByRole('button', { name: 'simulate context loss' });
    const mounts = mountScene.mock.calls.length;
    view.rerender(<SceneMode audio={audio} stage="water" loylyEvents={events} />);
    expect(mountScene).toHaveBeenCalledTimes(mounts);
    events.dispatchEvent(new Event('loyly'));
    expect(steam).toHaveBeenCalledTimes(1);
    view.rerender(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    await screen.findByRole('button', { name: 'simulate context loss' });
    expect(steam).toHaveBeenCalledTimes(1);
    expect(mountScene).toHaveBeenCalledTimes(mounts);
  });
  it('keeps lighting across stages and mode switches without remounting the active scene', async () => {
    localStorage.setItem('sui-view-mode', '3d');
    const events = new EventTarget();
    const view = render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    await screen.findByRole('button', { name: 'simulate context loss' });
    const mounts = mountScene.mock.calls.length;
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの時間帯' }), { target: { value: 'evening' } });
    expect(localStorage.getItem('sui-lighting-mode')).toBe('evening');
    view.rerender(<SceneMode audio={audio} stage="water" loylyEvents={events} />);
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-lighting', 'evening');
    expect(mountScene).toHaveBeenCalledTimes(mounts);
    fireEvent.click(screen.getByRole('button', { name: '2Dに切り替え' }));
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    expect(await screen.findByRole('button', { name: 'simulate context loss' })).toHaveAttribute(
      'data-lighting',
      'evening',
    );
    view.unmount();
    render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    expect(screen.getByRole('combobox', { name: '3Dの時間帯' })).toHaveValue('evening');
  });
  it('persists quality without remounting the scene or resetting it across stages and modes', async () => {
    localStorage.setItem('sui-view-mode', '3d');
    localStorage.setItem('sui-quality', 'invalid');
    const events = new EventTarget();
    const view = render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    await screen.findByRole('button', { name: 'simulate context loss' });
    const mounts = mountScene.mock.calls.length;
    expect(screen.getByRole('combobox', { name: '3Dの画質' })).toHaveValue('standard');
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの画質' }), { target: { value: 'low' } });
    expect(localStorage.getItem('sui-quality')).toBe('low');
    view.rerender(<SceneMode audio={audio} stage="water" loylyEvents={events} />);
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-quality', 'low');
    expect(mountScene).toHaveBeenCalledTimes(mounts);
    fireEvent.click(screen.getByRole('button', { name: '2Dに切り替え' }));
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    expect(await screen.findByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-quality', 'low');
    view.unmount();
    render(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    expect(screen.getByRole('combobox', { name: '3Dの画質' })).toHaveValue('low');
  });
  it('uses automatic lighting for an invalid stored preference', () => {
    localStorage.setItem('sui-view-mode', '3d');
    localStorage.setItem('sui-lighting-mode', 'invalid');
    render(<SceneMode audio={audio} stage="start" loylyEvents={new EventTarget()} />);
    expect(screen.getByRole('combobox', { name: '3Dの時間帯' })).toHaveValue('auto');
  });
  it('falls back on failure without changing the saved selection and can retry', async () => {
    window.history.replaceState(null, '', '/?view=3d');
    render(<SceneMode audio={audio} stage="sauna" loylyEvents={new EventTarget()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'simulate context loss' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2Dで続けています'));
    expect(localStorage.getItem('sui-view-mode')).toBe('3d');
    fireEvent.click(screen.getByRole('button', { name: '2Dに切り替え' }));
    expect(window.location.search).toBe('?view=2d');
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    expect(await screen.findByRole('button', { name: 'simulate context loss' })).toBeInTheDocument();
  });
});
