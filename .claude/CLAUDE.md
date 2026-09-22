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
- 水は元GLBの閉じた水形状を非表示にし、`waterEffects.ts` の境界付き水面・波紋・注水に置き換える。動きを減らす設定では波紋・注水の時間更新を止める。空間音響・昼夕照明・最適化は未実装。
