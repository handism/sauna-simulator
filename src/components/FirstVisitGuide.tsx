import { useState } from 'react';
import { readPreference, writePreference } from '../utils/preferences';

export default function FirstVisitGuide() {
  const [dismissed, setDismissed] = useState(
    () => readPreference('sui-guide-dismissed', ['yes', 'no'], 'no') === 'yes',
  );
  if (dismissed) return null;
  return (
    <aside className="first-visit-guide">
      {/* 次へ進むタイミングは滞在時間の「好きなタイミングで次へ」が伝えるため、ロウリュの説明だけにする */}
      <p>ロウリュで石に水をかけ、蒸気を楽しめます。</p>
      <button
        className="text-control"
        onClick={() => {
          setDismissed(true);
          writePreference('sui-guide-dismissed', 'yes');
        }}
      >
        わかりました
      </button>
    </aside>
  );
}
