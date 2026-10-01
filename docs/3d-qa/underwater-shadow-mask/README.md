# 水中の材質の影マスクと水面下のコピーの1回参照（2026-10-01、採用）

[影の半解像度マスク](../shadow-mask/README.md)の残件「水越しの面（`SUI_REFRACTION`）をマスクに入れる」。あわせて、切り分けで分かった水面下のコピー（側面の像・側面の奥の壁）のPCSSを1回参照にした。**水風呂の昼は35.5→12.8ms（0.36倍）でこの機械の60fps（16.7ms）を下回り、夕暮れ・夜は約44〜47ms→32〜35ms（0.73倍）。** 画像の変化は浴槽の外側の半影の粒の並びだけ（Cycles視点の平均ΔE 0.09）。

## 変更

`src/components/3d/shadowMask.ts`・`refraction.ts`（詳細は [3DのCLAUDE.md](../../../src/components/3d/CLAUDE.md)）。

1. **水中の材質のマスク**：`SUI_REFRACTION` の材質も深度プリパスと同じ82メッシュすべてをマスクに入れた（78→82）。マスク材質に同じ `SUI_REFRACTION`（あれば `SUI_WATER_BOTTOM`）を定義すると、`project_vertex` が頂点を屈折像へ動かし、`shadowmap_vertex` が底面のスポット光の影座標を屈折経路の出口へ移す。影・ビュー深度は真の位置のままなので、本描画との深度の照合はそのまま使える。本描画が捨て得る領域（水の箱の中・水面下・元の水の体積の外）では書かない。この判定は深度プリパスと共有する `mayDiscardGlsl` に切り出した。
2. **水面下のコピーの1回参照**：側面の像（8方向×4メッシュ）と側面の奥の壁（ブレンドするコピー）に `SUI_HARD_SHADOW` を定義し、マスクなしでPCSSを影マップの1回参照に置き換える。どちらも全体が水面下にあり、日光・スポット光の直接光は `lighting.ts` の `DRY_ONLY` で使われない。影が効くのは底面のV9・寝椅子灯の光沢だけ。

### 途中で分かったこと

- 1だけの版（下表の「マスクのみ」）では水風呂の昼は0.45倍になったが、夕暮れ・夜は0.89〜0.91倍にとどまった。`noshadow-all` では夕暮れでなお約24ms減り、影がまだ大半だった。
- 切り分けのため `frame-cost.ts` に、定義を持つ／持たないプログラムだけ全灯の影を外す `noshadow-with-<定義>`／`noshadow-without-<定義>` を加えた。マスクを読まないプログラムの影が水風呂の夕暮れで約25ms、うち側面の像が約6ms、半透明（`OPAQUE` なし、側面の奥の壁を含む）が9〜22ms、葉（`USE_ALPHATEST`）が約5ms（値は揺れが大きく、足し算にもならない）。
- 側面の像の `receiveShadow` を実行時に切る試しでは約3msしか減らなかった。PCSSのコードがシェーダに残るためで、[前回](../shadow-mask/README.md)の「実行されないPCSSが残るだけで遅い」と同じ。定義でコンパイル時に置き換える2にした。

## 結果

条件：Chrome／ANGLE Metal（Apple M1 Max）、headless、`e2e/frame-cost.gpu.ts`（`warmup,product`）、1200×800・DPR1・動作抑制、標準画質。HEADのworktreeと順序を交互にした各6組。値は [cost.json](cost.json) `comparisons`（`standard` が最終版、`mask-only` が1だけの版）。

| 標準画質（6組の中央値の範囲、ms） | 変更前 | 変更後 | 比 | マスクのみの比 |
| --- | ---: | ---: | ---: | ---: |
| 水風呂 昼 | 35.1〜36.3 | **12.6〜13.1** | 0.36 | 0.45 |
| 水風呂 夕暮れ | 43.2〜44.9 | 31.5〜33.3 | 0.73 | 0.89 |
| 水風呂 夜 | 46.8〜49.5 | 33.2〜36.7 | 0.73 | 0.91 |
| サウナ 夕暮れ | 14.6〜15.0 | 13.1〜13.8 | 0.91 | 0.96 |
| 外気浴 夕暮れ | 12.8〜13.9 | 12.1〜13.4 | 0.95 | 1.01 |

