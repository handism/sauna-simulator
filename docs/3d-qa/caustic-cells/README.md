# DPR 1.5の水風呂の費用の内訳と、コースティクスのセル特徴点のキャッシュ（2026-10-01、採用）

[フレーム間隔での測り直し](../frame-interval/README.md)の残件「標準画質の上限のDPR 1.5で水風呂が60fpsに届かない（18〜22ms）」の内訳を切り分けた。**費用の大半は水底のタイル（`SUI_WATER_BOTTOM`）のシェーダで、なかでも最大はコースティクスのVoronoiだった。** Voronoiの特徴点はセルの整数座標だけで決まり、模様は静的なので、届き得るセルの特徴点をBlenderと同じハッシュでCPUが計算し、小さなfloatの3Dテクスチャから読むようにした。GPUのハッシュとビット単位で一致し、画像は変わらない。DPR 1.5の水風呂は0.86〜0.89倍（昼18.4→15.7ms、**60fpsに収まった**）、夕暮れ・夜は約19msで、まだ届かない。

条件：Chrome／ANGLE Metal（Apple M1 Max）、headless、`e2e/frame-cost.gpu.ts`、1200×800・動作抑制、標準画質。1フレームの費用は繰り返し描画のフレーム間隔（`intervalMs.mean`、DPR 1.5は2回・DPR 1は3回）。

## 内訳（DPR 1.5、変更前）

各変種の節約量は直前・直後の製品との差（`--light-costs`、[cost.json](cost.json) の `lightCosts`）。値は水風呂の昼／夕暮れ／夜（ms）。

| 外したもの | 昼 | 夕暮れ | 夜 |
| --- | ---: | ---: | ---: |
| 製品 | 18.4 | 21.2 | 21.8 |
| 全画素シェーダを定数（`trivial`、60fpsの8.33msに張り付くので下限） | ≥10.0 | ≥12.9 | ≥13.4 |
| 全灯の影の参照（`noshadow-all`） | 1.9 | 1.9 | 2.0 |
| 水底のタイルの材質を定数（`trivial-with-SUI_WATER_BOTTOM`） | 10.1 | 11.5 | 11.7 |
| 　うちコースティクス全体（`cut-caustic`） | 5.7 | 5.3 | 5.2 |
| 　　Voronoiの辺（`cut-voronoi`） | 4.6 | 4.3 | 4.2 |
| 　　位置を歪めるノイズの色（`cut-warp`） | 1.5 | 1.6 | 1.1 |
| 　　濃淡のFBM（`cut-visibility`） | 1.0 | 0.6 | 0.8 |
| 　水の底面の反射（`cut-bottom`） | 2.4 | 2.1 | 2.1 |
| 　　そのうち傾けた4本の追跡（`cut-tilt`）／揺らした追跡（`cut-bump`） | 1.8／1.6 | 1.5／1.3 | 1.6／1.5 |
| 　水越しのハイライト（`cut-wet`） | 1.7 | 1.7 | 1.5 |
| 側面の像（`trivial-with-SUI_SIDE_IMAGE`、水底の像を含む） | 4.1 | 4.0 | 4.1 |
| 水面の鏡像の材質（`trivial-with-suiMirror`） | 0.3 | 0.3 | 0.4 |

- 影はDPR 1.5でも約2msで、主因ではない（影のマスクで画素あたり1回になっている）。`discard`（隠面除去を止める）は差がなく、重なりは律速でない（1画素あたりの計算回数は水風呂2.0、サウナ2.2）。
- 部分の節約は足し算にならない（`cut-tilt` と `cut-bump` はそれぞれ `cut-bottom` の7割前後）。
- サウナの既定視点でも水底は3.3〜3.9msを占める。外気浴からは見えない（0.1〜0.3ms）。

## 変更

- `caustics.ts`：`causticCells()` が、`sui_caustic_strength` の箱（Blender座標、下端は新たに−0.5m。水中の材質は0.18mから上）を、ノイズの色による歪み（0.2×[0, 1]）に0.05mの余裕を足し、尺度5.2で両隣のセルまで含めた19×21×11セルの特徴点（`sui_hash3v` と同じJenkinsハッシュをCPUで計算）をRGBA floatの3Dテクスチャ（約70KB）にする。`SUI_CAUSTIC_CELLS` のとき `sui_voronoi_edge` は `texelFetch` で読む（範囲外の分岐は置かない。実行されないハッシュのコードもシェーダに残すと費用になるため）。2材質で共有し、材質の破棄で解放する。定義がないとき（空や検証）は従来どおりハッシュを計算する。
- `caustics.e2e.ts`：全セルのGPUのハッシュとCPUの値、Blender基準点と箱の中の4000点の模様（フィルターあり・なし）をハッシュ版とキャッシュ版で比べ、**どちらも不一致0**を要求する。
- `frame-cost.ts`：`trivial-with-<名前>`／`trivial-without-<名前>`（その定義かuniformを持つ／持たないプログラムだけ定数化）、`cut-<部分>`（`bottom`・`tilt`・`bump`・`caustic`・`voronoi`・`warp`・`visibility`・`wet`）を追加。どの書き換えも当たらなければ失敗する。
- `summarize_frame_cost.py`：`--light-costs`・`--ablation` が繰り返し描画の記録ではフレーム間隔を使う（単発との混在は拒否）。

