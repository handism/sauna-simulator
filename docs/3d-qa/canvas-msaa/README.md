# canvasのMSAAをやめた分のGPU時間（2026-10-04、確認）

[GPUメモリ](../gpu-memory/README.md)の残件「canvasのMSAAをやめた分のGPU時間（未計測）」。HDR出力ではcanvasに全画面三角形を1枚出すだけなので、canvasを `antialias: false, depth: false` にした変更（`98cec57`）は4倍MSAAの解決と深度のクリアを省く。製品コードの変更はない。

条件：Chrome 154（Playwright・headless）／ANGLE Metal（Apple M1 Max）、`e2e/frame-cost.gpu.ts`、1200×800・動作抑制・`?resolution=fixed`、標準画質、3ステージ既定視点×昼夕夜。1フレームの費用は繰り返し描画のフレーム間隔（`intervalMs.mean`、DPR 1は3回・DPR 1.5は2回）。変更前は `a3d7ad5` のworktreeで、変更後と順を入れ替えながら交互に4組（各回 `warmup,product`）。

## 結果

1フレームの費用（ms、4回の範囲）と変更後÷変更前の中央値。

| | DPR 1 変更前 | 変更後 | 比 | DPR 1.5 変更前 | 変更後 | 比 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| サウナ 昼 | 7.63〜7.67 | 7.58〜7.62 | 0.992 | 11.88〜11.93 | 11.72〜11.78 | 0.987 |
| サウナ 夕暮れ | 10.50〜10.54 | 10.45〜10.50 | 0.996 | 15.02〜15.09 | 14.91〜14.97 | 0.992 |
| サウナ 夜 | 11.25〜11.30 | 11.25〜11.30 | 1.000 | 15.87〜15.93 | 15.74〜15.81 | 0.992 |
| 水風呂 昼 | 8.97〜9.07 | 8.91〜8.95 | 0.991 | 14.58〜14.64 | 14.42〜14.48 | 0.989 |
| 水風呂 夕暮れ | 10.84〜10.93 | 10.79〜10.84 | 0.995 | 17.71〜17.78 | 17.55 | 0.989 |
| 水風呂 夜 | 11.45〜11.55 | 11.40〜11.45 | 0.994 | 18.29〜18.36 | 18.19〜18.20 | 0.991 |
| 外気浴 昼 | 5.56 | 5.56 | （60fpsに張り付き） | 8.93〜8.97 | 8.77 | 0.980 |
| 外気浴 夕暮れ | 7.90〜7.94 | 7.86〜7.89 | 0.997 | 12.32〜12.37 | 12.17〜12.24 | 0.991 |
| 外気浴 夜 | 8.37〜8.40 | 8.35〜8.37 | 0.996 | 13.10〜13.16 | 12.96〜13.02 | 0.989 |

- **わずかに速くなった。** DPR 1.5では全視点で変更前後の範囲が重ならず、約0.1〜0.2ms（1〜2%）減った。DPR 1では0〜0.1ms（0〜1%）で、サウナの夜は差がない。どの組でも遅くなった視点はない。
- 減った量は画素数にほぼ比例する（DPR 1.5は1の2.25倍の画素で、差は約2倍）。描画の重さによらずほぼ一定で、MSAAの解決・深度のクリアという画面1枚分の固定費と合う。
- 水風呂の夕暮れ・夜（DPR 1.5で約17.6・18.2ms）は60fpsの16.7msにまだ届かない。

## 範囲外

軽量・高精細画質、DPR 2以上、他の端末・ブラウザ（タイル型GPUではMSAAの解決の費用が異なる）。HDR出力に対応しない端末は従来どおり `antialias: true` のcanvasに直接描くので変わらない。

## 再実行

bashのスクリプトから、変更前のworktree（`git worktree add --detach <dir> a3d7ad5`、`node_modules` はリンク）と作業ツリーをそれぞれ `bun run build` した後、交互に実行する。

```sh
FRAME_COST_VARIANTS=warmup,product FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts --reporter=json > <out>.json
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/canvas-msaa/cost.json \
  --runs dpr1 before=<4件> after=<4件> --runs dpr1.5 before=<4件> after=<4件>
```

[値](cost.json)（`comparisons.dpr1`・`dpr1.5` の各視点の `beforeIntervalMs`・`afterIntervalMs`・`intervalRatios`）。
