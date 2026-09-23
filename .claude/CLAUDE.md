# CLAUDE.md

## コマンド

- パッケージマネージャは **bun**（`package-lock.json` が残っているが使わない）
- `vitest.bench.config.ts` は現状どこからも使われていない。`src/hooks/useAudioEngine.bench.test.ts` は名前に反して `describe`/`it` による通常のテストで、`bun run test` の対象に含まれる（`vitest bench` の対象ではない）

## アーキテクチャ

### ステージ遷移フロー

ステージは `start → sauna → water → totonou` の順に進み、`totonou` から `sauna` に戻るループ構造になっている。

- セッション状態は `src/hooks/useSaunaSession.ts` が保持し、`SaunaProvider` / `useSaunaContext`（`src/context/SaunaContext.tsx`）経由で配布する。`App.tsx` はセッション値をcontextから読み、ロウリュ通知用の `EventTarget` だけを保持する
- ステージ遷移は `changeStage()` が単一の1秒タイマーで管理する。`pendingStage` を設定してUIと背景を暗転し、1秒後にステージ・環境音を同時に切り替えてフェードインする。遷移中の二重操作は拒否し、ステージUIには `inert` を付ける
- 2D背景は現在のステージの1枚のみ描画する（`public/sauna_bg.png`, `water_bg.png`, `totonou_bg.png`）。背景専用タイマーは持たず、3Dレイヤー・UIと同じ `opacity` で遷移する

### オーディオ

`src/hooks/useAudioEngine.ts` にカプセル化されており、**外部音声ファイルは一切使用しない**。すべて Web Audio API でプロシージャル生成している（ノイズ生成は `src/hooks/audioWorker.ts` の Web Worker 側で行う）。

`audio.init()` はユーザーインタラクション（スタートボタン）のタイミングで呼ぶ必要がある（ブラウザの autoplay 制限対応）。

## 規約・パターン

### スタイリング
- グローバルスタイルは `src/index.css` に CSS カスタムプロパティ（`--accent`, `--glass-bg` 等）で定義
- 共通 UI は `.glass-panel`（glassmorphism）と `.primary-btn` の2クラスを使う
- ステージ固有の色や背景はコンポーネント内のインラインスタイルで上書きする
- アニメーション（`steam-rise`, `ripple`, `breathe`）は `index.css` の `@keyframes` で定義済み

### コンポーネント設計
- 各ステージコンポーネント（`SaunaRoom`, `CoolingBath`, `TotonouSpace`）は `onNext` コールバックを受け取り、次ステージへの遷移をトリガーする
- `audio` と各種セッション値は `App.tsx` が `useSaunaContext()` から取得し、props で各コンポーネントに渡す。コンポーネント側は context を直接参照しない

## 3Dサウナ試験版

- `?view=3d` または「3Dを試す」で有効化。`?view=2d` は保存済みの選択を上書きする。選択は `sui-view-mode` に保存し、未選択時は2D。
- `SceneMode` は表示設定・ロード状態だけを管理し、セッションを作り直さない。サウナ・水風呂・外気浴の3ステージに対応し、ステージ変更時はモデルと描画ループを保持して視点だけを更新する。
- Three.js 0.186.0を直接ラップした `src/components/3d/SaunaScene.tsx` は `React.lazy` で遅延ロードする。3D専用チャンクは通常の2D利用時に取得しない。
- `App` が所有する `EventTarget` に `SaunaRoom.onLoyly` から押下を通知。音は従来の `audio.playLoyly()` で一度だけ再生。3Dはロード完了後の通知だけを消費し、過去の通知は保存しない。
- 見回しはPointer Events／矢印キー。3DはUI外で入力を受け、UI復帰・モード切り替えは常に残す。モデル失敗・30秒タイムアウト・WebGLコンテキスト喪失時は3Dを解放し2D表示を継続。
- Blender元データは `blender/` に置くがGit管理外。追跡する書き出し処理は `scripts/export_web_glb.py`、配信物は `public/models/`。入力を保存しない。再実行方法・未完了事項は `docs/3d-sauna-progress.md`。
- `bunx tsc -b` / `bun run test` / `bun run lint` / `bun run build` を検証する。ESLintはTS/TSXも対象。既存テストの段階的移行のため `no-explicit-any` は無効。
- `SaunaScene` のDOM `data-*` 属性に初回ロード時間、描画数、初期180フレームの間隔を記録する。Reactの毎フレーム更新は行わない。
- 体験用視点と水面位置の正本は `scripts/web_scene.py`。`python3 scripts/web_scene.py` でシーン定義だけ再生成できる。GLB再出力時も同じ関数を呼ぶ。
- 水は元GLBの閉じた水形状を非表示にし、`waterEffects.ts` の境界付き水面・波紋・注水に置き換える。動きを減らす設定では波紋・注水の時間更新を止める。最適化は未完了。
- 昼／夕暮れ／自動は `lighting.ts` で管理。`sui-lighting-mode` に保存し、3Dモデルを再ロードせずに反映する。自動は各周回でサウナ=昼、水風呂=中間、外気浴=夕暮れ。ステージ変更時は暗転中に適用し、手動変更は補間する。動きを減らす設定では即時適用。