- サウナ・外気浴のその他は0.96〜0.99。HEADのサウナ夜は今回23〜35msの二峰性が出た（前回の記録の途中の版でも見られた現象、原因は未確認）。変更後は13.4〜15.2msで、比0.46はこの二峰性を含む。
- 最終版の切り分け（[cost.json](cost.json) `lightCosts`、1報告）：水風呂の夜でマスクを読まないプログラムの影がなお約20msあり、ほぼすべて葉（`USE_ALPHATEST`）。サウナ・外気浴では葉の影は約1ms。水風呂の視点に大きく写る庭の葉は深度プリパス・マスクの対象外で、重なった葉ごとにPCSSを評価している。1だけの版の切り分けは [split-mask-only.json](split-mask-only.json)。
- 水風呂の夕暮れの製品が組の中で16msと32msに分かれた報告が1つあった（`lightCosts`）。6組の比較では出ていない。

### 画像

`scene-survey`（216枚）・`cycles-compare`（18枚）・`stage-compare`（12枚）を各版2回撮った。Cycles視点と水風呂ステージは各版の2回が全画素一致し、変更前後の差（[cost.json](cost.json) `imageDelta`、CIELAB ΔE76）は変更によるもの。

| | 平均ΔE | ΔE>2 | ΔE>5 | 中央部のΔE>5 |
| --- | ---: | ---: | ---: | ---: |
| Cycles視点（18枚） | 0.09 | 0.86% | 0.05% | 0.10% |
| 全周（216枚） | 0.47 | 7.3% | 2.9% | 0.02% |
| 水風呂ステージ（12枚） | 0.06 | 0.51% | 0.02% | 0.02% |

- 差は浴槽の外側のコンクリート（水中の三角形を持つ材質の水面より上の部分）の半影の粒の並び。前回のマスク導入と同じ種類の変化で、等倍でも見分けにくい。全周の水風呂は既知の `.cooling-glow` の脈動による縁の差（変更前の2回の間でも平均ΔE 0.27）で、中央部は0.02%。
- 元Cyclesとの誤差は測り直していない（変更前後の差が平均ΔE 0.09で、前回の±0.01の判定に影響しない大きさ）。

## 残件

- 水風呂の夕暮れ・夜（約32〜35ms）の残りは主に葉のPCSS。アルファテストを入れた深度プリパス・マスクか、葉の影を安くする案。
- DPR 1.5・他の端末（Windows・モバイル）での効果、見回し中の粒の見え方は未確認（前回から継続）。

## 検証

型検査、39ファイル232単体テスト（`shadowMask.test.ts`・`refraction.test.ts` を更新）、Lint、整形、本番ビルド、ブラウザ回帰15件、撮影（各版2回）、GPU時間（標準6組×2版）と切り分け。3Dチャンクは755.35→756.26KB（既存の容量警告は継続）。継続利用・高画質のGPU時間・モバイル実機・他のGPU・実聴は未検証。

## 再実行

```sh
bun run build   # 変更前はHEADのworktree（node_modulesをリンク）で同じテストを交互に
FRAME_COST_VARIANTS=warmup,product bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > after-1.json
FRAME_COST_VARIANTS=warmup,product,noshadow-without-SUI_SHADOW_MASK,noshadow-with-SUI_HARD_SHADOW,noshadow-with-USE_ALPHATEST,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > split.json
bunx playwright test --config playwright.visual.config.ts e2e/scene-survey.visual.ts e2e/cycles-compare.visual.ts e2e/stage-compare.visual.ts
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/underwater-shadow-mask/cost.json \
  --runs standard before=before-1.json,... after=after-1.json,... --light-costs split.json \
  --image-delta <変更前の撮影> <変更後の撮影> --image-runs before=<撮影1>,<撮影2> after=<撮影1>,<撮影2>
```
