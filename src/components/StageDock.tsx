import { useId, useState, type ReactNode } from 'react';
import { readPreference, writePreference } from '../utils/preferences';

export default function StageDock({ className = '', children }: { className?: string; children: ReactNode }) {
  const [compact, setCompact] = useState(() => readPreference('sui-dock', ['full', 'compact'], 'full') === 'compact');
  const id = useId();
  return (
    <div className={`glass-panel stage-dock ${className}`} data-compact={compact}>
      <div className="dock-display-row">
        <button
          className="text-control"
          aria-expanded={!compact}
          aria-controls={id}
          onClick={() => {
            setCompact(!compact);
            writePreference('sui-dock', compact ? 'full' : 'compact');
          }}
        >
          {compact ? '詳しく表示' : 'コンパクト表示'}
        </button>
      </div>
      <div id={id}>{children}</div>
    </div>
  );
}
