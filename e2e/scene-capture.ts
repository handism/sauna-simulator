// Locator screenshots include DOM overlays above the canvas. Exclude these only
// for renderer/Cycles comparisons; the full-surround survey keeps the real UI effects.
export const rendererCaptureStyle = `
  .app-stage-container, .scene-mode-controls, .mute-btn {
    visibility: hidden !important;
    transition: none !important;
  }
`;
