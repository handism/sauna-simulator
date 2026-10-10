# 実Safariの手動検査（2026-10-10）

実Safari **27.0.1 (22625.1.29.11.28)**、macOS 27.0.1、Mac Studio Mac13,1 / M1 Max / 24 GPU cores / 32GB。WebKitの自動検査とは別の、ネイティブUI／開発コンソールと画面を使った手動検査。観測を `observations.json` に転記した。スクリーンショットとAX証拠はツール会話記録内にあり、ネイティブ画面ファイルは書き出していない。

修正前の2Dでは音なし入室、3ステージの一周と2セット目、Uの非表示／復帰、ミュート表示を確認。修正前の最初の3D入室にシェーダーリンクエラーが出たので、これを正常承認していない。同じ設定での再試行では非空リンクログ0だった。エラー全文は切れており自然発生エラーの原因は未確定。

修正後の新規タブで**入室前**にWebGL2 `getProgramInfoLog` とerror/unhandledrejectionの記録フックを有効化。高精細・split・TAA onで3ステージの表示、ドラッグ見回し、U復帰、ミュート維持を確認。本体／庭の未描画0・庭ready、非空リンクログ0・ページ例外0。開発ツール表示中の実測CSS viewportは1723×827・DPR1（自動検査の1280×800とは別）。

実 `WEBGL_lose_context` で2Dへ復帰し、外気浴セッションを保った手動2D→3D再試行に成功。喪失済みコンテキストの破棄時にはThreeのextension-not-supported警告が1件出たが、再試行のリンクログ・ページ例外は0。

次に実fragment shaderへ `INVALID_SHADER_DIAGNOSTIC` を挿入して、高精細→軽量で新規プログラムを生成。36 shaderSourceの故障注入、1 programのリンクログ `Fragment shader is not compiled.`、ページ例外0、canvas0と2D復帰を確認。注入を解除して2D→3Dを再試行し、軽量・庭ready・外気浴・ミュートtrue、追加リンクログ0・ページ例外0まで確認した。この故障注入は自然発生のMSLエラーの再現ではない。

検査タブ2つを閉じ、既存スタートページを残し、一時サーバーを停止。ブラウザのセキュリティ設定やOS設定は変えていない。

実Safariでの限定的な表示・復帰確認であり、自然発生エラーの原因解消、全照明条件、全視点連続動画、性能、GPU総メモリ、モバイル／非HDR実機、実聴の承認ではない。

## 自然発生エラーが再現したときの全文取得

新規ページの**入室前**に開発コンソールで以下を実行する。これは次回の切り分け用手順であり、今回の自然発生エラー全文を取得済みという意味ではない。

```js
(() => {
  window.linkLogs = { programs: [], shaders: [] };
  const prototype = WebGL2RenderingContext.prototype;
  for (const [method, key] of [
    ['getProgramInfoLog', 'programs'],
    ['getShaderInfoLog', 'shaders'],
  ]) {
    const original = prototype[method];
    prototype[method] = function (...args) {
      const log = original.apply(this, args);
      if (log) window.linkLogs[key].push(log);
      return log;
    };
  }
})();
```

3Dが失敗したら `linkLogs` の内容を保存する。AX出力で長い行が省略される場合は、各ログを80文字ずつ出す。

```js
for (const [kind, logs] of Object.entries(linkLogs)) {
  logs.forEach((log, index) => {
    for (let offset = 0; offset < log.length; offset += 80) {
      console.log(kind, index, offset, log.slice(offset, offset + 80));
    }
  });
}
```

shaderの警告だけを失敗原因と断定せず、programのリンク失敗・末尾のMSLエラーと合わせて確認する。ブラウザやOSのキャッシュ・セキュリティ設定は変更しない。
