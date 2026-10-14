# 近景の小花・せせらぎ（2026-10-14）

基準は `2c428b8`。前回の曲がる草・薄い低木葉・大小の岸石に続き、小花と流れを調整した。

- `gardenBloom.ts`：5枚の反った花びらと中心、25三角形。花の位置・季節色・冬の非表示は継続。細い茎は既存の低木メッシュへ結合する。
- `gardenStream.ts`：幅を緩く変えた地形沿いの1メッシュ（912三角形）。小石の水底、濡れた岸、下流へ動く波の色と法線を手続き的に描く。細部は画素微分で減衰。川石も同じ幅に沿わせる。
- 地形を掘らず、不透明な表面で浅い水を近似。屈折・平面反射・音源は追加しない。追加テクスチャ・描画ターゲット・動的光源なし。既存の材質準備・照度プローブ・解放処理と動作抑制を使う。

## 画像

Chrome 155、1280×800、標準画質。上が前、下が後。画像はローカルのみでGit管理外。

- [夏の水辺拡大](totonou-summer-detail.jpg) / [全景](totonou-summer.jpg)
- [春](totonou-spring-detail.jpg) / [夕暮れ](totonou-evening-detail.jpg) / [冬](totonou-winter.jpg)
- [時刻固定の流水・動作抑制](flow-held.jpg)
- [秋・夜・雨・水風呂・サウナ](other-views.jpg)（左が前、右が後）

夏・春・夕暮れでは白く平坦な帯が弱まり、細かな水面と岸の境が見える。冬は花が消え、岸石の雪を維持。通常の庭テストの前後撮影は別実行なので、露出やUIの画素単位の一致を評価する画像ではない。

`garden-stream.visual.ts` は通常／動作抑制でそれぞれ時刻差0/500/1000msを固定し、各70フレーム整定して6枚を取得。水辺ROIの通常画像差は0.341／0.579（RGB 0〜255の絶対差平均）、動作抑制では両方0。ROIは岸と草も含む。[flow.json](flow.json) に座標を記録。流水単体の速度や実時間の連続ちらつきの測定ではない。

## 検証

型検査、382単体テスト（60ファイル）、Lint、整形、本番ビルド、差分チェック成功。庭・季節・ライフサイクルのブラウザ14件成功（4.3分）。時刻固定と見回しの画像取得2件成功（89.7秒）。シェーダーコンパイルを含むブラウザエラーなし。低・標準・高画質の季節切替と遅延庭ロード、失敗時の復帰を対象に含む。[validation.json](validation.json) にソースと画像ハッシュを保存。

```sh
bunx tsc -b
bun run test
bun run lint
bun run format:check
bun run build
git diff --check
bun run test:browser e2e/garden-details.e2e.ts e2e/season.e2e.ts e2e/scene-lifecycle.e2e.ts
SHIMMER_RATIOS=1.5 bun run test:browser:visual e2e/resolution-shimmer.visual.ts e2e/garden-stream.visual.ts --reporter=json
FRAME_COST_VARIANTS=warmup,product,product FRAME_COST_REPEAT=3 bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts --grep 'frame cost' --reporter=json
```

標準・DPR1.5・3ステージ×昼夕の制御見回し78枚。L*残差の変更後÷前の中央値は画素0.990、面0.989、面p99 0.986倍。面は系列ごと0.986〜1.002倍。[集計](shimmer/shimmer.json)。基準は前回QAの変更後画像を再利用し、当時の製品ソースと今回HEADのハッシュ一致を確認。各1回で再撮影差は未測定。測定中にChromeのパッチ版更新（155.0.8059.40→.79）を検出したため、この過去画像との比較はブラウザー差も除外できず、実時間のちらつき改善とはしない。

通常ブラウザ回帰全件・全周・高画質の見回し・実Safari・実機は今回未実施。描画費用は [cost.json](cost.json) に記録。

描画費用はChrome 155.0.8059.79で変更後→変更前の独立ビルドを測定し、各3件成功（各約4.5分）。晴れ・夏の9視点、標準・DPR1、warmupを除く2回の平均フレーム間隔÷3の変更後÷前は0.966〜1.013倍。描画回数は9視点すべて同じ。大幅な増加は見られないが、交互測定ではなく数％はばらつきを含む。GPU単体時間・実機FPS・省メモリーの証明ではない。最初に比較を試みた旧Chrome .40の負荷記録は最終比較から除外した。
