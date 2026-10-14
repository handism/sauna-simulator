# 水底に映る面光源の天蓋による遮蔽（2026-10-14）

水風呂のクリーム色の斑は、寝椅子灯を水の底面で部分反射した像であり、元のCyclesにもある。像そのものを消したり、灯りを一律に暗くしたりする変更ではない。

`waterBottom.ts` は水から出た光線と面光源の交差を計算するが、途中の遮蔽物は浴槽の縁だけを判定していた。`waterLightOcclusion.ts` で天蓋の梁2本とルーバー17本の遮蔽を追加した。灯りより手前で遮られた光だけを除く。水面自身の平面反射・通常の照明・タイル自身の光沢・反射プローブは変更しない。

## 形状と近似

- 元blendの `V8 canopy timber beam[.001]` と `V8 slender shade louver[.001〜.016]` の評価後の境界をglTF座標へ変換した。[canopy.json](canopy.json) に元blend・スクリプトのハッシュと寸法を保存。元blendは保存せず前後のハッシュ一致を検査した。
- 梁は軸に平行な箱。ルーバーは全体の箱に光線を切り詰め、そのx区間が周期的な幅0.065m・間隔0.228mの部材に重なるかで判定する。17本をループしない。
- 面取り・柱・その他の物体は含まない。天蓋が変わった場合は寸法を読み直す必要がある。動く形状には対応しない。
- 光源の縁・遮蔽の境界は既存の水のバンプ再評価にも反映する。追加テクスチャ・描画パス・形状・GLB・プローブ変更なし。2D既定とフォールバックを維持。
- TS参照実装を4,000本の固定乱数の光線でThree.jsの個別19箱の交差判定と照合。梁・ルーバー・隙間・逆向き・灯りが遮蔽物より手前の場合、面光源の一部だけが遮られる場合を検査する。

## 再実行

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend -S 'SUI • Blue hour' --python-exit-code 1 --python scripts/inspect_water_light_canopy.py -- docs/3d-qa/water-light-occlusion/canopy.json
CAPTURE_PNG=1 bun run test:browser:visual e2e/stage-compare.visual.ts --reporter=json
FRAME_COST_VARIANTS=warmup,product,product FRAME_COST_REPEAT=3 bun run test:browser:gpu e2e/frame-cost.gpu.ts --grep 'frame cost' --reporter=json
```

比較画像は変更前後の独立ビルドを使い、最初の撮影だけで採用を判断しない。ブラウザの成功は撮影・操作の成功であり、画質の所見は別に記録する。

## 最終画像（10/14撮影、10/15集計）

Chrome 155.0.8059.79、標準画質・DPR1・1280×800・動作抑制、水風呂の昼夕夜×4方向。前後の独立ビルドを各2回撮った（各1件成功・12枚、合計48枚）。各版の再撮影差は12枚すべて0画素。最初の変更前撮影はブラウザー版の添付追加前のため、同じ保存済みビルドの再撮影・負荷測定に記録した版と照合した。

[前後とCyclesの切り出し](comparison.png)（ローカル画像）・[画像ハッシュと集計](comparison.json)。最終製品ソースは撮影時の[入力ハッシュ](inputs.json)と一致する。

- 夕暮れ・夜の像の右側に、梁・ルーバーで遮られる境界が出た。もとの明るい円盤を消さず、余分に広がっていた部分が減った。確認画像に大きな欠落・黒抜けはない。
- 変更領域（前後のΔE76 > 2）のCycles参照との平均色差は、夕暮れの見出し2で31.99→18.25、見下ろしで30.84→14.40、見出し4で34.28→10.89。夜は32.79→18.71、31.71→14.82、36.95→11.40。約43〜69%低下。
- 昼は小さな変化で、同じ変更領域の色差は見出し2で9.87→9.97、見下ろし9.12→10.12、見出し4で6.32→5.94。昼の全視点の改善とはしない。既定の水平正面（見出し0）は昼夕夜とも変化0画素。
- この数値は変更領域の色差で、画像全体の画質向上率ではない。Cycles参照は庭・天気追加前のもので、画面全体の差を今回の修正の誤差とは扱わない。像の位置、ぼけ、タイル自身の光沢との合成には差が残る。

## 検証

型検査・385単体テスト・Lint・整形・ビルド・差分チェック、比較集計のPython 3テストが成功。最終ビルドの非HDRでのlow/standard/highの表示・回復3件、通常HDRでの繰り返しモード／ステージ移動・実コンテキスト喪失1件が成功（計4件、約150秒、失敗・skip・retryなし）。[記録](validation.json)。通常ブラウザ回帰全件・高画質の負荷・実時間の見回し・実Safari・実機は未確認。

遅延3Dチャンクは849.86→851.34kB（gzip約232.67kB）で、850kBの警告上限を超えた。ビルドは成功、上限の引き上げはしていない。通常の2D入口には含まれない。

## 描画費用

独立ビルドの変更前→後で各3件成功（warmupを除く各2回）、標準・DPR1・晴れ夏・3ステージ×昼夕夜。フレーム間隔÷3の変更後／前は0.999〜1.085倍。[cost.json](cost.json)。追加処理が見えない外気浴でも1.040〜1.065倍で、非交互測定の実行時の差を含む。単独で修正の増分とは解釈しない。描画回数と三角形数は不変。

10/15に同じ最終ビルドで `warmup,product,cut-canopy,product` を測定し、4件成功（366秒、失敗・skip・retryなし）。検証ブラウザのシェーダーで天蓋の遮蔽だけを外し、製品の測定で挟んだ。[ablation.json](ablation.json) に全標本・条件・レポートハッシュを保存。

- 水風呂の通常描画（前後平均）と遮蔽なしとの差は、昼−0.02ms、夕−0.01ms、夜−0.07ms。全9視点は−0.09〜0msで、判定を外しても速くならなかった。この1組では明確な増分を検出していない。速度改善や費用ゼロの証明ではない。
- これはフレーム間隔÷3であり、GPU単体時間・実機FPSではない。元実装との差全体ではなく、最終ビルドの遮蔽呼び出しだけの切り分け。光源に当たる範囲でだけ判定する分岐は残る。

```sh
FRAME_COST_VARIANTS=warmup,product,cut-canopy,product FRAME_COST_REPEAT=3 bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts --grep 'frame cost' --reporter=list,json > /private/tmp/water-reflection-ablation.json
python3 scripts/summarize_frame_cost.py --out <summary.json> --light-costs /private/tmp/water-reflection-ablation.json
```
