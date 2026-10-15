# デッキ外縁の光だまり（2026-10-15）

夕暮れ・夜に欠けていた、手前の飛び石の光だまりを復元する。[前後画像](comparison.jpg) は上が照度置換なし、下があり。左が夕暮れ、右が夜。画像はローカルのみ。

## 原因と方式

`V10 concealed deck edge -3.7/0/4.4` は各12W・直径0.65mの面光源。中心の高さ−0.04mは飛び石上面0.065mより低いが、円盤の上側から上面へ光が届く。中心の点光源ではこの経路を再現できず、粗い1m格子の照度プローブでは光だまりがぼける。[評価済み位置と受光面](receivers.json)。

新しい影付き光源を増やす代わりに、上面から2cm上の89×9点（x −5.5〜5.5、z 3.65〜4.55）で、夕暮れ・夜の照度を焼く。64×32パノラマ・128サンプル、既存プローブと同じ直接光の除外と空の扱いで、半球の余弦積分を取る。追加データはRGBA16Fの2層・12,816 bytesとJSON。

描画時は元の石材の上面12三角形を属性共有で分離し、同じ点の既存プローブの夕夜成分を差し引いて局所照度へ置き換える。昼夕の中間では昼成分を維持する。材質名と既存の材質拡張を維持し、石材の色・凹凸・雨・雪と既存の直接光は従来どおり。範囲・高さ・法線で制限し、境界はフェードする。水中も含む元の石材全体にsamplerを追加しない。

元blend・GLB・既存の照度／反射プローブは変更していない。追加テクスチャは既存のロード中止・失敗・解放に従い、不正なデータでは2Dに戻る。

## 静止画の確認

Chrome 155.0.8059.79、標準・DPR1・1200×800、動作抑制。サウナ・水風呂の既定視点と外気浴のCycles 07視点、各昼夕夜。照度置換なし→あり→あり→なし、各9枚、4件成功・計36枚。対照では検証ブラウザ内の材質定義だけを外し、三角形の分離・データ取得は共通にした。

- 各条件の再撮影差はすべて0画素。
- この9視点では昼3枚・水風呂3枚は前後で全画素一致。夕夜のサウナ・外気浴では飛び石の光だまりが変わった。
- 元Cyclesの07参照へブラウザ画像を縮小し、前後差が8階調を超える領域だけを見ると、平均ΔE76は夕暮れ31.10→8.92、夜37.93→9.58。全体の画質向上率ではない。参照は庭・天気の追加前で、照明以外の一致を保証しない。
- ページ／コンソールエラーなし。入力・画像ハッシュ、再撮影差、局所色差は [comparison.json](comparison.json)。

## 再実行

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py -- --deck-surface --out test-results/deck-light/bake
bun run test:browser:visual e2e/deck-light.visual.ts --reporter=json > test-results/deck-light/visual.json
cp -R test-results/visual test-results/deck-light/captures
python3 scripts/summarize_deck_light.py test-results/deck-light/visual.json test-results/deck-light/captures docs/3d-qa/deck-light
```

## 制限

焼き込みは飛び石上面と元blendの静的な遮蔽に限る。後から追加した草花による遮蔽、石の側面、地面全体の照明、高精度の鏡面反射は追加していない。平面上の照度を補間する近似で、全面的なプローブ更新ではない。実Safari・実機・高画質負荷・連続見回しは未確認。

## 描画負荷

変更前 `58c017f5ff73784fe4e944b2477b99fea33de70f` の独立ビルドと変更後を、前→後→後→前で計測。各版の初回はwarmupを除外。Chrome 155.0.8059.79・標準・DPR1・1200×800・固定解像度、3ステージ既定視点×昼夕夜。`FRAME_COST_REPEAT=3` で、描画のあるフレーム間隔の平均÷3を比較した。[集計](cost.json)。

- 全4実行が成功（warmup・overdrawを含め10件）。製品の比較は各版2回。
- 9視点の変更後÷前の2組の中央値は1.006〜1.022倍。外気浴の夕暮れ・夜は1.011／1.006倍。数％の差は実行時のばらつきを含み、GPU単体時間・実機FPSではない。
- 主描画の `drawCalls` は各視点+1。三角形数は不変（影・深度など別パスの総呼び出し数ではない）。samplerは対象上面の材質にだけ1個増える。
- 遅延3Dチャンクは851.34→856.28kB。850kBの既存警告は継続し、上限は変更しない。2D入口は229.03kBのまま。

各版で `FRAME_COST_VARIANTS=warmup,product FRAME_COST_REPEAT=3 bun run test:browser:gpu e2e/frame-cost.gpu.ts --reporter=json`、2回目は `FRAME_COST_VARIANTS=product`。結果を `summarize_frame_cost.py --runs deck before=<前1>,<前2> after=<後1>,<後2> --out <json>` で集計する。

## 回帰検証

型検査・389単体テスト・Lint・整形・本番ビルド・差分チェック成功。季節とライフサイクルのブラウザ回帰13件（246秒）、非HDRを模擬した3画質の描画・コンテキスト喪失・2D継続と再試行3件（63秒）が成功。通常ブラウザ回帰全件は実施していない。入力・成功報告・元blend不変の確認は [validation.json](validation.json)。
