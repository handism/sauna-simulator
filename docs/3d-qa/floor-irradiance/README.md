# サウナ床の面上照度の診断（2026-09-24）

前回の残件「サウナ床の昼の過剰（`02-floor-dark` で1.34倍）を面上の照度で評価する」の記録。**製品の描画コード・配信データ・元blendは変更していない。** 床専用の照度マップは不採用。

## 測定

- `floor-points.json`：`scripts/sample_room_floor.py` で室内（glTF x −6.15〜−0.5、z −4.59〜−0.25）を0.25m格子のセル中心に分け、y=0.35から真下へレイを飛ばして `Sauna floor`（y=0.1、上向き）に当たった372点。東端の列（x −0.525）とベンチ脚 `Bench bearer.005` の計19点は除外。
- `surface-sampling.json`：既存の `bake_irradiance_probes.py --surface-samples` による昼夕×2cm／5cmの余弦積分と、配信グリッドの補間値（半格子オフセット／オフセット0）。Blender 4.5.11／Metal、128×64・128サンプル、1,488パノラマで1,032秒。
- `floor-summary.json`・`floor-map.png`：`scripts/summarize_floor_irradiance.py` の集計。5cmの測定を基準にしたRec.709輝度比。裏面の割合0.25以上の11点（ストーブ基部などの閉じた形状内で、表示されない床）は除外し、361点で集計。

## 結果

| 昼／夕 | グリッド／測定（総和） | 中央値 | 平均\|log2\| | P10〜P90 |
|---|---|---|---|---|
| 昼 | 1.005 | 0.980 | 0.152 | 0.88〜1.24 |
| 夕 | 0.987 | 0.990 | 0.108 | 0.89〜1.17 |

- **床全体では過剰ではない。** 総和の比は昼1.005・夕0.987。前回の `02-floor-dark`（1.34倍）は東の壁際の局所的な値で、床全体の偏りではない。2cmと5cmの差は総和で0.5%以下。
- 誤差は空間的な分布：壁際とストーブ周りは明るすぎ、開けた床はわずかに暗い（コントラストがならされている）。

| 領域（昼／夕） | 点数 | 総和の比 |
|---|---|---|
| 東の壁際 x > −1.0 | 13 | 1.215／1.088 |
| ストーブ周り（中心から0.8m以内） | 23 | 1.208／1.146 |
| その他の壁際 | 57 | 1.080／1.107 |
| 開けた床 | 268 | 0.968／0.953 |

- 一律の係数（昼0.995・夕1.013）は平均|log2|を変えない（0.152→0.154、0.108→0.107）。
- **床専用マップの候補（配信プローブと同じ0.5m間隔）** を、偶数セルの点だけから作り、残り264点で評価した。平均|log2|は昼0.135（グリッド0.143）、夕0.103（グリッド0.098）で、改善しない。誤差の原因は0.5mより細かい構造（壁際・ストーブ・ベンチ脚の陰）で、補正には0.25m以下の本格的なライトマップが必要。床1面のためにUV・テクスチャ・シェーダーの経路を増やす費用に見合わないため不採用。

## 限界

直接光（ブラウザで描く室内6灯・日光）は含まない、間接光だけの比較。床の画素が画面に占める割合、AgX後の見た目の差、ベンチ・壁など床以外の面は測っていない。点はセル中心の格子で、面積加重の画質指標ではない。

## 再実行

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/sample_room_floor.py -- --out /tmp/floor/floor-points.json
$B -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py -- --surface-samples /tmp/floor/floor-points.json --out /tmp/floor
python3 scripts/summarize_floor_irradiance.py /tmp/floor/surface-sampling.json --out /tmp/floor/summary
```

Blenderはサンドボックス外で実行する（Metalの検出で異常終了するため）。
