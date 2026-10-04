import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { readPreference, writePreference } from '../utils/preferences';

export default function StageDock({ className = '', children }: { className?: string; children: ReactNode }) {
  const [compact, setCompact] = useState(() => readPreference('sui-dock', ['full', 'compact'], 'full') === 'compact');
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // 低い画面で中身がはみ出すときは、主操作をパネル下端に固定する（スクロールの先に隠さない）
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const panel = panelRef.current;
    const content = contentRef.current;
    if (!panel || !content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setOverflow(panel.scrollHeight > panel.clientHeight + 1));
    observer.observe(panel);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={panelRef}
      className={`glass-panel stage-dock ${className}`}
      data-compact={compact}
      data-overflow={overflow}
    >
      {/* パネル上端の取っ手。押すと詳細をたたむ／ひらく */}
      <button
        type="button"
        className="dock-handle"
        aria-label={compact ? '詳しく表示' : 'コンパクト表示'}
        title={compact ? '詳しく表示' : 'コンパクト表示'}
        aria-expanded={!compact}
        aria-controls={id}
        onClick={() => {
          setCompact(!compact);
          writePreference('sui-dock', compact ? 'full' : 'compact');
        }}
      >
        <span className="dock-handle-bar" aria-hidden="true" />
        <svg
          className="dock-handle-chevron"
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={compact ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
        </svg>
      </button>
      <div ref={contentRef} id={id}>
        {children}
      </div>
    </div>
  );
}
