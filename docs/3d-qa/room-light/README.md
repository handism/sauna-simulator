# サウナ室の床・背面壁の局所照明（2026-10-18）

夕暮れ・夜のベンチ下の床と背面の杉板に、遮蔽を含む局所的な照度を適用する。正面を向いた新しい着座位置では差はほぼなく、ベンチ側へ見回したときの背もたれの陰と光の回り込みが対象。[前後一覧](comparison.jpg) は左が既存照明、右が補正あり。画像はローカルのみ。

## 採用範囲と方式

- 床の上面 y=0.1m、x −6.025〜−0.65、z −4.48〜−2.48（44×17点）、背面壁の前面 z=−4.5125m、xは同じ、y 0.1〜2.6（44×21点）。間隔は12.5cm。
- `bake_room_irradiance.py` が既存プローブと同じ光源除外・空の扱いで間接照度を作る。64×32パノラマ、64サンプル、面の2cm上で半球の余弦積分。昼夕夜の計6層。
- `bake_room_direct.py` が室内6灯の直接照度を追加する。元の矩形／円盤に各256点、面から2mmの位置で幾何の遮蔽を判定する面積積分。6灯は昼夕夜で出力・色・親なしの位置／向き・大きさが共通で、spread πを検査する。追加2層は時間帯や季節の係数を掛けない。透明材質の透過・半影を完全に再現するレイトレーサーではなく、静的な不透明遮蔽の近似。
- `roomIrradiance.ts` が既存の64三角形（床上面・杉板前面）を属性共有で分離し、対象の2材質だけにsamplerを1個追加する。三角形は増えない。昼の重みが0になった夕夜では、6灯の既存の直接拡散光を局所直接照度へ、既存の間接光を局所間接照度へ置き換える。二重加算しない。法線・境界15cm・照明の昼→夕の重みでフェードする。後者の補間は近似で、すべての中間時刻のCycles一致を測ったものではない。
- 受光点が支柱・接合部に埋まる場合は既存照明へ戻す。間接光の半球で裏面率25%以上の点を無効にし、RGBを有効度で事前乗算する。有効度は全シーンと直接光で一致を検査する。各シーン173点が無効。境界・無効点以外では粗いSHの取得と6灯の形状係数計算を省略する。
- 配信はRGBA16F・8層の59,136 bytesと821 bytesのヘッダー。詳細な焼き込み記録は配信せず [bake.json](bake.json) に置く。既存GLB・照度／反射プローブ・元blend・2Dは変更しない。追加取得は既存の中止・期限・失敗処理に従い、解放処理と遅延完了の回帰テストを追加した。

## 判断と照度の測定

初候補は間接光だけを置き換えたが、背面のCycles局所色差は昼10.25→10.60、夕12.80→13.52、夜13.56→14.29で悪化した（[記録](indirect-candidate/reference-check.json)）。数値の照度改善だけで製品の画質改善とは判断しなかった。

直接光の遮蔽も含めた候補は夕夜で改善したが、昼は10.26→10.51と小さな悪化が残った。そこで製品では昼の補正を無効にした。一般に昼の照明が正しいと結論したものではなく、この変更での悪化を避ける採用範囲である。

独立した8位置×3時間帯を面から2cm／5cmで測定した。背もたれの内部になる1位置（各時間帯の両距離）を裏面率で除外。残る7位置×3時間帯では間接照度のRGB絶対差平均が2cmで0.02339→0.00656、5cmで0.01925→0.00649となり、各21条件で小さくなった。これは焼き込みの間接成分だけの点測定で、製品で無効にした昼も含む。直接光の全面的な正確さや画質向上率ではない。[測定と除外点](holdout-check.json)。

## 最終版の静止画

Chrome 155.0.8059.80、標準・DPR1・1280×800・動作抑制・夏・晴れ。同じ最終ビルドで補正の材質定義だけを外す対照→補正あり→補正あり→対照。三角形の分離とデータ取得は共通。着座正面・着座背面・Cycles 02の位置／垂直FOVで各昼夕夜、4件・36枚。[記録](comparison.json)。

