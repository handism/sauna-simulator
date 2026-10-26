/**
 * The 3D load fails once nothing arrives (or, after the downloads, nothing finishes) for this long
 * (ms): a slow connection still gets the scene while its downloads keep coming. SceneMode.tsx
 * counts it over the lazy JavaScript too, SaunaScene.tsx over its own downloads and preparation.
 */
export const LOAD_STALL_MS = 30_000;
