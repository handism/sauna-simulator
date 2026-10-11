# UI変更後の通常ブラウザ回帰全体（2026-10-11）

前回の通常回帰（[2026-10-10](../browser-regression-20261010/README.md)）の後に入ったUIの文言・配置・スタイル変更（`cbd0368`・`af59623`：`App.tsx`、`TotonouSpace.tsx`、`StageDock.tsx`、`SceneMode.tsx`、`SoundControl.tsx`、`HeartRateRow.tsx`、`ControlButtons.tsx`、`FirstVisitGuide.tsx`、`index.css` と `quiet-ui`／`ui-comfort` のe2e）を含む現ソースで、Chrome 154.0.8037.98・headless・1 workerの通常回帰を全体実行した。20ファイル70件すべて成功、所要937.15秒（15分37秒）。失敗・skip・flaky・再試行なし。全結果が1回の実行で成功していることを照合した。[入力ハッシュ・各検査の時間・非HDR添付観測](validation.json)。

非HDR17件（`no-hdr`・`-loading`・`-compile`・`-body-compile`・`-parse`・`-garden-parse`）すべてのJSON観測で `errors` が空。前回からハッシュが変わった入力は上記UI関連ファイルと検査・fixtureのみで、`SaunaScene.tsx`（`sourceSHA256`）・モデル・Playwright設定は同一。今回から、ハッシュ対象186入力全体の集約値 `inputsSHA256`（パス順の `shasum` 形式の行を連結したsha256）を追加した。

UI（入室画面・ツールバーの文字付きアイコン・UI非表示・ドックのコンパクト／詳細・外気浴の振り返り／スコア・狭幅／横長）、キーボード・タッチ、動作抑制、音声ノード、3Dライフサイクル・分割準備・シェーダー故障からの2D復帰、取得・parse・compile待ち中の競合・期限・コンテキスト喪失、資源数・描画制御を同じ実行で確認した。

```sh
bun run test:browser --reporter=json > "$TMPDIR/reg1011/report.json"
# 先頭のビルドログを除いてから集計（記録の reportSha256 は除去後のJSON）
```

型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。プレビューのlistenがサンドボックスで制限されるため許可環境で実行。生レポート・画像はローカルのみ。製品コード・配信物・テストは変更していない。長時間soak・回線制限・静止画像比較・動画の再実行、実機性能、GPU総メモリ、実聴の承認ではない。既定2Dと明示3D・split試験オプションを維持。
