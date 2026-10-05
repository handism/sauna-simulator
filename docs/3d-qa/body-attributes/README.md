# 本体の頂点属性（2026-10-05、調査）

各節は実施時点の記録。現在は末尾の「圧縮パイプラインへの統合・採用」のとおり、本体8bit法線を配信済み。

調査開始時の本体GLBの固有アクセサを全復号し、有限値・型・要素数を検査した。製品コードと配信物は変更していない。

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

## 見回し中の比較（2026-10-05）

`body-normals-look.visual.ts` は結露の近接視点と水風呂の既定視点を、昼・夕・夜それぞれ1 CSS pxずつ12回横へドラッグして戻す。各条件25枚、1実行150枚のPNG。`CAPTURE_QUALITY`・`CAPTURE_DPR` と `QA_BODY_MODEL` は静止画と同じ。固定解像度・動作抑制で水の波を止め、製品のTAAを有効にして法線と視点変更の影響を比較する。

アプリの `requestAnimationFrame` コールバックを撮影中だけ保留し、ドラッグごとに1回分のコールバックを進める。これによりスクリーンショットの待ち時間でTAAの履歴が静止状態まで進まない。照明・画質・最初の静止状態は通常の描画で準備する。実時間の動画・FPS・波と視点の同時変化は検証対象外。

```bash
node scripts/make_body_normal_candidate.mjs /tmp/sauna-body-oct8.glb /tmp/sauna-body-oct8.json
for run in base1 candidate1 candidate2 base2; do
  unset QA_BODY_MODEL
  if [[ $run == candidate* ]]; then export QA_BODY_MODEL=/tmp/sauna-body-oct8.glb; fi
  bun run test:browser:visual e2e/body-normals-look.visual.ts --reporter=json > "/tmp/sauna-body-look-$run.json"
  mkdir -p "/tmp/sauna-body-look-$run"
  cp -R test-results/visual/. "/tmp/sauna-body-look-$run/"
done
python3 scripts/summarize_body_normals_look.py /tmp/sauna-body-look /tmp/sauna-body-oct8.json docs/3d-qa/body-attributes/look.json
```

集計は4実行すべての成功、150枚ずつの画像、カメラ・ブラウザ・画質・画素比・入力ハッシュ・候補の取得回数・TAA有効状態・移動順を検査する。停止した描画を誤って評価しないよう、開始と折り返しで5%以上の画素が変化することも確認する。対応するフレーム間のΔE76と、候補−現行のL*誤差のフレーム間変化を出す。後者は同じ画面座標での誤差変化で、回転を補償したちらつきや知覚上の合否指標ではない。同じ版の再撮影を対照にし、差の大きい領域の連続5枚を目視する。

高精細では上のループに `export CAPTURE_QUALITY=high CAPTURE_DPR=2` を付け、すべての保存先の接頭辞を `/tmp/sauna-body-look-high` にする。集計コマンドは次のとおり（画質・DPRは添付から読み、4実行で一致を検査する）。

```sh
python3 scripts/summarize_body_normals_look.py /tmp/sauna-body-look-high /tmp/sauna-body-oct8.json docs/3d-qa/body-attributes/look-high.json
```

標準画質・DPR 1.5（1800×1200、Google Chrome 154.0.8037.97・macOS）の4実行は8件成功・600枚。現行版同士・候補同士の150枚はそれぞれ全画素一致し、2組の比較値も一致した。

| 条件 | 平均ΔE（25枚平均） | ΔE>2の画素割合の最大 | L*誤差変化の平均の最大 |
| --- | ---: | ---: | ---: |
| 結露・昼 | 0.0732 | 0.00083% | 0.0313 |
| 結露・夕 | 0.0414 | 0.00403% | 0.0145 |
| 結露・夜 | 0.0281 | 0.00472% | 0.0122 |
| 水風呂・昼 | 0.0506 | 0.00171% | 0.0224 |
| 水風呂・夕 | 0.0411 | 0.00102% | 0.0174 |
| 水風呂・夜 | 0.0332 | 0.00102% | 0.0146 |

差の大きい領域の連続画像では、候補だけに現れる結露の欠け・水面境界の段差は見当たらなかった。既存の結露の角張った形状は両方にある。比較画像は `look-{condensation,water}-{day,evening,night}.jpg`（ローカルのみ）、[数値と入力](look.json)。

高精細・DPR 2（2400×1600、同じChrome）の4実行も8件成功・600枚。現行版同士・候補同士の150枚はそれぞれ全画素一致し、2組の比較値も一致した。

| 条件 | 平均ΔE（25枚平均） | ΔE>2の画素割合の最大 | L*誤差変化の平均の最大 |
| --- | ---: | ---: | ---: |
| 結露・昼 | 0.0734 | 0.00167% | 0.0314 |
| 結露・夕 | 0.0414 | 0.00370% | 0.0145 |
| 結露・夜 | 0.0281 | 0.00417% | 0.0121 |
| 水風呂・昼 | 0.0504 | 0.00156% | 0.0222 |
| 水風呂・夕 | 0.0409 | 0.00039% | 0.0172 |
| 水風呂・夜 | 0.0330 | 0.00068% | 0.0144 |

