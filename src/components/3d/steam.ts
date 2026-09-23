// Keep the complete particle shape still when reduced motion is requested.
// Opacity and the six-second lifetime are controlled by the scene.
export function updateSteamPositions(positions: Float32Array, age: number, reducedMotion: boolean) {
  const count = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const rise = reducedMotion ? i / count * 2 : (age * .35 + i / count * 1.6) % 2;
    positions[i * 3] = Math.sin(i * 2.4) * (.15 + rise * .3);
    positions[i * 3 + 1] = rise;
    positions[i * 3 + 2] = Math.cos(i * 2.4) * (.15 + rise * .3);
  }
}
