# CLAUDE.md

## コマンド

```bash
bun run dev      # 開発サーバー起動
bun run build    # プロダクションビルド
bun run preview  # ビルド結果をローカルで確認
bun run lint     # ESLint 実行
```

テストスイートは存在しない。

## アーキテクチャ

React 19 + Vite + TypeScript のシングルページアプリ。GitHub Pages にデプロイ（`base: '/sauna-simulator/'`）。

### ステージ遷移フロー

`App.tsx` がアプリ全体の状態を管理する。ステージは `start → sauna → water → totonou` の順に進み、`totonou` から `sauna` に戻るループ構造になっている。

```
start → sauna（SaunaRoom） → water（CoolingBath） → totonou（TotonouSpace） → sauna ...
```

- ステージ遷移は `changeStage()` で行い、1秒のクロスフェード（`opacity` アニメーション）を伴う
- 背景画像は `App.tsx` 内で3枚のレイヤーとして常時レンダリングされており、`opacity` の切り替えでクロスフェードを実現（`public/sauna_bg.png`, `water_bg.png`, `totonou_bg.png`）

### オーディオ

`src/hooks/useAudioEngine.ts` にカプセル化されており、**外部音声ファイルは一切使用しない**。すべて Web Audio API でプロシージャル生成している。

| 環境 | 音 |
|------|-----|
| `sauna` | ブラウンノイズ + lowpass フィルター |
| `water` | ブラウンノイズ + bandpass フィルター |
| `totonou` | 110Hz + 112Hz の正弦波によるバイノーラルビート |
| ロウリュ | ホワイトノイズ + highpass フィルター（1.5秒で減衰） |

`audio.init()` はユーザーインタラクション（スタートボタン）のタイミングで呼ぶ必要がある（ブラウザの autoplay 制限対応）。

## 規約・パターン

### スタイリング
- グローバルスタイルは `src/index.css` に CSS カスタムプロパティ（`--accent`, `--glass-bg` 等）で定義
- 共通 UI は `.glass-panel`（glassmorphism）と `.primary-btn` の2クラスを使う
- ステージ固有の色や背景はコンポーネント内のインラインスタイルで上書きする
- アニメーション（`steam-rise`, `ripple`, `breathe`）は `index.css` の `@keyframes` で定義済み

### コンポーネント設計
- 各ステージコンポーネント（`SaunaRoom`, `CoolingBath`, `TotonouSpace`）は `onNext` コールバックを受け取り、次ステージへの遷移をトリガーする
- `audio` オブジェクト（`useAudioEngine` の戻り値）は `App.tsx` で生成し、必要なコンポーネントに props で渡す

### ESLint
- `no-unused-vars` は大文字・アンダースコア始まりの変数（`^[A-Z_]`）を無視する設定になっている
