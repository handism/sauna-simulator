import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SceneMode from './SceneMode';
import type { SceneProps } from './3d/SaunaScene';

const audio = {
  init: vi.fn(),
  playAmbient: vi.fn(),
  stopAmbient: vi.fn(),
  playLoyly: vi.fn(),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  setSpatialPose: vi.fn(),
  setWeather: vi.fn(),
};
const steam = vi.hoisted(() => vi.fn());
const mountScene = vi.hoisted(() => vi.fn());
vi.mock('./3d/SaunaScene', () => ({
  default: function MockScene({
    stage,
    quality,
    lightingMode,
    weather,
    season,
    enteredAt,
    loylyEvents,
    onReady,
    onError,
    onGardenLoading,
  }: SceneProps) {
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
      <>
        <button
          data-quality={quality}
          data-lighting={lightingMode}
          data-weather={weather}
          data-season={season}
          data-entered-at={enteredAt}
          onClick={onError}
        >
          simulate context loss
        </button>
        <button onClick={() => onGardenLoading?.(true)}>simulate garden request</button>
        <button onClick={() => onGardenLoading?.(false)}>simulate garden end</button>
      </>
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
  it('persists the 3D season without remounting the scene and hides the control in 2D', async () => {
    render(<SceneMode audio={audio} stage="sauna" loylyEvents={new EventTarget()} />);
    expect(screen.queryByRole('combobox', { name: '3Dの季節' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    await screen.findByRole('button', { name: 'simulate context loss' });
    const mounts = mountScene.mock.calls.length;
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの季節' }), { target: { value: 'autumn' } });
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-season', 'autumn');
    expect(localStorage.getItem('sui-season')).toBe('autumn');
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの季節' }), { target: { value: 'winter' } });
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-season', 'winter');
    expect(localStorage.getItem('sui-season')).toBe('winter');
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの季節' }), { target: { value: 'spring' } });
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-season', 'spring');
    expect(localStorage.getItem('sui-season')).toBe('spring');
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの季節' }), { target: { value: 'autumn' } });
    expect(mountScene.mock.calls.length).toBe(mounts);
    fireEvent.click(screen.getByRole('button', { name: '2Dに切り替え' }));
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-season', 'autumn'),
    );
  });
  it('tells that the garden is still loading in the ready scene', async () => {
    render(<SceneMode audio={audio} stage="sauna" loylyEvents={new EventTarget()} />);
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    fireEvent.click(await screen.findByRole('button', { name: 'simulate garden request' }));
    expect(screen.getByRole('status')).toHaveTextContent('ドラッグ / スワイプで見回す · 庭の木々を読み込み中');
    fireEvent.click(screen.getByRole('button', { name: 'simulate garden end' }));
    expect(screen.getByRole('status')).toHaveTextContent(/^ドラッグ \/ スワイプで見回す$/);
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
    // The entry time reaches the scene for the automatic lighting without remounting it.
    expect(screen.getByRole('button', { name: 'simulate context loss' })).not.toHaveAttribute('data-entered-at');
    view.rerender(<SceneMode audio={audio} stage="sauna" enteredAt={1234} loylyEvents={events} />);
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-entered-at', '1234');
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
    fireEvent.change(screen.getByRole('combobox', { name: '3Dの時間帯' }), { target: { value: 'night' } });
    expect(localStorage.getItem('sui-lighting-mode')).toBe('night');
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-lighting', 'night');
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
  it('chooses the weather in 2D and 3D: the sound, the 2D rain outdoors and the scene follow it', async () => {
    audio.setWeather.mockClear();
    const events = new EventTarget();
    const view = render(<SceneMode audio={audio} stage="start" loylyEvents={events} />);
    const select = screen.getByRole('combobox', { name: '天気' });
    expect(select).toHaveValue('clear');
    expect(audio.setWeather).toHaveBeenLastCalledWith('clear');
    fireEvent.change(select, { target: { value: 'rain' } });
    expect(localStorage.getItem('sui-weather')).toBe('rain');
    expect(audio.setWeather).toHaveBeenLastCalledWith('rain');
    // Before entering and in the sauna room no rain is drawn over the picture.
    expect(document.querySelector('.rain-2d')).toBeNull();
    view.rerender(<SceneMode audio={audio} stage="sauna" loylyEvents={events} />);
    expect(document.querySelector('.rain-2d')).toBeNull();
    view.rerender(<SceneMode audio={audio} stage="water" loylyEvents={events} />);
    expect(document.querySelector('.rain-2d')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: '3Dを試す' }));
    expect(await screen.findByRole('button', { name: 'simulate context loss' })).toHaveAttribute(
      'data-weather',
      'rain',
    );
    const mounts = mountScene.mock.calls.length;
    fireEvent.change(screen.getByRole('combobox', { name: '天気' }), { target: { value: 'clear' } });
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-weather', 'clear');
    expect(mountScene).toHaveBeenCalledTimes(mounts);
    expect(document.querySelector('.rain-2d')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: '天気' }), { target: { value: 'snow' } });
    expect(audio.setWeather).toHaveBeenLastCalledWith('snow');
    expect(screen.getByRole('button', { name: 'simulate context loss' })).toHaveAttribute('data-weather', 'snow');
    expect(document.querySelector('.snow-2d')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('.rain-2d')).toBeNull();
    view.unmount();
    render(<SceneMode audio={audio} stage="start" loylyEvents={events} />);
    expect(screen.getByRole('combobox', { name: '天気' })).toHaveValue('snow');
    cleanup();
    localStorage.setItem('sui-weather', 'hail');
    render(<SceneMode audio={audio} stage="start" loylyEvents={events} />);
    expect(screen.getByRole('combobox', { name: '天気' })).toHaveValue('clear');
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
