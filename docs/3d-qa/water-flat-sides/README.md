# 元blendの水の側面・底のフラット化（2026-09-26）

[前回の切り分け](../water-gloss-mismatch/README.md)で、元blendの水 `V4 rippled spring water volume` の側面・底がスムーズな1枚の帯で角の法線が約45°傾き、Cyclesがその法線で屈折・全反射していることが分かった。判断は「**元blendを直す**」。本記録はその修正と、修正後の元シーンが過去の幾何法線の追跡と一致することの確認、下流（プローブ・基準画像）の更新。

## 修正

- `scripts/flatten_water_sides.py` で、上面の格子（14,520面）以外の側面484面・底1面をフラットにし、**上面と側面の境界484辺をシャープ**にした。上面はスムーズのまま。
- 修正前の元blendは `blender/scene/SUI_Retreat_v11.blend`（`edf3c35b…`）に保存。修正後は `SUI_Retreat.blend`（`f1ee4ddd…`）。形状・材質・光源は変更なし（[flatten-report.json](flatten-report.json)）。
- 角の法線と面の法線の差の最大値：側面・底 54.8°→0°、縁の上面 54.8°→7.2°（内側の上面の波は最大8.0°）。

### 境界辺をシャープにする理由

面のフラット指定だけでは不十分だった。最初の修正（境界辺なし）では、Blenderの `corner_normals` は縁の上面を7°に直していたが、**Cyclesは上面の縁を45°傾いたまま描いた**。Cyclesはフラット指定の面を直接扱い、隣のスムーズな面を頂点法線（フラットな側面も平均したもの）で陰影付けするため。真上から法線パスを描くと、境界辺なしでは全面スムーズの場合と完全に同じ（縁の傾き最大44.9°）、境界辺ありでは最大9.6°（波そのもの）になった。境界辺なしの修正では、19点の光沢パスが全面フラットの中央値0.78倍（最小0.54倍）で、幾何の追跡（差1%未満）では説明できなかった。

## 光沢パスの確認（19点・カメラ03・静止）

`diagnose_water_gloss_mismatch.py` を修正後のblendで、元のまま（`base`）・全面フラット・全面スムーズ（V11と同じ）・側面と底・側面だけ・底だけの6条件で描いた（1024サンプル×25画素、seed 17/83、約1.6分）。面ごとの条件も境界辺をシャープにする。

- **修正後のCyclesの鏡面は、V11で全面フラットにした場合と一致**：昼 中央値0.998倍（0.951〜1.015）、夕 1.001倍（0.905〜1.023）。前回の追跡（幾何法線）の予測と一致した点11・8も、修正後のままで171・130（前回の予測167・111）。
- 全面スムーズの条件はV11の元の値を再現（差0.1%以内）。
- 側面だけフラットでも修正後と同じ（底の辺がすべてシャープになり、底の角の法線も面と同じになるため）。底だけフラットでは点9が半分になる（側面のスムーズが残る）。
- V11（全面スムーズ）との比は昼 中央値1.03倍（0.67〜7.75）、夕 1.04倍（0.55〜5.87）。側面全反射の点で大きく変わる。
- 2seedの差は中央値5.6%／4.8%（最大41%／33%、値の小さい点）。

| 点 | 群 | 昼 V11 | 昼 V11全面フラット | **昼 修正後** | 夕 V11 | 夕 V11全面フラット | **夕 修正後** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 底／青銅 | 36.7 | 37.6 | 36.9 | 7.8 | 6.3 | 6.3 |
| 4 | 底／タイル | 113.1 | 90.9 | 90.7 | 31.2 | 22.2 | 22.6 |
| 8 | 側面全反射／青銅 | 29.5 | 131.2 | 129.7 | 7.9 | 25.0 | 24.8 |
| 9 | 側面全反射／タイル | 42.4 | 53.5 | 53.3 | 11.5 | 12.4 | 12.1 |
| 11 | 側面全反射／タイル | 22.1 | 171.0 | 171.0 | 5.9 | 34.6 | 34.6 |

（鏡面 = GlossCol×(GlossDir+GlossInd)、RGB合計×1000、2seed平均。全19点は [summary.json](summary.json)。）

判断：前回までの幾何法線による水の追跡の診断（経路分類・到達先・水から出た鏡面・箱の中の1経路・遮蔽）は、**修正後の元シーンについてそのまま有効**。Cyclesで描いた過去の値（放射輝度の真値・全周参照）はV11のもので、側面全反射の点では修正後と異なる。

## 下流の更新

