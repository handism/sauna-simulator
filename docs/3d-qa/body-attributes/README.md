# 本体の頂点属性（2026-10-05、調査）

配信中の本体GLBの固有アクセサを全復号し、有限値・型・要素数を検査した。製品コードと配信物は変更していない。

| 属性 | 復号バイト | 圧縮バイト |
| --- | ---: | ---: |
| POSITION | 1,847,820 | 424,352 |
| NORMAL | 1,847,820 | 518,896 |
| TEXCOORD_0 | 1,076,728 | 282,517 |
| TEXCOORD_1 | 599,984 | 47,338 |
| COLOR_0 | 512,672 | 19,935 |

NORMALの153,985頂点を庭と同じ8bit octフィルタで圧縮・復号する候補をメモリ上だけで試した。最大角度誤差は1.21633°。復号後は615,940バイトで1,231,880バイト（1.175MiB）減、圧縮ペイロードは214,282バイトで304,614バイト減る。後者はコンテナ全体の転送量ではない。値にはスクリプトと入力のSHA-256を保存する。

`refraction.ts` の `sliceUnderwater` は属性を `getComponent` で正規化された値として読み、補間した法線を正規化し、元の配列型・normalized設定を保って `setComponent` で書き戻す。したがって正規化int8を一律float32へ戻す経路ではない。ただし補間後の再量子化誤差・水面の切断境界・屈折と影の画像は未検証。配信物を変更する前に、この経路の回帰と全視点の画像比較、実ブラウザのGPUメモリ計測が必要。

POSITION・UVもfloat32、COLOR_0は正規化uint16だった。位置の量子化は座標に依存する処理や境界の精度に影響するため今回は試していない。上表は配信アクセサの内訳であり、水中分割後の追加頂点やドライバーの実確保量を含まない。実測の高速化や見た目の一致は主張しない。

再実行：

```sh
node scripts/diagnose_glb_attributes.mjs docs/3d-qa/body-attributes/values.json
```

[値](values.json)。

## 水中分割の回帰（2026-10-05）

`diagnose_body_normal_slice.mjs` は配信中の本体の74プリミティブを全復号し、元のfloat32法線と、庭と同じ8bit oct圧縮・復号の候補を、製品の `sliceUnderwater` に通す。ノード階層のワールド変換と水面高さ0.765mを使う。候補はGLTFLoaderと同じ正規化int8・ストライド4のinterleaved属性にする。`prepareModel` が隠す旧水形状は分割しない。GLBと製品コードは変更しない。

- 分割対象は3プリミティブ。追加頂点16,700・追加三角形8,350、材質判定・インデックス・グループ・位置・UV・色は候補と元で完全一致した。
- 元頂点の法線の最大角度誤差1.21633°、追加頂点は0.53170°。元のint8型とnormalized設定は維持され、補間後の成分を再量子化した法線の長さの誤差は最大0.00601未満だった。
- **ワールド変換後の最大角度誤差は1.60442°**。非一様スケールの `Glass condensation bead` がローカルの1.01819°を拡大する。ローカルの1.5°以内という検査だけでは、照明が使うワールド法線まで1.5°以内とは言えない。これは分割対象外の結露の粒で、画像への影響は未確認。
- 分割後の各プリミティブの法線配列のバイト数の和は2,048,220→617,843（差1,430,377、約1.36MiB）。未分割の候補は4バイト/頂点、分割後は3バイト/頂点。旧水形状もこの和に含む。GPUの確保・共有・側面の鏡映像・ドライバーのコピーを計測した値ではない。
- `refraction.test.ts` に、負の成分と変化する法線を持つinterleaved int8属性・非一様スケール・複数材質の分割回帰を追加。元頂点の保持、追加頂点の方向と長さ、形状・UV・グループの一致、元の配列が変わらないことを検査する。

再実行（Bunで製品のTypeScriptを直接読む）：

```sh
bun scripts/diagnose_body_normal_slice.mjs docs/3d-qa/body-attributes/slice.json
bun run test src/components/3d/refraction.test.ts
```

[分割の値](slice.json) は入力・シーン定義・スクリプト・分割実装のSHA-256を記録し、同じ実行を2回行ってJSON全体が一致した。候補の採用は保留。次は結露の粒を含む画像比較（屈折・水面境界・影も確認）とGPUメモリ実測。数値の誤差検査は画質の合格判定ではない。

## 候補の画像・GPUメモリ比較（2026-10-05）

`make_body_normal_candidate.mjs` は配信中の圧縮済み本体GLBから候補を作る。Blender再書き出しの揺らぎを混ぜず、法線のペイロードだけを8bit octへ置き換える。位置・UV・色・インデックス・画像の圧縮ペイロードはバイト一致、ノード・三角形・材質・他のアクセサのメタデータも一致を検査する。変えるのは法線と、その型・ストライド・bufferViewの配置・必須拡張の宣言だけ。出力先は `public/` の外に限定し、配信物を上書きしない。

