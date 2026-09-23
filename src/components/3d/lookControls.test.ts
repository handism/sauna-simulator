import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachLookControls } from './lookControls';

function pointer(type: string, pointerId: number, clientX: number, clientY: number, isPrimary = true) {
  return Object.assign(new Event(type), { pointerId, clientX, clientY, isPrimary, button: 0 });
}
function setup() {
  const element = document.createElement('div');
  element.setPointerCapture = () => {};
  const camera = new THREE.PerspectiveCamera();
  camera.rotation.order = 'YXZ';
  return { element, camera, controls: attachLookControls(element, camera) };
}

describe('attachLookControls', () => {
  it('only lets the pointer that started the drag end it', () => {
    const { element, camera } = setup();
    element.dispatchEvent(pointer('pointerdown', 1, 100, 100));
    element.dispatchEvent(pointer('pointerup', 2, 100, 100, false));
    element.dispatchEvent(pointer('pointermove', 1, 50, 100));
    expect(camera.rotation.y).toBeCloseTo(0.2);
    element.dispatchEvent(pointer('pointercancel', 1, 50, 100));
    element.dispatchEvent(pointer('pointermove', 1, 0, 100));
    expect(camera.rotation.y).toBeCloseTo(0.2);
  });

  it('clamps the pitch, supports arrow keys and stops after dispose or cancel', () => {
    const { element, camera, controls } = setup();
    for (let i = 0; i < 30; i++) element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(camera.rotation.x).toBeCloseTo(0.85);
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(camera.rotation.y).toBeCloseTo(0.08);
    element.dispatchEvent(pointer('pointerdown', 1, 0, 0));
    controls.cancel();
    element.dispatchEvent(pointer('pointermove', 1, 100, 0));
    expect(camera.rotation.y).toBeCloseTo(0.08);
    controls.dispose();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(camera.rotation.y).toBeCloseTo(0.08);
  });
});
