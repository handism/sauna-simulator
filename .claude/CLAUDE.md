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
- 共通 UI は `.glass-panel`（glassmorphism）と `.primary-btn` の2クラスを使う
- ステージ固有の色や背景はコンポーネント内のインラインスタイルで上書きする

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
- 3Dの詳細は作業対象ディレクトリの CLAUDE.md にある：描画・材質・照明は `src/components/3d/CLAUDE.md`、GLB書き出し・シーン定義は `scripts/CLAUDE.md`、実ブラウザ検証（`bun run test:browser` / `:soak` / `:visual`）は `e2e/CLAUDE.md`。

- 空間音響は `src/hooks/spatialAudio.ts`。既存AudioContextの2本の固定バスでストーブ（サウナ環境音・ロウリュ）と注水口（水風呂音）をHRTF定位する。風・バイノーラル音は従来の経路を維持。
- `App → SceneMode → SaunaScene` に同一 `audio` を渡す。シーン定義の座標とカメラの位置・前方・上方向を `audio.setSpatialPose()` で反映し、アンマウント時は `null` で2D音へクロスフェード。モデル再読込・新たなAudioContextや音源の作成は行わない。AudioListenerの位置パラメータ非対応時は従来音へフォールバック。

- 3Dの取得失敗・タイムアウト・コンテキスト喪失は `SaunaScene` 内で一度だけ失敗確定し、通信・描画を停止して2D音へ戻す。非同期取得／解析の完了時にも失敗・解除を判定し、遅着モデルは解放する。`SaunaScene.test.tsx` は模擬レンダラーでこの競合と解放を検証する（実GPUの検証ではない）。

- `SceneMode` の `ActiveScene` は遅延JavaScript取得も含む読み込み全体に30秒の期限を設ける。ステージ・画質・時間帯の変更で期限を延長せず、準備完了・失敗・2D切り替え時にタイマーを解除する。期限後にモジュールが届いても自動で3Dを開始しない。`scene-chunk.e2e.ts` は通常2Dで3D用JS／モデルを取得しないことと、JS取得保留中の期限切れ・遅着・手動再試行を本番ビルドで検証する。通信帯域の性能測定ではない。

- 3D用JavaScriptのimport拒否は `SceneModuleError` で通常のモデル／WebGL失敗と区別する。`React.lazy` とブラウザが失敗を保持するため、モードの再選択で復帰できるとは案内しない。2Dを継続しつつ「最初から再読み込み」を表示し、体験が初期化されることを明示する。ページ更新は利用者の押下時だけ。取得保留・タイムアウト・モデル失敗にはこの案内を出さず、従来の再試行を維持する。

- 外気浴の2D用 `.aurora-container` は、3Dの `data-load-ms` が付いた準備完了時だけ非表示にする。昼夕の3D照明を濃紺の全画面背景で覆わない。読み込み中・2D切り替え・失敗後は従来の背景へ戻す。`scene-aurora.e2e.ts` でこの境界と実コンテキスト喪失後の操作継続を検証する。

