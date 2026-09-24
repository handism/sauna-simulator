import { useEffect, useRef, type RefObject } from 'react';

const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
// Controls the browser already activates with Space.
const SPACE_ACTIVATED = 'button, a[href], summary, [role="button"], [role="checkbox"], [role="switch"], [role="tab"]';

interface ShortcutOptions {
  enabled?: boolean;
  /** Presses are ignored while this element is detached or inside an `inert` subtree. */
  scope?: RefObject<HTMLElement | null>;
}

// Whether the focused element got focus from a pointer press. `:focus-visible` cannot tell:
// Chrome makes a clicked button match it as soon as a key is pressed.
let pointerDown = false;
let pointerFocused: EventTarget | null = null;
let trackingFocusOrigin = false;

function trackFocusOrigin() {
  if (trackingFocusOrigin) return;
  trackingFocusOrigin = true;
  const release = () => {
    pointerDown = false;
  };
  document.addEventListener('pointerdown', () => (pointerDown = true), true);
  document.addEventListener('pointerup', release, true);
  document.addEventListener('pointercancel', release, true);
  // A release outside the window is never seen; Tab still moves focus by keyboard.
  document.addEventListener('keydown', release, true);
  document.addEventListener('focusin', (event) => (pointerFocused = pointerDown ? event.target : null), true);
}

/**
 * Single unmodified key on `window`. `key` is lower-case (`' '` for Space). Repeats, IME
 * composition and presses aimed at form fields are left to the browser.
 */
export function useKeyboardShortcut(key: string, onPress: () => void, { enabled = true, scope }: ShortcutOptions = {}) {
  const onPressRef = useRef(onPress);
  useEffect(() => {
    onPressRef.current = onPress;
  });

  useEffect(() => {
    if (!enabled) return;
    trackFocusOrigin();
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== key) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(TEXT_ENTRY)) return;
      if (scope) {
        const root = scope.current;
        if (!root?.isConnected || root.closest('[inert]')) return;
      }
      const control = key === ' ' ? target?.closest<HTMLElement>(SPACE_ACTIVATED) : null;
      if (control) {
        // Keyboard users keep Space on the control they tabbed to. A control focused by a
        // click (e.g. the mute button) gives focus up, so its keyup cannot click it as well.
        if (!(pointerFocused instanceof Node && control.contains(pointerFocused))) return;
        control.blur();
      }
      event.preventDefault();
      onPressRef.current();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [key, enabled, scope]);
}
