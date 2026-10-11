import { useEffect, useRef, useState, type ReactNode } from 'react';

export default function StageDock({
  className = '',
  children,
  onFinish,
}: {
  className?: string;
  children: ReactNode;
  onFinish?: () => void;
}) {
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
    <div ref={panelRef} className={`glass-panel stage-dock ${className}`} data-overflow={overflow}>
      <div ref={contentRef}>
        {children}
        {onFinish && (
          <button type="button" className="dock-finish" onClick={onFinish}>
            体験を終える
          </button>
        )}
      </div>
    </div>
  );
}
