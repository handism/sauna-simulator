import type { Page } from '@playwright/test';

// Let camera, lighting and temporal history settle before a static pixel comparison.
export async function settleRenderer(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 70;
        const step = () => {
          if (--frames === 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
}

// Locator screenshots include DOM overlays above the canvas. Exclude these only
// for renderer/Cycles comparisons; the full-surround survey keeps the real UI effects.
export const rendererCaptureStyle = `
  .app-stage-container, .scene-mode-controls, .app-toolbar {
    visibility: hidden !important;
    transition: none !important;
  }
`;