`QA_BODY_MODEL` を指定すると `e2e/model-candidate.ts` が本体GLBのHTTP応答だけを差し替える。添付JSONには実際に返した候補のSHA-256・バイト数・要求回数を記録する。Cycles撮影は2要求、水風呂・結露の撮影は各1要求、GPUメモリの再生成は4要求を検査する。庭・照明・プローブ・製品の描画コードは同じものを使う。

標準画質・DPR 1.5・動作抑制・固定解像度のGoogle Chromeで、Cycles 18視点と水風呂12視点、結露の近接3視点を変更前→候補→候補→変更前の順にPNGで撮る。結露の近接カメラは非一様スケールでワールド法線の誤差が最も大きかった `Glass condensation bead` の位置をGLBから取り、38cm手前に置く（自由歩行の製品機能ではない）。画像にはUIを含めない。

最初の30視点の撮影では、同じ版のCycles画像にも平均ΔEが最大約2.16の差が出た。候補の差として扱わず、撮影前に70フレーム（TAAの静止判定60フレームを超える）待つように撮影コードを変更して撮り直した。最初の撮影は最終集計に含めない。

再実行（シェルはbash、画像を消さないよう各回の終了後にコピーする）：

```bash
node scripts/make_body_normal_candidate.mjs /tmp/sauna-body-oct8.glb /tmp/sauna-body-oct8.json
export CAPTURE_PNG=1 CAPTURE_DPR=1.5 CAPTURE_QUERY='&resolution=fixed'
for run in base1 candidate1 candidate2 base2; do
  unset QA_BODY_MODEL
  if [[ $run == candidate* ]]; then export QA_BODY_MODEL=/tmp/sauna-body-oct8.glb; fi
  bun run test:browser:visual e2e/cycles-compare.visual.ts e2e/stage-compare.visual.ts --reporter=json > "/tmp/sauna-body-settled-$run.json"
  mkdir -p "/tmp/sauna-body-settled-$run"
  cp -R test-results/visual/. "/tmp/sauna-body-settled-$run/"
  bun run test:browser:visual e2e/body-normals.visual.ts --reporter=json > "/tmp/sauna-body-close-$run.json"
  mkdir -p "/tmp/sauna-body-close-$run"
  cp -R test-results/visual/. "/tmp/sauna-body-close-$run/"
done
unset CAPTURE_PNG CAPTURE_DPR CAPTURE_QUERY
for run in base candidate; do
  unset QA_BODY_MODEL
  if [[ $run == candidate ]]; then export QA_BODY_MODEL=/tmp/sauna-body-oct8.glb; fi
  bun run test:browser e2e/gpu-memory.e2e.ts --reporter=json > "/tmp/sauna-body-memory-$run.json"
done
unset QA_BODY_MODEL
python3 scripts/summarize_body_normals.py /tmp/sauna-body /tmp/sauna-body-oct8.json docs/3d-qa/body-attributes/browser.json
```

集計は失敗・skip・flaky・不完全な撮影、候補ハッシュの不一致、画質・画素比・水中分割数の不一致を拒否する。`browser.json` に候補生成・入力・撮影コードのハッシュ、実行環境、全撮影の添付データ、ΔE76、同じ版の撮り直しの差、メモリ推定値を保存する。画像はGit管理外。

メモリはWebGLの確保・解放呼び出しからの推定であり、ドライバーの実確保量ではない。静止画の比較は見回し中のTAA・ちらつき・GPU時間・実機・他ブラウザ・音の実聴を検証しない。

### 結果と判断

Chrome 154.0.8037.97・macOS。Cyclesと結露は1200×800、水風呂は1280×800のCSS画素・DPR 1.5。画像差は変更前に対するΔE76で、下表は全画像の平均と、1枚ごとの平均の最大。2組の比較は小数第4位まで同程度だった。

| 撮影 | 枚数 | 全体の平均ΔE | 1枚の平均ΔEの最大 | ΔE>2の画素（全体） |
| --- | ---: | ---: | ---: | ---: |
| Cycles視点 | 18 | 0.0713 | 0.1102 | 0.018% |
| 水風呂の4方向×3時間帯 | 12 | 0.0445 | 0.0840 | 0.001% |
| 結露の近接×3時間帯 | 3 | 0.0467 | 0.0712 | 0.003% |