- 同じ版の再撮影差は9条件とも0画素。昼の前後差は正面0、背面1、比較位置5画素。大きな昼の照明変更はない。
- 夕夜は主に背面壁・ベンチ下が変わる。正面は397〜401画素のみで、初期画面全体を明るくする変更ではない。
- 背面の独立Cycles参照（640×400、128サンプル・デノイズ）と、ブラウザを2×BOX縮小して比較。前後差がRGB1階調を超える局所の平均ΔE76は夕11.20→9.81、夜11.68→10.07（約12〜14%減）。昼の縮小後の変更画素は0。材質・形状の省略など他の差も残るので、全画面の画質向上率ではない。[入力と画像ハッシュ](reference-check.json)。
- 前後の一覧と背面／室内比較位置の原寸を確認。ベンチ下・背もたれの陰が強まり、確認範囲に大きな黒抜け・白飛び・補正範囲の硬い境界は見つからなかった。
- 別途、3ステージ×昼夕夜×8方向×3俯角の216枚とCycles比較用18枚を撮影。全周一覧で大きな欠けを確認する検査で、全原寸の画質合格ではない。Cycles全体の色調集計は `test-results/room-light/cycles-tone.txt`。古い参照には今回以外の庭・材質差があるため、全体値を局所補正の合否には使わない。

## 再実行

元blendを保存しない。中間データを配信先へ直接書かない。

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py -- --room-surface --out /tmp/room-indirect
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_room_direct.py -- /tmp/room-indirect /tmp/room-combined
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/blender_room_light_reference.py -- /tmp/room-references
```

`room-combined/room-irradiance.bin` が配信バイナリ。詳細JSONは `bake.json` として保存し、配信用ヘッダーは version・width・height・scenes・surfaces・input_sha256・bin_sha256 だけを同じ値で抜き出す。非アクティブで非表示のシーンの `matrix_world` は未評価でゼロになることがあるため、親なしの光源を location・rotation_euler・scale で照合する。

```sh
bun run build
bunx playwright test --config playwright.visual.config.ts e2e/room-light.visual.ts --output test-results/room-light/captures --reporter=json > test-results/room-light/capture.json
python3 scripts/summarize_room_light.py test-results/room-light/capture.json test-results/room-light/captures docs/3d-qa/room-light
python3 scripts/compare_room_reference.py test-results/room-light/captures /tmp/room-references docs/3d-qa/room-light/reference-check.json
```

## 制限

補正は夕夜の静的な床と背面壁だけ。ベンチ座面・左壁・天井の全面的なライトマップではない。直接光のサンプル数による収束、全中間時刻、全画質／全季節天気の全周、連続した見回し、実Safari・モバイル実機・GPU単体時間・実機FPS・音の実聴は未確認。GLB／プローブの変更や2Dの画質変更は含まない。

## 負荷と回帰

変更前HEAD `07932a0` の隔離コピーと最終版を、前→後→後→前で測定。各版の最初は予備実行を別テストにし、全6件成功。Chrome 155、標準・DPR1・1280×800・固定解像度・動作抑制・ミュート、1コールバックで描画を3回反復。着座正面／背面の昼夜、描いたフレーム間隔の平均÷3を比較した。[数値](cost.json)。

- 後／前の2組の比は正面昼1.004〜1.013、正面夜0.984〜1.025、背面昼夜は約1.000。今回の条件で大きな増加は検出しなかった。背面は約5.56ms（表示間隔÷3）の下限にあり、細かい差やゼロコストの証明ではない。アプリFPS・純GPU時間・実機性能の測定ではない。
- 元の三角形の分離なので形状は増えていない。今回の4視点で記録された描画数は各+2、描画三角形数は同じ。ほかの視点やパスの値を保証するものではない。追加samplerは対象2材質だけで、追加の影パスはない。
- 型検査、429単体テスト、Lint、整形、ビルド、差分チェックを実施。前後撮影4件、全周／Cycles撮影2件、庭／季節・HDRのモード／ステージ／実コンテキスト喪失後復帰・非HDR3画質の描画／復帰13件が成功。ブラウザ回帰の全件ではない。[成功報告の要約](browser-validation.json)。
- 3Dチャンク873.05→880.53kB、既存850kB警告は継続。2D入口は230.92kBで同じ。配信照度データ約60KBを追加する。実Safari・実機・全画質や他DPRの負荷・連続見回しは未検証。

負荷は変更前／後の各チェックアウトで `ROOM_COST_VARIANTS=warmup,product bunx playwright test --config playwright.gpu.config.ts e2e/room-light.gpu.ts --reporter=json` を実行し、2回目は `ROOM_COST_VARIANTS=product` とする。同じテストファイルを変更前コピーにも置く。4実行のJSONを `summarize_room_cost.py <前1> <後1> <後2> <前2> <出力.json>` へ渡す。