- **照度・反射プローブ**：`bake_irradiance_probes.py --grids water`（各約80秒）で水中グリッドだけを焼き直し、他のグリッドはV11の配信ファイルからバイト単位で引き継いだ（`blend_lineage.py` の親子を確認、レポートの `copied_grids.input_sha256` に記録）。水中グリッドのDC成分は昼 中央値−5%（log2 −0.079、平均|log2| 0.128）、夕 −11%（−0.172、0.196）。V11のblendで同じグリッドを焼き直すと配信値との差は平均|log2|0.0001未満で、変化は乱数ではない。
- **基準画像**：元の7枚（`blender/renders/01〜07.png`、V11の `render_v11.py`）とブルーアワー参照5枚を描き直した。V11の画像は `blender/renders/v11/` と `blender/renders/web-bluehour/v11/`（Git管理外）。8bitで最大チャンネルが8段より大きく変わった画素：03 6.6%（夕 5.4%）、02 0.17%（夕 0.12%、ベンチの照明の縁の細い線。原因未確認）、それ以外は0.03%以下。差分図は [diff-final-03.png](diff-final-03.png)・[diff-bluehour-03.png](diff-bluehour-03.png)・[diff-final-02.png](diff-final-02.png)・[diff-bluehour-02.png](diff-bluehour-02.png)。
- **Cyclesカメラのfixture**（`e2e/fixtures/cycles-cameras.json`）は入力ハッシュだけが変わった。

### 03の見た目

[compare-03.jpg](compare-03.jpg)（上がV11、下が修正後）。V11の奥・左の**暗い鏡のような帯と、手前の明るい帯は、スムーズな側面が作っていたもの**で、修正後は消えた。水は透明で、奥・左の側面は全反射でタイルを映す明るい面として見える。

### ブラウザとの比較

修正後のブラウザ撮影（`test:browser:visual`、プローブ更新後）と比べると、全画面のCIELAB統計はほぼ不変（元の7枚の平均|dL*| 1.29→1.36、夕暮れ6視点 0.94→0.99）。水面の範囲（修正でL*が2より大きく変わった画素、03で7.5%）に限ると：

| | Cycles V11 | Cycles 修正後 | ブラウザ | ΔE76平均（対V11→対修正後） |
| --- | --- | --- | --- | --- |
| 03 昼 L* | 35.9 | 41.9 | 38.1 | 7.8→9.4 |
| bh-03 夕 L* | 17.8 | 22.5 | 16.4 | 6.6→8.8 |

ブラウザの水面は、V11の暗い帯と平均でたまたま近かった。修正後のCyclesより暗く（特に夕暮れ）、奥・左の側面にはタイルの全反射ではなく玄武岩の内壁が暗く見える。これは[箱の中の1経路](../water-exit-sampling/README.md)で試作する予定だった側面の全反射に当たる。

## 限界

- 光沢の確認は19点・カメラ03・静止した形状だけ。水中の全到達点・動く波・他のカメラの水面は描いていない。
- 過去のCyclesの放射輝度（`water-capture-radiance` の真値・全周参照、`water-radiance`）はV11のまま。側面全反射の点の真値は修正後と異なる。
- 02のベンチの照明の縁の差は未調査（水が映る経路かGPUの非決定性）。

## 再実行

```sh
cp -p blender/scene/SUI_Retreat.blend blender/scene/SUI_Retreat_v11.blend   # 修正前（V11）を残す
Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/flatten_water_sides.py -- --report docs/3d-qa/water-flat-sides/flatten-report.json
Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/diagnose_water_gloss_mismatch.py -- --out blender/diagnostics/water-flat-sides-v2/gloss --samples 1024 --variants base,flat,smooth,walls,sides,bottom
Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py -- --grids water
Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py -- --grids water --reflection
(cd blender && Blender -b scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/render_v11.py)   # 先に renders/0?.png を renders/v11/ へ複製
Blender -b blender/scene/SUI_Retreat.blend -S "SUI • Blue hour" --python-exit-code 1 --python scripts/blender_bluehour_reference.py
Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/blender_camera_reference.py
python3 scripts/summarize_water_flat_sides.py blender/diagnostics/water-gloss-mismatch blender/diagnostics/water-flat-sides-v2/gloss --out docs/3d-qa/water-flat-sides --renders blender/renders --before-renders blender/renders/v11 --bluehour blender/renders/web-bluehour --before-bluehour blender/renders/web-bluehour/v11
python3 -m unittest discover -s scripts -p 'test_*.py'
```

`flatten_water_sides.py` は元blendを保存する（`--dry-run` で検査のみ）。V11の光沢診断（`blender/diagnostics/water-gloss-mismatch`）は前回の出力。
