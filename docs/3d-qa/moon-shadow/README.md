# 夜の月の影を4＋6標本に軽くするかの診断（2026-09-29）

夜は夕暮れより10〜16%重い（[夜のGPU時間](../night/README.md#gpu時間)）。夕暮れの日光と同じく、月（色×強度の最大成分0.1）の影だけを4＋6標本にしたときの画質と費用を測った。**製品コード・配信物は変更していない。**

## 条件

- Chrome 154.0.8037.58、macOS headless、動作抑制、夜。
- 画質：`sun-shadow.gpu.ts` に `SUN_SHADOW_LIGHTING=night` を加え、製品（月16＋24）／候補 `lite`（平行光の呼び出しを常に `suiGetShadowSunLite` ＝4＋6）／製品再撮影を、高画質・標準画質の各108視点（既定3＋Cycles6＋全周72＋1px見回し27）で比べた。1200×800、DPR1。Cycles参照は夜の `blender/renders/web-night/`（v15、カメラ01〜05・07）。
- 費用：`shadow-cost.gpu.ts` に `SHADOW_COST_LIGHTINGS=night` を加え、製品と `sun-quarter`（平行光だけ4＋6）を順・逆で3回（計6組）、高画質・1280×800・DPR1で測った。
- 集計の `summary.json` は候補を `before` の欄に入れ、`candidate: "lite"` で区別する（夕暮れの集計と同じ形式）。

## 画質

| | 高画質 | 標準画質 |
| --- | ---: | ---: |
| 実行時間 | 390.2秒 | 367.2秒 |
| 最大の平均ΔE76（`totonou-survey-5-0`、白い壁） | **0.211** | **0.299** |
| その視点のΔE>0.5の画素 | 25.5% | 35.9% |
| 全108視点のΔE>2の画素の最大 | 0.203% | 0.157% |
| 製品再撮影が差0の視点 | 82/108 | 102/108 |
| 見回し時の誤差のフレーム間変化（平均の最大） | 0.059 | 0.074 |
| Cycles6視点の平均ΔE76の変化（候補−製品） | −0.0053〜+0.0003 | −0.0061〜+0.0007 |

- 外気浴の白い壁（方位4〜6）で差が大きい。等倍で並べると、4＋6では壁一面に細かな粒が見え、製品の16＋24は滑らか（ローカル画像 `wall-1x.png`、`high/high-wall-crop.jpg`）。夕暮れの日光4＋6（同じ壁で平均ΔE76 0.18・ΔE>2の画素0%、2倍拡大でも区別できない）と違い、夜は目で分かる。
- 月は夕暮れの日光（0.045）の約2倍の強さで、露出も0.9段（夕暮れ0.55段）と高い。月の影の寄与が相対的に大きく、標本の粒が表に出たと見られる（寄与の分解はしていない）。
- Cycles6視点との誤差はほぼ変わらない。これは粒が平均の明るさを変えないためで、画質が保たれた根拠にはしない。
- 製品再撮影の差は孤立した画素（平均ΔE76の最大 高画質0.00004・標準0.00014）で、候補との差より2桁以上小さい。

## 費用

組（同じ回・同じ順）ごとの変化の中央値。全18組で候補が軽い。描画数は同じ。全値は [cost.json](cost.json)。

| ステージ | 製品（中央値） | 4＋6（中央値） | 組ごとの変化の中央値 | 全6組 |
| --- | ---: | ---: | ---: | --- |
| サウナ | 58.7ms | 53.0ms | **−9.5%** | −16.8〜−8.5% |
| 水風呂 | 50.0ms | 45.5ms | **−8.7%** | −12.0〜−4.9% |
| 外気浴 | 33.6ms | 30.5ms | **−9.1%** | −11.2〜−4.2% |

## 判断

**不採用。月の影は16＋24標本のまま。** 約9%軽くなるが、等倍で粒が見える。夕暮れで「見た目の差がない」ことを条件に日光4＋6を採用し、粒が加わった暖色灯の半減（−28〜−33%）を採らなかった基準に合わせた。9%では夜の60fps目標にも届かない（この計測で製品33.6〜58.7ms、候補でも30.5〜53.0ms）。

次の候補を試すなら、中間の8＋12（夕暮れの `sun-half` と同じ）か、月の半影が狭いことを使った標本の削減（探索範囲が最小幅のときだけ少数標本など）。いずれも白い壁の等倍比較で粒が見えないことを条件にする。

## 再実行

```sh
SUN_SHADOW_LIGHTING=night SUN_SHADOW_PRODUCT=1 bun run test:browser:gpu e2e/sun-shadow.gpu.ts --output=test-results/moon-high --reporter=json > /tmp/moon-high.json
python3 scripts/summarize_sun_product.py /tmp/moon-high.json docs/3d-qa/moon-shadow/high
SUN_SHADOW_LIGHTING=night SUN_SHADOW_PRODUCT=1 SUN_SHADOW_QUALITY=standard bun run test:browser:gpu e2e/sun-shadow.gpu.ts --output=test-results/moon-standard --reporter=json > /tmp/moon-standard.json
python3 scripts/summarize_sun_product.py /tmp/moon-standard.json docs/3d-qa/moon-shadow/standard
SHADOW_COST_LIGHTINGS=night SHADOW_COST_VARIANTS=original,sun-quarter bun run test:browser:gpu e2e/shadow-cost.gpu.ts --output=test-results/moon-cost-1 --reporter=json > /tmp/moon-cost-1.json
```

費用は3回繰り返した（`--output` を回ごとに変える）。
