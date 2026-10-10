# シェーダーリンク失敗時の2D復帰（2026-10-10）

実Safari 27.0.1 (22625.1.29.11.28)・macOS 27.0.1・Mac Studio M1 Maxで高画質splitの最初の入室時に `THREE.WebGLProgram: Shader Error 1282` と `Internal error while linking shader. MSL compilation error` を観測した。材質名は submerged light / quiet honed stone / mineral c。ログ全文はSafariのアクセシビリティ出力で切れており、末尾の原因を取得できていない。表示されていた `_usuiPath` 未使用の警告だけを原因とは断定しない。同じセッションの2D→3D再試行では、`getProgramInfoLog` を記録するフックが有効なまま非空ログ0だった。初回の不具合が再現性のある材質不良か、コンパイラの一時的な失敗かは未確定。

Three.jsの既定動作はリンク失敗をログ出力して描画を続ける。その結果、欠けた3Dでも準備完了になり得るため、`renderer.debug.onShaderError` から専用例外を投げ、初回・split warmup・庭・画質変更・描画ループの所有者で停止と2D復帰を行う。失敗は一度だけ通知し、後続フレーム／非同期処理は再開しない。庭の通信・解析失敗時は従来どおり本体3Dを維持する。元のSafariリンクエラーの原因を修正したという主張ではない。

Chrome 154の本物のWebGL2 fragment shaderに不正トークンを挿入。初回／準備後の低画質変更 × 通常／splitの4条件で、2D復帰・ミュート保持・水風呂への操作・3D再試行成功・ページエラー0を確認。4/4成功、計22.73秒、skip・flaky・retryなし。最初の検査コードには設定メニューのロール指定誤りがあり修正。また標準→高精細では同じシェーダーを再利用するので、新規プログラムを作る低画質へ変更した。これら途中の失敗／中断を成功に合算しない。

単体テストは初回描画、動作中、庭のコンパイル、同期画質コンパイル、ステージ切替の5つの失敗境界を検査。

```sh
bun run test src/components/3d/SaunaScene.test.tsx
bun run test:browser e2e/scene-shader.e2e.ts --reporter=json > /private/tmp/sauna-shader-chrome.json
```

最終ソースでChrome通常回帰20ファイル70件すべて成功（937.21秒、失敗・skip・flaky・再試行なし）。同じ4つの実シェーダー故障をこの全体実行で再確認した。[Chrome記録](chrome-validation.json)／[全体QA](../browser-regression-20261010/README.md)。

WebKit 26.6では最終ソースのライフサイクル5件とシェーダー故障4件が9/9成功（117.82秒、失敗・skip・flaky・再試行なし）。[入力付き記録](webkit-validation.json)。型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェックも成功。

修正後の実Safariでも、入室前のログ捕捉で高画質splitの3ステージ表示・見回し・UI復帰を確認。実コンテキスト喪失と、準備後の実fragment shader故障のどちらでも2D復帰・手動3D再試行・ミュートと外気浴の維持に成功。[ネイティブ手動QA](../native-safari-20261010/README.md)。自然発生した最初のMSLエラーの原因は未確定。2D既定と3D opt-in、split試験オプションを維持。
