import { useState } from 'react';
import { readPreference, writePreference } from '../utils/preferences';

export default function FirstVisitGuide() {
  const [dismissed, setDismissed] = useState(
    () => readPreference('sui-guide-dismissed', ['yes', 'no'], 'no') === 'yes',
  );
  if (dismissed) return null;
  return (
    <aside className="first-visit-guide">
      <p>ロウリュで石に水をかけ、蒸気を楽しめます。好きなタイミングで水風呂へ。</p>
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
