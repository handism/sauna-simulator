# 空を含めた反射プローブの焼き直し（2026-09-28）

元blendのWorldに光沢レイから見える空（`scripts/build_sky_world.py`、v13）を入れたため、反射プローブ（`public/models/reflection.bin`・`reflection.json`）を `bake_irradiance_probes.py --reflection` で焼き直した。空のゲートは空1・日光の円盤0（円盤は光沢に不可視）。照度プローブは空を入れたコミット（764cfab）で焼き直し済み。**結論：採用。**

## 焼き込み

- 入力blendのSHA-256 `f8fa0a97…`（焼き込み前後・Cycles参照の描画後とも不変）。4グリッド×昼夕をすべて焼き直した（以前の室内・中庭・外周の複製 `copied_grids` はなくなった）。所要約6,330秒。
- 上向きの反射放射輝度の平均（RGB）は大きく上がった。昼の中庭 (0.28, 0.36, 0.42)→(1.34, 1.48, 2.10)、外周 (0.21, 0.30, 0.36)→(1.39, 1.57, 2.34)、夕暮れの中庭 (0.13, 0.17, 0.25)→(0.33, 0.42, 0.91)。空は中庭の照度に合うよう明るくしてあり、以前の光沢レイは暗い単色の背景だけを見ていたため。全値は `docs/3d-export/reflection-report.json`。

## Cycles参照との比較

以前のCycles参照（`blender/renders/01〜07.png`・`web-bluehour/`）はv12（空なし）なので、v13で同じカメラを描き直した（50%解像度・128サンプル・デノイズ、`blender/renders/v13-sky/`、ローカルのみ）。v13のCyclesでも芝・葉・ガラスが空を映して明るく青灰色に寄り、ブラウザの焼き直し後と同じ向きに変わる（[01](compare-01.jpg)・[07](compare-07.jpg)・[03](compare-03.jpg)・[夕暮れ07](compare-bh-07.jpg)、左からv13 Cycles／焼き直し前／焼き直し後、画像はローカルのみ）。

撮影は `e2e/cycles-compare.visual.ts`（標準画質・1280×800・DPR1）。焼き直し前はHEADのworktree。600×400のCIELABで比較（12視点の平均）：

| 参照 | 撮影 | 平均\|ΔL*\| | 画素ΔE76の平均 | 平均彩度差 |
| --- | --- | ---: | ---: | ---: |
| v13 | 焼き直し前 | 1.83 | 8.40 | +1.49 |
| v13 | **焼き直し後** | **0.98** | **7.68** | **+0.15** |
| v12（空なし） | 焼き直し前 | 5.75 | 10.75 | +1.17 |
| v12（空なし） | 焼き直し後 | 7.10 | 11.77 | −0.17 |

- v13参照に対し、画素ΔEは12視点すべてで下がるか同じ（07昼 10.1→7.4、夕暮れ07 8.5→6.9が最大）。平均L*の差は9視点で縮み、サウナ室内の02（+0.3→+1.2）・夕暮れ02（+1.1→+2.1）・夕暮れ04（+0.2→+0.8）はやや明るくなりすぎた。
- v12参照に対して悪化するのは、v12に空がないため。以後の照明比較はv13の参照を使う。視点ごとの値は [summary.json](summary.json)。

## 限界

- v13参照は50%解像度・128サンプルで、元の完成画像（2100×1400）ではない。
- 静止画の明暗統計で、見回し・全周撮影・GPU時間は測っていない（反射プローブはテクスチャの内容だけが変わり、形式・大きさ・シェーダーは同じ）。

## 再実行

```sh
# 反射プローブ（数時間）
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 \
  --python scripts/bake_irradiance_probes.py -- --reflection
bun run test:browser:visual e2e/cycles-compare.visual.ts --reporter=json > /tmp/cycles.json
```
