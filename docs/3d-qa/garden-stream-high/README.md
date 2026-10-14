# 小花・せせらぎの高画質確認（2026-10-14）

前回の [小花・せせらぎ](../garden-stream/README.md) に残っていた高画質の確認。製品描画は `7ffbf8b` のまま、診断コードと記録を更新した。基準は追加前の `2c428b8` の独立ビルド。

## 方法

- Chromeの同一パッチ版、高画質、画面DPR2。変更後→変更前の順に各1回。
- 水辺：1280×800 CSS px、実画像2560×1600、昼・外気浴。通常／動作抑制で時刻差0/500/1000msに固定し各70フレーム整定、6枚ずつ。
- 見回し：1200×800 CSS px、実画像2400×1600。3ステージ×昼夕×内部解像度倍率2/1.5、1 CSS px（ヨー0.004rad）の操作ごとに2フレーム進めた13枚、計156枚ずつ。水辺を合わせ各版162枚。
- `garden-stream.visual.ts` に `STREAM_QUALITY=high` を追加。URLで入室前から画質を指定し、実際の画質・ピクセル比を照合する。水辺・見回しの添付にブラウザー版を保存し、見回しもconsole errorを検査する。
- 初回は診断用画質メニューを開くURLが欠けていたため中断。画質をURLで直接指定する形に直し、最終成功報告だけを集計した。

```sh
STREAM_QUALITY=high SHIMMER_QUALITY=high SHIMMER_RATIOS=2,1.5 bun run test:browser:visual e2e/resolution-shimmer.visual.ts e2e/garden-stream.visual.ts --reporter=json > test-results/stream-high/after.json
# 画像フォルダを after-captures に保存。基準版の独立チェックアウトへ同じ診断2ファイルをコピーし、同じコマンドで before.json / before-captures を取得する。
python3 scripts/summarize_resolution_shimmer.py test-results/stream-high/after.json test-results/stream-high/after-captures/resolution-shimmer.visual.-9d6ef--steps-while-looking-around docs/3d-qa/garden-stream-high/after
python3 scripts/summarize_resolution_shimmer.py test-results/stream-high/before.json test-results/stream-high/before-captures/resolution-shimmer.visual.-9d6ef--steps-while-looking-around docs/3d-qa/garden-stream-high/before
```

## 画像と判定範囲

[高画質の水辺前後](stream-before-after.jpg)（上が前、下が後）と [3ステージの昼夕](stages.jpg)。画像はローカルのみ。小花の花びら・茎と細かな水面が見え、確認した画像に目立つ欠落・黒抜けはない。

制御見回しのL*残差は、既知の回転で画像を重ねた後に残る差であり、画面全体の指標。水辺の変化だけを切り分けた値ではない。各版1回のため再撮影差を測っておらず、実時間のちらつき改善や実機の滑らかさを意味しない。

今回は製品コードを変更していない。通常ブラウザ回帰全件・全周撮影・実Safari・実機・高画質の描画負荷は未実施。

## 成功した検証

Chrome 155.0.8059.79で変更前後とも2件成功（前201.8秒、後202.4秒）。ページ／コンソールエラーなし。入力ソース・全324枚のPNGハッシュ、条件、成功件数は [validation.json](validation.json)。型検査・382単体テスト（60ファイル）・Lint・整形・本番ビルド成功。

水辺の比較範囲は実画像の矩形 `(1460,1070)-(1640,1210)`。通常時の0msからのRGB絶対差平均（0〜255）は変更後0.778／1.284、変更前0.469／0.728。動作抑制は前後とも500／1000msで0。通常の値は草・岸も含み、波の量・速度の比較値としては使わない。

診断の既定（標準画質・DPR1）の水辺テストも1件成功。高画質対応による診断の既定動作の回帰を確認した。

## 見回しの集計

[変更前](before/shimmer.json) / [変更後](after/shimmer.json) / [比の集計](comparison.json)。各値は6系列（3ステージ×昼夕）の変更後÷前。16×16 capture px（8 CSS px）の面で集計する。

| 内部解像度倍率 | 画素残差の中央値 | 面残差の中央値 | 面残差の最小〜最大 | 面p99の中央値 |
| --- | ---: | ---: | ---: | ---: |
| 2 | 1.002 | 1.002 | 0.998〜1.011 | 1.000 |
| 1.5 | 0.999 | 0.999 | 0.989〜1.006 | 0.999 |

今回の画像残差はほぼ同程度。数％以下の差を改善・悪化とは断定しない。画素残差と面残差はそれぞれ別の尺度で、FPSや主観的なちらつき評価ではない。
