import { useCallback, useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}

const getSnapshot = () => Boolean(document.fullscreenElement);
const getServerSnapshot = () => false;

/** Whole-page fullscreen. Unsupported where the unprefixed API is missing (iPhone Safari). */
export function useFullscreen() {
  const isSupported = document.fullscreenEnabled === true;
  const isFullscreen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    if (!document.fullscreenEnabled) return;
    const request = document.fullscreenElement
      ? document.exitFullscreen()
      : document.documentElement.requestFullscreen();
    // A refused request (no user activation, browser policy) leaves the view as it is.
    request.catch(() => {});
  }, []);

  return { isSupported, isFullscreen, toggle };
}