高精細の連続画像も確認し、標準画質と同様に、候補だけの欠け・水面境界の段差は見当たらなかった。比較画像は `look-high-{condensation,water}-{day,evening,night}.jpg`（ローカルのみ）、[数値と入力](look-high.json)。

**判断：今回の静止画・分割・メモリ・制御した見回しの検証範囲では、採用を妨げる画質劣化は認められない。圧縮パイプラインへ統合する候補とする。** 配信GLB・製品コードは今回も変更していない。次はパイプラインから同じ候補を生成できることの確認と、採用後の通常ブラウザ回帰。波が動く実時間の見回し、速い回転、他ブラウザ・実機、GPU時間は今回の検証に含まない。

検証：型検査、43ファイル291単体テスト、Lint、整形、本番ビルド、撮影16件（計1200枚）、標準・高精細の集計、画素比が不一致の記録の拒否、集計の重複計算を省略する前後で標準画質の全結果が一致、差分チェック。通常ブラウザ回帰一式は製品・配信物を変更していないため再実行していない。


## 圧縮パイプラインへの統合・採用（2026-10-05）

本体の8bit法線を採用した。`compress_web_glb.mjs` は本体を従来のEXPONENTIALで圧縮した後、共通の `body_normal_oct.mjs` で法線だけを8bit octへ変換する。診断用候補生成も同じ処理を使う。元のfloat32法線から直接oct化すると前回の画像レビューと入力が変わるため、順序を保持した。`--lossless` は本体・庭とも法線を整数化しない。

今回はBlenderを再書き出しせず、圧縮済み本体だけを移行した。パイプラインの出力・共通処理の候補・前回レビュー済み候補が全バイト一致した。本体2,725,640→2,393,152バイト（−332,488、−12.2%）。庭・位置・UV・色・画像・三角形・ノード・材質は維持される。[採用時の入力・出力・法線検査](adoption.json)、[配信物の圧縮記録](../../3d-export/compression-report.json)。既存のEXPONENTIALのbits/maxErrorは整数化前の検査、bodyNormalsはその後の検査を示す。ドライバーの実メモリやGPU時間の削減を主張する値ではない。

過去の比較を再実行する場合は、調査開始時の本体を取得して、候補生成の第3引数へ渡す。既に8bit化された配信物の二重量子化は拒否する。

```sh
git show 1900da1:public/models/sauna.glb > /tmp/sauna-body-before-integration.glb
node scripts/make_body_normal_candidate.mjs /tmp/sauna-body-oct8.glb /tmp/sauna-body-oct8.json /tmp/sauna-body-before-integration.glb
node scripts/compress_web_glb.mjs /tmp/sauna-body-before-integration.glb /tmp/sauna-body-pipeline.glb /tmp/sauna-body-pipeline.json --body-normals-only
cmp /tmp/sauna-body-oct8.glb /tmp/sauna-body-pipeline.glb
cmp /tmp/sauna-body-pipeline.glb public/models/sauna.glb
bun run test scripts/body_normal_pipeline.test.ts
```

CLI回帰は未圧縮の小さなGLBから既定の8bit化・他属性の復号一致・形状と非一様スケール保持・再実行一致・losslessの完全復号・圧縮済み本体の移行・二重変換と不正オプションの拒否を検査する。Blender再書き出しの入力は以前から画像などに差があるため、その出力全体の同一性は今回の確認対象ではない。

採用後の `diagnose_glb_attributes.mjs` は正規化int8・ストライド4も復号できる。現在の配信物の属性一覧は出せるが、既に8bitの法線には再量子化の見積もりを付けない。調査当時の法線比較と分割回帰は保存したfloat32本体を第2引数へ渡す。

```sh
node scripts/diagnose_glb_attributes.mjs /tmp/sauna-body-current-attributes.json
node scripts/diagnose_glb_attributes.mjs /tmp/sauna-body-before-attributes.json /tmp/sauna-body-before-integration.glb
bun scripts/diagnose_body_normal_slice.mjs /tmp/sauna-body-before-slice.json /tmp/sauna-body-before-integration.glb
```

採用後の検証：型検査、44ファイル292単体テスト、Lint、整形、本番ビルド、通常ブラウザ回帰38件成功（Chrome/macOS、10.3分）、差分チェック。通常回帰はGPUバッファ推定の周回と再生成、実コンテキスト喪失、実時間30秒のモデル／チャンク期限と2D復帰、タッチ操作、リサイズ、音源ノード数を含む。初回のサンドボックス内プレビューはlisten EPERMで失敗し、許可された環境で再実行した。前回の画像レビュー済み候補と配信出力が全バイト一致したため、画像比較の再撮影は行っていない。GPU時間・実機・実聴の確認ではない。
