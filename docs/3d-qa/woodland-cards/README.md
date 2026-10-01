# 林のカードの深度プリパスと影マスク（2026-10-01、採用）

> **訂正（2026-10-01）**：下のGPU時間はANGLE Metalのタイマー値で、表示間隔をまたぐ視点では誇張されている。繰り返し描画のフレーム間隔で測り直すと、水風呂の夜は16.0〜16.4→13.5〜13.8ms（0.83倍）、夕暮れは0.86倍、外気浴の夕暮れ・夜は0.72〜0.74倍だった（[測り直し](../frame-interval/README.md)）。標準画質・DPR 1で全視点が60fpsに収まる結論は変わらない。

[水中の材質の影マスク](../underwater-shadow-mask/README.md)の残件「水風呂の夕暮れ・夜の残り約20msは庭の葉（アルファテスト）のPCSS」。アルファテストの材質は林のカード（`leafCluster.ts`、遠景の林の冠を20枚の葉の型で切り抜いた板、`sauna-garden.glb` の5材質）だけで、深度プリパスと影マスクの対象外だった。両方の対象に加えた。**水風呂の夜は32.6〜33.4→14.1〜14.2ms（0.43倍）、夕暮れは13.5〜13.8msで、標準画質の全ステージ×昼夕夜がこの機械の60fps（16.7ms）を下回った。** 画像の変化は林の冠の中の半影の粒の並びだけ（Cycles視点の平均ΔE 0.05）。

## 変更

`src/components/3d/depthPrepass.ts`・`shadowMask.ts`（詳細は [3DのCLAUDE.md](../../../src/components/3d/CLAUDE.md)）。プリパス・マスクのメッシュは82→87。

1. **対象の判定**：`cutoutOf` がアルファマップ＋アルファテストだけで切り抜く `MeshStandardMaterial` のアルファマップを返す。`map`（そのアルファ）・頂点色・alphaHash・屈折（`SUI_REFRACTION`）を持つ材質は複製で再現しないので対象外。`takesPrepassDepth` はこれをアルファテストの例外として通す。
2. **深度プリパス**：材質ごとに、同じアルファマップ・閾値で深度だけを書く材質を作る。カードは4倍MSAAでalpha-to-coverageを使い、照明パスの `alphatest_fragment` は `smoothstep( alphaTest, alphaTest + fwidth( a ), a )` を被覆率にする。プリパスは被覆率が1になる画素（`a ≥ alphaTest + fwidth( a )`）だけ深度を書く。縁で深度を書くと、照明パスが一部のサンプルしか覆わないとき、奥の面のそのサンプルが深度で欠けるため。プリパス自体にalpha-to-coverageを付けて揃える案は、2つのプログラムの被覆の一致に頼るためとらなかった。
3. **影マスク**：マスク材質に `SUI_CUTOUT` を定義し、同じアルファマップ（テクスチャ自身の行列）で照明パスが葉を残す画素（`a ≥ alphaTest`）だけ書く。照明パスはほかの材質と同じく `SUI_SHADOW_MASK` で近傍4テクセルを読み、深度・法線の合わない縁は影マップを1回引く。

## 結果

条件：Chrome／ANGLE Metal（Apple M1 Max）、headless、`e2e/frame-cost.gpu.ts`（`warmup,product`）、1200×800・DPR1・動作抑制、標準画質。HEADのworktreeと順序を交互にした6組。値は [cost.json](cost.json) `comparisons.standard`。

| 標準画質（6組の範囲、ms） | 変更前 | 変更後 | 比（中央値） |
| --- | ---: | ---: | ---: |
| 水風呂 昼 | 12.8〜13.9 | 12.5〜14.0 | 0.99 |
| 水風呂 夕暮れ | 15.6〜16.2／30.3〜30.7 | **13.5〜13.8** | 0.65 |
| 水風呂 夜 | 32.6〜33.4 | **14.1〜14.2** | 0.43 |
| サウナ 昼・夕暮れ・夜 | 13.3〜14.5 | 12.5〜14.6 | 0.97〜1.01 |
| 外気浴 昼 | 11.6〜13.4 | 10.0〜11.3 | 0.88 |
| 外気浴 夕暮れ | 13.0〜14.2 | 12.1〜12.6 | 0.90 |
| 外気浴 夜 | 13.1〜14.1 | 12.5〜14.1 | 0.99 |

- 変更前の水風呂の夕暮れは6組のうち3組が約16ms、3組が約30msの二峰性だった（[前回](../underwater-shadow-mask/README.md)の切り分けでも1報告で16msと32msに分かれていた）。原因は確認していない。変更後は6組とも13.5〜13.8msで分かれなかった。
- 描画数・三角形数は同じ（深度プリパス・マスクの描画は計測値に含まない）。
- 切り分け（`noshadow-with-USE_ALPHATEST` など）は今回測っていない。変更後の残りの内訳は未確認。

### 画像

`scene-survey`（216枚）・`cycles-compare`（18枚）・`stage-compare`（12枚）を各版2回撮った（変更前・変更後・変更後・変更前の順）。Cycles視点と水風呂ステージは各版の2回の差が平均ΔE 0.001以下（変更後は全画素一致）で、変更前後の差（[cost.json](cost.json) `imageDelta`、CIELAB ΔE76）は変更によるもの。

| | 平均ΔE | ΔE>2 | ΔE>5 | 中央部のΔE>5 |
| --- | ---: | ---: | ---: | ---: |
| Cycles視点（18枚） | 0.05 | 0.67% | 0.04% | 0.04% |
| 全周（216枚） | 0.23 | 4.3% | 0.48% | 0.02% |
| 水風呂ステージ（12枚） | 0.01 | 0.19% | 0.01% | 0.02% |

- 最大のCycles視点01の昼（平均ΔE 0.24）は、林の冠の中の細かな粒の並びの差だけで、縁の欠け・穴・奥の面の抜けはなかった（等倍で目視）。マスクの補間と縁の1回参照による、これまでのマスク導入と同じ種類の変化。
- 全周の差の上位は水風呂の視点で、既知の `.cooling-glow` の脈動による縁の差（変更後の2回の間でも平均ΔE 0.42）。中央部は0.02%。
- 元Cyclesとの誤差は測り直していない（変更前後の差がCycles視点で平均ΔE 0.05）。

## 残件

- DPR 1.5・高画質のGPU時間、他の端末（Windows・モバイル）での効果、見回し中の粒の見え方は未確認（前回から継続）。
- 継続利用（soak）は再実行していない。

## 検証

型検査、39ファイル234単体テスト（`depthPrepass.test.ts`・`shadowMask.test.ts` に各1件追加）、Lint、整形、本番ビルド、ブラウザ回帰15件、撮影（各版2回）、GPU時間（標準6組）。3Dチャンクは756.26→757.68KB（既存の容量警告は継続）。継続利用・高画質のGPU時間・モバイル実機・他のGPU・実聴は未検証。

## 再実行

```sh
bun run build   # 変更前はHEADのworktree（node_modulesをリンク）で同じテストを交互に
FRAME_COST_VARIANTS=warmup,product bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > after-1.json
bunx playwright test --config playwright.visual.config.ts e2e/scene-survey.visual.ts e2e/cycles-compare.visual.ts e2e/stage-compare.visual.ts
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/woodland-cards/cost.json \
  --runs standard before=before-1.json,... after=after-1.json,... \
  --image-runs before=<撮影1>,<撮影2> after=<撮影1>,<撮影2> --image-delta <変更前の撮影> <変更後の撮影>
```
