# コースティクスのノイズの格子ハッシュのキャッシュ（2026-10-02、不採用・記録）

[傾けた4本の追跡](../tilt-cost/README.md)の残件「DPR 1.5の水風呂の夕暮れ・夜の残り（約19ms）」のうち、コースティクスの残り（歪みのノイズの色・濃淡のFBM）を調べた。[Voronoiのセルのキャッシュ](../caustic-cells/README.md)と同じく、Perlinノイズの格子ハッシュも整数座標だけで決まり静的なので、CPUで前計算してテクスチャから読む版を作った。**模様は変わらないが、水風呂で0.984〜0.99倍（約0.15〜0.25ms）にとどまり、不採用とした。製品コードの変更はない。** 途中で、計測がシェーダのコンパイル失敗を見逃す問題に当たり、`frame-cost.gpu.ts` に検査を加えた（これは残す）。

条件：Chrome 154／ANGLE Metal（Apple M1 Max）、headless、`e2e/frame-cost.gpu.ts`、1200×800・動作抑制・標準画質・DPR 1.5、繰り返し2回のフレーム間隔（`intervalMs.mean`）。

## 試した版

- 対象：歪みのノイズの色（尺度3.6、detail 2：3チャンネル×3オクターブ）と濃淡（尺度1.7、detail 3：4オクターブ）。計13回のPerlin評価で、1回あたり8角のJenkinsハッシュ、画素あたり104回。
- 各チャンネル・オクターブで箱（`CAUSTIC_BOX`）から届き得る格子セル（両側に1セルの余裕）について、8角の勾配番号（`hash & 15`、4bit×8）を32bitに詰める。計約20万語。CPUでは格子点ごとに1回ハッシュしてから詰める。
- GLSLは13回の展開済みFBM（`sui_fbm` と同じ演算順、粗さ0.5・lacunarity 2）で、各オクターブは1回の `texelFetch` とビット取り出し。
- **水底の材質はテクスチャユニットに空きがない**（16、影マップ7＋材質のマップ＋プローブ＋Voronoiのセル）。別のテクスチャにすると水底の材質がコンパイルに失敗する。Voronoiのセルと格子を1枚のRGBA32UIにまとめた（セルは特徴点のfloatビットを1テクセル、格子は1テクセルに4語）。配置は2通り：
  - 2D版：幅512の2Dテクスチャ。Voronoiのセルも線形の索引から読む。約0.85MB。
  - 3D版：32×32×Nの3Dテクスチャ。Voronoiのセルは従来どおり3Dの座標で直接読み、格子は後ろのスライスに線形に詰める。

正確性（一時的な検査）：フィルターなしのノイズ値は約4000点でハッシュ版とビット単位で一致（格子のデータが正しい）。フィルターあり・模様全体では、展開したFBMの積和の融合がコンパイラで変わり、最大5.7e−6（強度の値域0〜0.28、float32の数ulp）の差が出た。Voronoiのセルのキャッシュと違い、完全一致にはならない。

## 結果

HEADのworktreeと交互（[cost.json](cost.json) の `comparisons`）。フレーム間隔の比の中央値。

| DPR 1.5（ms は変更前の中央値） | 2D版（4組、`lattice-2d`） | 2D版（2組、`rotation-2d`） | 3D版（2組、`rotation-3d`） |
| --- | ---: | ---: | ---: |
| サウナ 昼（12.0） | 1.003 | 1.005 | 1.005 |
| サウナ 夕暮れ（15.1） | 1.002 | 1.000 | 1.003 |
| サウナ 夜（15.9） | 0.996 | 1.010 | 1.010 |
| 水風呂 昼（15.7） | 0.986 | 0.984 | 0.984 |
| 水風呂 夕暮れ（18.6） | 0.989 | 0.990 | 0.990 |
| 水風呂 夜（19.2〜19.3） | 0.988 | 0.992 | 0.997 |
| 外気浴 | 0.994〜0.996 | 0.996〜1.003 | 0.998〜1.004 |

- 水風呂の4組は範囲が重ならず（変更前15.62〜15.80→変更後15.43〜15.49ms など）、効果は確かにあるが約0.2ms。夕暮れ・夜は18.4・19.1msで、60fps（16.7ms）にはまったく足りない。
- 2D版と3D版の差は揺れの範囲で、Voronoiの索引の計算は費用になっていない。
- 3者を順に回した計測では、変更前・2D版の各1回がブラウザの終了／描画の停止で失敗し、その巡を除いた（3巡目は回復）。

### 歪み・濃淡の残りの費用

キャッシュ版（2D）で、歪み・濃淡・コースティクス全体を外した節約量（製品で挟んだ1回、[cost.json](cost.json) の `lightCosts`）：

| 水風呂（ms） | 昼 | 夕暮れ | 夜 |
| --- | ---: | ---: | ---: |
| `cut-caustic` | 2.81 | 2.62 | 2.69 |
| `cut-warp` | 1.23 | 1.17 | 1.27 |
| `cut-visibility` | 0.59 | 0.46 | 0.54 |

- 格子ハッシュを消しても、`cut-warp` は約1.2ms残る。ただし `cut-warp` は歪みを外すことで、Voronoiの入力も歪んでいない座標になる（近い画素が同じセルを読み、テクスチャの読み出しがそろう）。ノイズだけの費用ではなく、`cut-bump` と同じく外した部分より広く測っている可能性がある。
- 費用の大半はハッシュではなく、Perlinの補間・勾配の演算か、歪みによるVoronoiの読み出しのばらつきと考えられる。どちらも画像を変えずに減らす見込みは立っていない。

## 不採用の理由

- 約0.2ms（1〜1.6%）に対し、CPUの生成約17〜27ms（M1 Max、読み込み時の主スレッド。モバイルでは数倍）、GPUメモリ約0.85MB、約150行の追加、模様の完全一致の喪失（数ulp）。[傾けた4本の追跡](../tilt-cost/README.md)の事前判定（0.979〜0.995倍）を見送った基準と同じ。

## 途中で分かったこと：シェーダのコンパイル失敗を計測が見逃す

最初の版は格子を別のテクスチャにしており、水底の材質（`V10 | submerged light / …`）が `FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)` でコンパイルに失敗していた。描かれない材質はフレームを速く見せるため、そのまま測ると誤った「改善」になる。`frame-cost.gpu.ts` は three.js の `WebGLProgram: Shader Error` がコンソールに出た回を失敗にする（今回追加、この版の1回目で検出した）。

## 再実行

試作の差分は残していない。上記の説明から作り直す場合：

```sh
bun run build   # 変更前はHEADのworktree（node_modulesをリンクし、e2e/frame-cost.gpu.tsをコピー）
# bashのスクリプトで、変更前・変更後を順序を入れ替えながら交互に
FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 FRAME_COST_VARIANTS=warmup,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > after-1.json
FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 FRAME_COST_VARIANTS=warmup,product,cut-warp,cut-visibility,cut-caustic,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > split.json
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/noise-lattice/cost.json \
  --runs lattice-2d before=<4回> after=<4回> --runs rotation-2d ... --runs rotation-3d ... --light-costs split.json
```

## 検証

GPU計測（2D版とHEADの交互4組、HEAD・2D版・3D版を順に回す3巡のうち2巡、キャッシュ版の切り分け1報告）、試作の単体テストとブラウザでの一致検査（一時的）。`frame-cost.gpu.ts` の変更（シェーダエラーの検査）は型検査・Lint・整形と上記の計測で確認した。製品コードは変わらないため、単体テスト・ブラウザ回帰・撮影は再実行していない。
