# 水面の平面反射と元の波（2026-09-25）

- `comparison.jpg`：上段は昼（Cycles 03・変更前・変更後）、下段はブルーアワー（`blender_bluehour_reference.py` の03・変更前・変更後）。変更前は `docs/3d-qa/water-refraction/comparison.jpg` の変更後の列（`5974436`、同じ撮影手順）。
- `cycles/`（同視点7組）、`tone-stats.txt`、`frame-times.json`（変更前後のフレーム間隔）。
- `cycles-03-passes.jpg`：Cycles 03（昼、25%・192サンプル）の合成・光沢（反射）・透過（屈折）・光沢×6。水風呂の手前・左・奥の暗い帯は透過側にあり、反射ではない。
- `cycles-03-refraction-paths.jpg`：同じカメラの水面の画素から、元の波打つ水面で屈折させたレイの行き先（青：タイル、緑：水形状の底面を抜けてタイル、赤：水形状の側面で全反射、黄：側面から壁との隙間へ抜ける）。奥と左の暗い帯は水形状の側面での全反射と隙間。
- 初回は全周撮影が時間切れになったが、2026-09-25の再検証で144視点を51.9秒で撮影できた。`survey/` に全周一覧6枚とモデルハッシュ付き計測JSONを保存。`capture-stability.json` は同一ページ内のPNG一致と再読み込み間の差分を記録する。

再実行：波の係数は `Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/fit_water_waves.py -- <heights.npz>` の後に `python3 scripts/fit_water_waves.py <heights.npz>`。比較は `bun run test:browser:visual --reporter=json > <json>`、`python3 scripts/summarize_cycles_compare.py <json> docs/3d-qa/water-mirror/cycles`、`python3 scripts/cycles_tone_stats.py`。パス分解・レイの分類・フレーム間隔の計測は一時スクリプトで行い、リポジトリには含めていない。


再検証（2026-09-25、製品コード `7147ccc`）：`revalidation.json` に今回の検査結果、`stability-samples.json` に305.4秒・7巡・35計測の継続検証を保存。継続検証は `bun run test:browser:soak --reporter=json > <soak-json>` で再実行でき、`stability-samples` 添付JSONに全サンプルが入る。3画質それぞれのリソース数は繰り返し間で一致し、ページエラーは0。GPU総メモリ・音声ノード・モバイル実機は対象外。画像の目視所見と残件は `docs/3d-sauna-progress.md` の再検証節を参照。
