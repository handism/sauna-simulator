import * as THREE from 'three';

// Keep the complete particle shape still when reduced motion is requested.
// Opacity and the six-second lifetime are controlled by the scene.
export function updateSteamPositions(positions: Float32Array, age: number, reducedMotion: boolean) {
  const count = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const rise = reducedMotion ? (i / count) * 2 : (age * 0.35 + (i / count) * 1.6) % 2;
    positions[i * 3] = Math.sin(i * 2.4) * (0.15 + rise * 0.3);
    positions[i * 3 + 1] = rise;
    positions[i * 3 + 2] = Math.cos(i * 2.4) * (0.15 + rise * 0.3);
  }
}

const PARTICLES = 90;
const LIFETIME_SECONDS = 6;
const PEAK_OPACITY = 0.24;

/**
 * The löyly's puff of steam above the stove: a six-second rise from each `start`. It stays visible
 * until the first `update` or `stop`, so the scene's compile includes its program.
 */
export function createSteam() {
  const positions = new Float32Array(PARTICLES * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const puff = document.createElement('canvas');
  puff.width = puff.height = 64;
  const ctx = puff.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const material = new THREE.PointsMaterial({
    color: '#eff4f5',
    size: 0.45,
    map: new THREE.CanvasTexture(puff),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  let started = -Infinity;
  return {
    points,
    /** Starts a puff at `now` (performance.now() milliseconds). */
    start(now: number) {
      started = now;
    },
    /** Ends any puff at once. */
    stop() {
      started = -Infinity;
      points.visible = false;
    },
    /** Shows the puff while it lasts and `active` holds (the sauna stage). */
    update(now: number, active: boolean, reducedMotion: boolean) {
      const age = (now - started) / 1000;
      points.visible = active && age < LIFETIME_SECONDS;
      if (!points.visible) return;
      material.opacity = PEAK_OPACITY * Math.sin(Math.min(1, age / LIFETIME_SECONDS) * Math.PI);
      updateSteamPositions(positions, age, reducedMotion);
      geometry.attributes.position.needsUpdate = true;
    },
  };
}
