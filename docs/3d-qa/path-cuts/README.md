# 水底のタイルの経路を外す候補の費用と画像（2026-10-02、診断・不採用）

DPR 1.5の水風呂の夕暮れ・夜（約18〜19ms）は、画像を変えない工夫では60fps（16.7ms）に届かない見込みになった
（[tilt-cost](../tilt-cost/README.md)、[wet-single-call](../wet-single-call/README.md)）。そこで画像が変わるのを
受け入れて、水底のタイルの材質（`waterBottom.ts`）の経路を外す候補の費用と見た目の変化を並べた。製品コードの変更はない。

## 候補

`e2e/frame-cost.ts` の `cut-*` をそのまま使った（`+` で複数指定できるようにした）。

| 候補 | 外すもの |
| --- | --- |
| `tilt` | 底面の反射の傾けた4本の追跡。バンプでの追い直しの判定がなくなり、底面に映る灯りは滑らかな水面の経路だけになる |
| `wetimage` | 水越しのハイライトのうち、側面で反射して届く経路（`suiWetImage`） |
| `tilt+wetimage` | 上の2つ |
| `wet` | 水越しのハイライト全体 |
| `bottom` | 底面の反射全体 |

## 費用

標準画質・DPR 1.5・1200×800・`FRAME_COST_REPEAT=2`、製品を挟む順と逆順の2報告（各10ページ読み込み、先頭は `warmup`）。
1フレームの費用はフレーム間隔の平均（`--light-costs`）。[値](cost.json)。

| 水風呂 | 製品 | `tilt` | `wetimage` | `tilt+wetimage` | `wet` | `bottom` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 昼 | 15.21 | −1.21 | −1.02 | −2.04 | −1.57 | −1.79 |
| 夕暮れ | 18.19 | −1.14 | −1.02 | −1.93 → **16.26** | −1.46 → 16.73 | −1.70 → 16.49 |
| 夜 | 18.83 | −1.08 | −1.00 | −1.89 → 16.94 | −1.44 → 17.39 | −1.71 → 17.12 |

- 2報告の差は各0.21ms以内。サウナは0.1〜0.5ms、外気浴は0.2ms以下の短縮（水底が少し見えるだけ）。
- `tilt+wetimage` は単独の和（約2.1〜2.2ms）より小さい。
- **夜は、どの候補でも16.7msを下回らない。** 夕暮れは `tilt+wetimage` と `bottom` だけが下回る。

## 画像

`CAPTURE_CUT=<候補>` で `cycles-compare.visual.ts`・`stage-compare.visual.ts` を撮影（標準画質・DPR1）。
製品は2回撮り、2回は全画素一致した（差はすべて候補による）。[値](images.json)。

| 候補 | ΔE>5の画素（平均／最大の画像） | 変わった画素のCyclesとの平均ΔE（変化が1%超の画像） |
| --- | ---: | ---: |
| `tilt` | 0.10%／0.62% | 9.21→9.47（10枚中8枚で悪化） |
| `wetimage` | 0.30%／2.7% | 8.45→8.71（10枚中8枚で悪化） |
| `tilt+wetimage` | 0.33%／2.9% | 9.08→9.30（10枚中8枚で悪化） |
| `wet` | 0.57%／4.7% | 7.76→8.07（15枚中10枚で悪化） |
| `bottom` | 5.7%／19.5% | 7.50→8.73（15枚中11枚で悪化） |

目視（水風呂ステージの夜・見出し2と夕暮れ・見下ろし。比較画像はローカルのみ）：

- `tilt`：水底に映る灯りの円盤の縁から波の揺らぎが消え、滑らかな輪郭になる。Cyclesの円盤の縁には揺らぎがある
  （製品の揺らぎはCyclesより強い）。動きのある水らしさの主な手がかりの一つが消える。
- `wetimage`：円盤の手前に伸びる淡い光沢の帯が消える。この帯はCyclesにもある
  （[water-gloss-capture](../water-gloss-capture/) で、夕暮れの見下ろしの光沢の手前半分はこの経路だけで出ると確認済み）。
- `bottom`：底面に映る灯りの円盤そのものが消える。

## 判断

**不採用。** 夜のDPR 1.5を60fpsに入れられる候補はなく、届く夕暮れでも、Cyclesに合っている特徴
（円盤の縁の揺らぎ、手前の光沢の帯）を失う。どの候補も、変わった画素ではCyclesとの誤差が増える。

## 再実行

```sh
bun run build
FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 \
  FRAME_COST_VARIANTS=warmup,product,cut-tilt,cut-wetimage,product,cut-wet,cut-bottom,product,cut-tilt+wetimage,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > cost-1.json
# 逆順で cost-2.json
python3 scripts/summarize_frame_cost.py --out cost.json --light-costs cost-1.json cost-2.json
CAPTURE_CUT=cut-tilt bunx playwright test --config playwright.visual.config.ts \
  e2e/cycles-compare.visual.ts e2e/stage-compare.visual.ts --reporter=json > img-cut-tilt.json
```

環境変数はbashのスクリプトから渡す。画像の集計は一時スクリプトで行い、保存していない（方法は `images.json` の `method`）。
Chrome 154.0.8037.58／macOS／headless／M1 Max。他の端末・高画質・DPR 2は測っていない。
