import * as THREE from 'three';

const PITCH_LIMIT = 0.85;
const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * Pointer and arrow-key look-around. Only the pointer that started a drag can end it,
 * so another finger lifting, a cancel or a lost capture does not interrupt the look.
 */
export function attachLookControls(element: HTMLElement, camera: THREE.PerspectiveCamera) {
  let pointer: { id: number; x: number; y: number } | null = null;
  const pitch = (delta: number) => {
    camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x + delta, -PITCH_LIMIT, PITCH_LIMIT);
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    element.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    camera.rotation.y -= (event.clientX - pointer.x) * 0.004;
    pitch(-(event.clientY - pointer.y) * 0.004);
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  };
  const up = (event: PointerEvent) => {
    if (pointer?.id === event.pointerId) pointer = null;
  };
  const key = (event: KeyboardEvent) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();
    camera.rotation.y += event.key === 'ArrowLeft' ? 0.08 : event.key === 'ArrowRight' ? -0.08 : 0;
    pitch(event.key === 'ArrowUp' ? 0.06 : event.key === 'ArrowDown' ? -0.06 : 0);
  };
  const listeners = [
    ['pointerdown', down],
    ['pointermove', move],
    ['pointerup', up],
    ['pointercancel', up],
    ['lostpointercapture', up],
    ['keydown', key],
  ] as const;
  for (const [type, listener] of listeners) element.addEventListener(type, listener as EventListener);
  return {
    /** Drop an in-progress drag, e.g. when the view jumps to another stage. */
    cancel() {
      pointer = null;
    },
    dispose() {
      for (const [type, listener] of listeners) element.removeEventListener(type, listener as EventListener);
    },
  };
}
