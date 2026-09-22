# CLAUDE.md

## コマンド

- パッケージマネージャは **bun**（`package-lock.json` が残っているが使わない）
- `vitest.bench.config.ts` は現状どこからも使われていない。`src/hooks/useAudioEngine.bench.test.ts` は名前に反して `describe`/`it` による通常のテストで、`bun run test` の対象に含まれる（`vitest bench` の対象ではない）

## アーキテクチャ

### ステージ遷移フロー

ステージは `start → sauna → water → totonou` の順に進み、`totonou` から `sauna` に戻るループ構造になっている。

- セッション状態は `src/hooks/useSaunaSession.ts` が保持し、`SaunaProvider` / `useSaunaContext`（`src/context/SaunaContext.tsx`）経由で配布する。`App.tsx` は context から読むだけで、状態は持たない（背景レイヤー用の `activeLayers` を除く）
- ステージ遷移は `changeStage()` で行い、1秒のクロスフェード（`opacity` アニメーション）を伴う
- 背景画像は `App.tsx` 内で3枚のレイヤーとして常時レンダリングされており、`opacity` の切り替えでクロスフェードを実現（`public/sauna_bg.png`, `water_bg.png`, `totonou_bg.png`）

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