- 空間音響は `src/hooks/spatialAudio.ts`。既存AudioContextの2本の固定バスでストーブ（サウナ環境音・ロウリュ）と注水口（水風呂音）をHRTF定位する。風・バイノーラル音は従来の経路を維持。
- `App → SceneMode → SaunaScene` に同一 `audio` を渡す。シーン定義の座標とカメラの位置・前方・上方向を `audio.setSpatialPose()` で反映し、アンマウント時は `null` で2D音へクロスフェード。モデル再読込・新たなAudioContextや音源の作成は行わない。AudioListenerの位置パラメータ非対応時は従来音へフォールバック。

- 3D画質は `quality.ts` の軽量／標準／高精細。`sui-quality` に保存し既定は標準。DPR上限は1／1.5／2、日光の影は無効／1024／2048px。モデルを保持したまま反映し、画質変更時は180フレームの計測をリセットする。
- 日光だけが影を描く。ガラス・水・蒸気は影を投射しない。日光方向を補間量0.01刻みにし、その方向・影解像度の変更時だけシャドウマップを更新。軽量切り替え・シーン解放時に影のGPUリソースを解放する。これはベイクではない。
- `SaunaScene` は描画数・三角形数・テクスチャ数・ジオメトリ数もDOM属性へ記録。描画数は最新フレームの値なので、照明補間中の影パスを含む値と、安定後の値を区別する。

- 葉の書き出しは `export_web_glb.py` の `sample_whole_leaves()`。接続成分を葉として名前をseedに選び、元の位置・向き・広がりを近似した2三角形の平面へ変換する。近景V11 mapleは700三角形、その他は350三角形を上限とする。建物のDecimateとは分離。V11の奥の植栽帯はBlender座標 `abs(x)<=23, -20<=y<-13` の範囲を復元し、材質別に結合する。葉の細かな切れ込みは再現しない。

- 3Dの取得失敗・タイムアウト・コンテキスト喪失は `SaunaScene` 内で一度だけ失敗確定し、通信・描画を停止して2D音へ戻す。非同期取得／解析の完了時にも失敗・解除を判定し、遅着モデルは解放する。`SaunaScene.test.tsx` は模擬レンダラーでこの競合と解放を検証する（実GPUの検証ではない）。

- 実ブラウザ回帰検証は `bun run test:browser`。本番ビルドを生成し、専用の127.0.0.1:4175でプレビュー、インストール済みGoogle Chromeをheadless起動する。`e2e/*.e2e.ts` はVitestと分離し、型検査・Lintの対象に含める。5回の2D/3D切り替え、ステージ一巡、`WEBGL_lose_context`による喪失後の2D継続と再試行、取得保留中の解除、実時間30秒のタイムアウトを確認する。`test-results/` はGit管理外。GPU総メモリ・長時間・実機タッチ・音の実聴を検証するものではない。

- 蒸気の座標更新は `steam.ts`。動きを減らす設定では全軸を固定し、濃淡と6秒の表示時間は維持する。`scene-viewport.e2e.ts` は390×844の操作・キーボード見回し・844×390とのリサイズ・同一canvas保持を検証。Chromeの画面サイズとメディア設定のエミュレーションであり、モバイル実機の検証ではない。

- 見回し終了は操作開始時のpointerIdに一致する場合だけ処理し、別の指の終了・キャンセル・キャプチャ喪失で中断しない。`scene-touch.e2e.ts` はChromeのCDPタッチ入力でスワイプ、2本目の指を離した後の操作継続、キャンセル後の再操作、タップでのUI復帰・ステージ一巡・2D復帰を検証する。モバイル実機やSafariの検証ではない。

- 継続利用の検証は `bun run test:browser:soak`。専用の `playwright.soak.config.ts` で `e2e/*.soak.ts` のみ実行し、通常のブラウザ回帰検証から分離する。実時間5分以上、3画質・昼夕・ロウリュ・ステージ一巡・2D/3D再生成を繰り返し、同じステージ／画質のテクスチャ・ジオメトリ数を比較する。全計測値は `stability-samples` 添付JSONへ保存し、`--reporter=json` で取得可能。大量のtrace記録による負荷を避けるため、この設定ではtraceを無効にする。GPU総メモリ・音声ノード数・実機性能やリーク不存在を証明する検証ではない。

- `SceneMode` の `ActiveScene` は遅延JavaScript取得も含む読み込み全体に30秒の期限を設ける。ステージ・画質・時間帯の変更で期限を延長せず、準備完了・失敗・2D切り替え時にタイマーを解除する。期限後にモジュールが届いても自動で3Dを開始しない。`scene-chunk.e2e.ts` は通常2Dで3D用JS／モデルを取得しないことと、JS取得保留中の期限切れ・遅着・手動再試行を本番ビルドで検証する。通信帯域の性能測定ではない。
