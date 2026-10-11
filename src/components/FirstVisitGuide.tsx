/** 表示の有無と保存は SaunaRoom が持つ（初回のロウリュでも閉じるため） */
export default function FirstVisitGuide({ onDismiss }: { onDismiss: () => void }) {
  return (
    <aside className="first-visit-guide">
      <p>
        ロウリュで石に水をかけ、蒸気を楽しめます。
        <span className="first-visit-scenery">右上の「景色だけ見る」で操作を隠せます。</span>
      </p>
      <button className="text-control" onClick={onDismiss}>
        わかりました
      </button>
    </aside>
  );
}