### 不採用：1周目のハッシュを配列に残す

2周目で同じ27点のハッシュを計算し直さないよう `vec3 points[ 27 ]` に保存すると、**水風呂で1.08〜1.11倍遅くなった**（DPR 1.5、交互4組）。レジスタの圧迫と考えられる。テクスチャは2周とも読み直している。

## 結果

HEADのworktreeと交互（[cost.json](cost.json) の `comparisons`）。1フレームの費用（ms、各組の範囲）。

| | 標準・DPR 1.5（2回、4組） | 比 | 標準・DPR 1（3回、2組） | 比 |
| --- | ---: | ---: | ---: | ---: |
| サウナ 昼 | 12.2〜12.5 → 12.0〜12.2 | 0.99 | 7.95 → 7.7 | 0.97 |
| サウナ 夕暮れ | 15.3〜15.4 → 15.0〜15.1 | 0.98 | 10.6 → 10.4 | 0.98 |
| サウナ 夜 | 16.1〜16.4 → 15.9〜16.3 | 0.99 | 11.3 → 11.1 | 0.98 |
| 水風呂 昼 | 18.3〜18.5 → **15.7〜16.0** | 0.86 | 11.0 → 9.7 | 0.88 |
| 水風呂 夕暮れ | 21.1〜21.3 → 18.6〜18.9 | 0.88 | 12.9 → 11.5 | 0.89 |
| 水風呂 夜 | 21.7〜22.1 → 19.3〜19.4 | 0.89 | 13.5 → 12.1 | 0.90 |
| 外気浴 | 変化なし | 1.00 | 変化なし | 1.00 |

- **この機械の60fps（16.7ms）**：DPR 1.5で水風呂の昼が収まった。水風呂の夕暮れ・夜（約19ms）はまだ届かない。サウナの夜は15.9〜16.3msでぎりぎり。
- 画像：Cycles視点18枚・水風呂ステージ12枚を各版2回撮影し、変更前後の差（平均ΔE 0.0000、1枚の平均の最大0.0001）は変更前どうしの読み込み間の差（最大0.0028）以下（`imageRuns`・`imageDelta`）。

## 残件

- DPR 1.5の水風呂の夕暮れ・夜の残り約2.5ms：水の底面の反射（約2ms、光源の縁を探す傾けた4本の追跡が、毎画素で追跡と光源との交差を繰り返す）、水越しのハイライト（約1.6ms）、残りのコースティクス（歪みのノイズの色・FBMで約1.5ms）、側面の像（約4ms、同じ水底の処理を含む）。
- 高画質・DPR 2、他の端末、継続利用は未確認。

## 再実行

```sh
bun run build   # 変更前はHEADのworktree（node_modulesをリンクし、e2eの2ファイルをコピー）
# bashで（zshは "$c" を分割しない）
FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 \
  FRAME_COST_VARIANTS=warmup,product,cut-caustic,cut-voronoi,cut-warp,cut-visibility,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts --reporter=json > split.json
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/caustic-cells/cost.json \
  --runs standard-1.5-2 before=<変更前の4回> after=<変更後の4回> --runs standard-1-3 before=... after=... \
  --light-costs split1.json split2.json split3.json split4.json \
  --image-runs before=<撮影>,<撮影> after=<撮影>,<撮影> --image-delta <変更前の撮影> <変更後の撮影>
```

## 検証

型検査、39ファイル235単体テスト（`caustics.test.ts` 1件追加）、Lint、整形、本番ビルド、ブラウザ回帰16件（`caustics.e2e.ts` 1件追加）、Python 162テスト（集計1件追加）、撮影（Cycles視点・水風呂ステージを各版2回）、GPU計測（切り分け4報告、交互4組＋2組、不採用の版の交互4組）。3Dチャンクは757.68→759.50KB（既存の容量警告は継続）。継続利用・高画質のGPU時間・モバイル実機・他のGPUは未検証。
