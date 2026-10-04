import type { ReactNode } from 'react';

interface IconButtonProps {
  label: string;
  shortcut: string;
  pressed: boolean;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}

function IconButton({ label, shortcut, pressed, onClick, className = 'icon-btn', children }: IconButtonProps) {
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={`${label} (${shortcut})`}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}

export function UiToggleButton({ isUiHidden, onToggle }: { isUiHidden: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label={isUiHidden ? 'UI表示' : 'UI非表示'}
      shortcut="U"
      pressed={isUiHidden}
      onClick={onToggle}
      className="icon-btn ui-toggle-btn"
    >
      {isUiHidden ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </IconButton>
  );
}

export function MuteButton({ isMuted, onToggle }: { isMuted: boolean; onToggle: () => void }) {
  return (
    <IconButton label={isMuted ? 'ミュート解除' : 'ミュート'} shortcut="M" pressed={isMuted} onClick={onToggle}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      {isMuted ? (
        <>
          <line x1="23" y1="9" x2="17" y2="15" />
          <line x1="17" y1="9" x2="23" y2="15" />
        </>
      ) : (
        <>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </>
      )}
    </IconButton>
  );
}

export function FullscreenButton({ isFullscreen, onToggle }: { isFullscreen: boolean; onToggle: () => void }) {
  return (
    <IconButton
      label={isFullscreen ? '全画面を終了' : '全画面表示'}
      shortcut="F"
      pressed={isFullscreen}
      onClick={onToggle}
    >
      {isFullscreen ? (
        <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
      ) : (
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
      )}
    </IconButton>
  );
}
