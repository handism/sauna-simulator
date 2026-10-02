# 側面の像の判定を深度だけのパスへ分ける（2026-10-02、採用）

[ノイズの格子ハッシュのキャッシュ](../noise-lattice/README.md)の残件「側面の像（約4ms）」を調べた。側面の像（水面下の面を側面4面・角4つで鏡映した8つの複製、`refraction.ts` の `addSideImages()`）は、各断片で視線を屈折させて箱を追い、その画素が見る像でなければ `discard` していた。捨てる断片も水底のタイルの重いシェーダとして起動する。**判定だけの短いプログラムで深度を書く事前パスを加え、複製は深度が一致する画素だけを判定なしで塗るようにした。DPR 1.5の水風呂は0.97〜0.98倍（約0.45ms）、サウナは0.98〜0.99倍、外気浴は不変。** 画像は判定の境界の数画素だけ変わる。

条件：Chrome 154／ANGLE Metal（Apple M1 Max）、headless、`e2e/frame-cost.gpu.ts`、1200×800・動作抑制・標準画質・DPR 1.5、繰り返し2回のフレーム間隔（`intervalMs.mean`）。

## 変更

- 各複製に、同じ形状の子メッシュ（同じレイヤー2、`renderOrder` 1）を加える。材質は複製と同じ定義・同じ `onBeforeCompile`（頂点シェーダが同一）で、断片シェーダだけを `#include <common>` と `clipping_planes_fragment`（先頭に側面の像の判定 `sideImage` がある）だけの短いものに置き換え、色は書かない。
- 複製は `renderOrder` 1.5、`depthFunc` を `EqualDepth`、深度書き込みなし。`SUI_SIDE_TESTED` を定義し、`sideImage` の判定の `discard` を省く（像の経路 `suiWetView` の計算は残す）。判定は1回だけ行われるので、2つのプログラムで判定が食い違って穴が開くことはない。
- 真の面（`renderOrder` 0）は従来どおり先に描かれ、手前の縁石などが像の深度パスを捨てる。裏の内壁（`renderOrder` 2）は従来どおり像の後にブレンドする。像の深度は従来と同じ値なので、後の描画との深度の関係は変わらない。
- 深度プリパス（`depthPrepass.ts`、レイヤー4）や影のマスクの前段には入れない（影のマスクもレイヤー4を先に描くため、そこへ像の深度が入るのを避けた）。

## 結果

HEADのworktreeと交互4組（[cost.json](cost.json) の `comparisons`）。フレーム間隔（ms、各4回の範囲）と比の中央値。

| DPR 1.5 | 変更前 | 変更後 | 比 |
| --- | ---: | ---: | ---: |
| サウナ 昼 | 11.98〜12.07 | 11.76〜11.93 | 0.983 |
| サウナ 夕暮れ | 15.02〜15.08 | 14.80〜15.02 | 0.989 |
| サウナ 夜 | 15.80〜15.93 | 15.67〜15.80 | 0.990 |
| 水風呂 昼 | 15.56〜15.74 | **15.14〜15.31** | 0.969 |
| 水風呂 夕暮れ | 18.55〜18.71 | **18.12〜18.29** | 0.977 |
| 水風呂 夜 | 19.17〜19.25 | **18.71〜18.81** | 0.977 |
| 外気浴 | 8.6〜12.9 | 同じ | 0.998〜1.004 |

- 水風呂は4組とも範囲が重ならない。夕暮れ・夜は約18.2・18.8msで、この機械の60fps（16.7ms）にはまだ届かない。
- 描画数は複製の数だけ増える（サウナ118→138、水風呂109→129）。読み込み（`data-load-ms`）は約680→約715msで、増えたプログラムのコンパイル分と考えられる。
- 効果の内訳（捨てる断片の起動費用と、`discard` がAppleの隠面除去を止める分）は切り分けていない。

## 画像

Cycles視点18枚・水風呂ステージ12枚を各版2回撮影した（`imageRuns`・`imageDelta`）。

- 水風呂ステージ：水平の9枚で変更後が変更前と一致しないが、同じ版の2回は一致し（変更前どうしも最大2/255）、差は決定的。差は側面の像の境界の1〜数画素（JPEGのブロックで数百画素、最大11/255、ΔE>5の画素0、1枚の平均ΔEの最大0.0005）。判定を別のプログラムでコンパイルしたことによる、境界での像の選び方のずれと考えられる。見下ろしの3枚は全画素一致。
- Cycles視点：水の見える03で各2〜7画素（>12/255）が決定的に変わる。ほかの差（01・04・05のデッキの縁など）は変更前どうしにも同程度に出る読み込み間の揺れ。
- 穴（像も真の面も描かれない画素）は見当たらなかった。

## 再実行

```sh
bun run build   # 変更前はHEADのworktree（node_modulesをリンク）
# bashのスクリプトで、変更前・変更後を順序を入れ替えながら交互に
FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 FRAME_COST_VARIANTS=warmup,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > after-1.json
bunx playwright test --config playwright.visual.config.ts e2e/cycles-compare.visual.ts e2e/stage-compare.visual.ts --reporter=json
# 撮影ごとに test-results/visual を別の場所へコピーしてから
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/side-image-depth/cost.json \
  --runs standard-1.5-2 before=<4回> after=<4回> \
  --image-runs before=<撮影>,<撮影> after=<撮影>,<撮影> --image-delta <変更前の撮影> <変更後の撮影>
```

## 検証

GPU計測（HEADと交互4組）、Cycles視点・水風呂ステージの撮影（各版2回）、単体テスト（`refraction.test.ts` に深度パスの子メッシュ・材質の検査を追加）、型検査・Lint・整形・ビルド、ブラウザ回帰（`bun run test:browser`）。高画質・DPR 2、他の端末、継続利用は未確認。
