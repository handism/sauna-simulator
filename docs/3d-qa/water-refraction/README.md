# 水風呂の屈折と疑似コースティクス発光（2026-09-25）

- `comparison.jpg`：上段は昼（Cycles 03・変更前・変更後）、下段はブルーアワー（`blender_bluehour_reference.py` の03・変更前・変更後）。変更前は同じ手順の `0553cd3` の本番ビルド（一時worktree）で撮影。
- `cycles/`（同視点7組）、全周一覧6枚、`survey.json`、`tone-stats.txt`、`validation.json`。
- 発光の移植の基準値は `e2e/fixtures/blender-caustic.json`（`scripts/blender_caustic_reference.py`、元材質の発光強度に繋がるノードをGeometry Nodesへ複製して128点で評価。Voronoi・2つのノイズの中間値も保存）。`e2e/caustics.e2e.ts` がChromeのWebGL2で照合する。

再実行：`bun run test:browser:visual --reporter=json > <json>`、`python3 scripts/summarize_cycles_compare.py <json> docs/3d-qa/water-refraction/cycles`、`python3 scripts/summarize_visual_survey.py <json> docs/3d-qa/water-refraction`、`python3 scripts/cycles_tone_stats.py`。基準値の再生成は `Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/blender_caustic_reference.py`（元blendは保存しない）。
