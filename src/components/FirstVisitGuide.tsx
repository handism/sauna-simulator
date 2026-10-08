/** 表示の有無と保存は SaunaRoom が持つ（初回のロウリュでも閉じるため） */
export default function FirstVisitGuide({ onDismiss }: { onDismiss: () => void }) {
  return (
    <aside className="first-visit-guide">
      {/* 次へ進むタイミングは滞在時間の「好きなタイミングで次へ」が伝えるため、ロウリュの説明だけにする */}
      <p>ロウリュで石に水をかけ、蒸気を楽しめます。</p>
      <button className="text-control" onClick={onDismiss}>
        わかりました
      </button>
    </aside>
  );
}