- 同じ候補の2回は33枚すべて全画素一致。変更前も水風呂・結露は一致し、Cyclesだけ従来の小さな揺らぎ（1枚の平均ΔEの最大0.0003）が残る。70フレーム待ちで、最初に出た大きな撮影差はなくなった。
- 結露の粒の輪郭、水面の切断境界・屈折像・側面の像に新しい割れや段は見えなかった。差は床・椅子・結露などの小さな明暗変化。[比較一覧](review.jpg)、[結露の拡大](condensation-day.png)（画像はローカルのみ）。静止した標準画質の範囲での所見。
- GLB全体は2,725,640→2,393,152バイト（−332,488、−12.2%）。今回の候補はbitstream v1で圧縮するため、前のメモリ上診断の圧縮ペイロード見積もりとは違う。候補生成の2回はGLB・生成レポートとも完全一致。
- GPUバッファの推定値は24,028,888→22,606,823バイト（−1,422,065、約1.356MiB）。軽量・標準・高精細の全ステージで同じ削減量。テクスチャ・描画先は不変。1280×800・DPR1の合計は水風呂／外気浴で軽量124.268→122.912、標準184.015→182.659、高精細316.719→315.362MiB。各版で周回2回と3回の再生成後も同じ値、旧コンテキストは解放された。

標準画質の静止画・分割・メモリの検証を通過した候補として記録する。**配信GLBと製品コードは変更していない**。採用前の残件は高精細・DPR2の画像と、見回し中の結露・屈折境界の確認、採用する場合の圧縮パイプラインへの統合と通常のブラウザ回帰。GPU時間の高速化は計測していない。

[ブラウザの値と入力ハッシュ](browser.json)。検証：候補生成2回の一致、型検査、43ファイル291単体テスト、Lint、整形、本番ビルド、最終撮影12件（通常視点8・結露4、132枚）、メモリ2件。最初の撮影8件（120枚）は撮影差の診断にのみ使用。

## 高精細・DPR 2の追加比較（2026-10-05）

結露の近接撮影も `CAPTURE_QUALITY`・`CAPTURE_DPR` を受け付けるようにした。既定は従来の標準・DPR 1.5。高精細の撮影は上記の4回のループを `CAPTURE_QUALITY=high CAPTURE_DPR=2` で実行し、保存先の接頭辞を `/tmp/sauna-body-high` にする。今回はメモリを再測定せず、画像だけを集計する。

```sh
python3 scripts/summarize_body_normals.py /tmp/sauna-body-high /tmp/sauna-body-oct8.json docs/3d-qa/body-attributes/high.json --quality high --dpr 2 --captures-only
```

集計では画像の枚数、画質と実際の描画画素比、候補のハッシュと取得回数、記録のあるブラウザの版、水中分割の数が揃うことを検査する。

Chrome 154.0.8037.97・macOS、動作抑制・固定解像度。通常視点と結露は2400×1600、水風呂は2560×1600のPNGで比較した。下表は最初の組の値。2組目も全体平均は小数第4位まで同じで、Cyclesの1枚の平均ΔEの最大だけ0.1116だった。

| 撮影 | 枚数 | 全体の平均ΔE | 1枚の平均ΔEの最大 | ΔE>2の画素（全体） |
| --- | ---: | ---: | ---: | ---: |
| Cycles視点 | 18 | 0.0718 | 0.1114 | 0.017% |
| 水風呂の4方向×3時間帯 | 12 | 0.0447 | 0.0849 | 0.002% |
| 結露の近接×3時間帯 | 3 | 0.0470 | 0.0719 | 0.003% |

33視点の比較一覧と結露・浴槽まわりの等倍切り出しを目視確認した。候補だけに現れる輪郭の割れ・水面境界の段は見当たらず、標準画質と同程度の小さな明暗差だった。比較一覧は `high-settled-0.jpg`〜`high-settled-4.jpg` と `high-close-0.jpg`、等倍切り出しは `high-crop-0.png`〜`high-crop-2.png`（いずれもローカルのみ）。

高精細の静止画も確認済みとする。配信GLBと製品コードは変更していない。採用前の残件は、見回し中の結露・屈折境界の確認、圧縮パイプラインへの統合と通常のブラウザ回帰。今回GPUメモリ・GPU時間は再測定していない。

再撮影では、現行版のCycles 01・04・05の9枚に77〜198画素の差があった。候補の水風呂5枚は各1画素だけ異なり、残り28枚は全画素一致。現行版の水風呂と結露、候補のCyclesと結露も全画素一致した。撮影条件を満たした12件・132枚を [高精細の値](high.json) に保存する。

検証：型検査、43ファイル291単体テスト、Lint、整形、本番ビルド、画像撮影12件、集計時の条件一致検査と不正なDPRの拒否、差分チェック。通常のブラウザ回帰一式は製品・配信物の変更がないため再実行していない。
