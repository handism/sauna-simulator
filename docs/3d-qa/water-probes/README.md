# 水風呂の水中プローブ（2026-09-25）

水風呂の底・水中の内壁が明るすぎた原因と対策の記録。

- `tub-points.json`：水形状の内面（底30点・4側面×3深さ・水中にある中庭プローブ12点、glTF軸）。
- `surface-sampling.json`：`bake_irradiance_probes.py --surface-samples tub-points.json --out <dir>` の結果（昼夕×2cm／5cm、340秒）。`grid_half_spacing_rgb` は変更前の中庭グリッドの値。変更後の値は `scripts/probe_sampling.py` の `ProbeSampler.sample()` で再計算できる。
- `comparison.jpg`：上段はCycles 03・変更前・変更後の水風呂、下段は全周撮影の水風呂ステージ見下ろし（昼夕・変更前後）。
- `cycles/`（同視点7組）、全周一覧6枚、`survey.json`、`tone-stats.txt`、`validation.json`。

再実行：`bun run test:browser:visual --reporter=json > <json>`、`python3 scripts/summarize_cycles_compare.py <json> docs/3d-qa/water-probes/cycles`、`python3 scripts/summarize_visual_survey.py <json> docs/3d-qa/water-probes`、`python3 scripts/cycles_tone_stats.py`。
