# 🧖 Browser Sauna Simulator

ブラウザで楽しむ疑似サウナ体験アプリです。

サウナ → 水風呂 → 外気浴（ととのう）の3ステージを順番に体験できます。各ステージにはアンビエントサウンドとアニメーションが付いており、本物のサウナに近い雰囲気を演出します。

## 機能

- **サウナ室** — 室温をリアルタイム表示。ロウリュボタンで蒸気を発生させ温度を上昇させます
- **水風呂** — 波紋アニメーションで冷却感を演出
- **外気浴（ととのう）** — 呼吸ガイド付きのリラックスステージ
- 各ステージのアンビエントサウンド（Web Audio API）
- ステージ間のクロスフェード演出

## 技術スタック

- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/)

## 開発

```bash
# パッケージのインストール
npm install

# 開発サーバーの起動
npm run dev
```

## ビルド・検証

TypeScriptによる型チェックを行ってからビルドします。

```bash
# 型チェックのみ実行する場合
npx tsc --noEmit

# 本番ビルドを実行する場合
npm run build

# ビルドしたアプリのプレビュー
npm run preview
```
