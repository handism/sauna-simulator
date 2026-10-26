# 春・秋の屋外プローブの焼き直し（2026-10-26、採用）

改善候補の4番目。冬だけ配信していた季節別の屋外プローブ（中庭・外周の2グリッド、`seasonalProbes.ts`）を春・秋にも焼き直して配信した。これまで春・秋は `models/seasons/` の取得に失敗し、夏のプローブに実測のRGB比（`seasonalLight.ts`）を掛ける近似のままだった。アプリ側の変更はない。

## 焼き直し

- 入力は冬と同じ `SUI_Retreat.blend`（SHA-256 `d7969b95…`）、`bake_seasonal_probes.py`（`4f076f66…`）。冬の焼き直し（`969952c`）以降、焼き込みのスクリプトと夏の配信物は変わっていない。
- `bake_irradiance_probes.py -- --season <spring|autumn> --grids courtyard,outer --out blender/diagnostics/season-<季節>-<種類> [--reflection]` を、春と秋の2プロセス並行で実行した（Blender 4.5.11、Metal）。各季節の照度約55分・反射約65分で、両季節とも約2時間で終わった。
- `split_seasonal_probes.py` で2グリッドだけを `public/models/seasons/{spring,autumn}-{irradiance,reflection}.{json,bin}`（各670,518 bytes）に切り出し、レポートを `../spring-bake.json`・`../autumn-bake.json` に保存した。
- 形状内の判定（invalid）は中庭295・外周303で夏と同じ（冬は落葉で212・164）。春・秋の近似は葉色と秋の地表だけで、落葉はしない。中庭の上向きの平均照度は、昼夕夜とも夏との差が各色0〜3%。

## 確認

Chrome、標準・DPR1・1280×800・動作抑制・固定解像度。`season-probes.visual.ts`（`SEASON_PROBES_SEASONS=spring,autumn`）で、同じビルドの季節ファイルを遮断した対照（比の補正だけ）とABBA（gains1→baked1→baked2→gains2）、3ステージ×春秋×昼夕夜の18視点。`summarize_season_probes.py` の結果は `values.json`。

- 再撮影差は全視点で0（両方式とも）。各季節の4ファイルを1回ずつ取得し、`data-season-probes` が季節になった。
- 比の補正→焼き直しの差は小さい。ΔE76の平均は0.10〜0.43、3段階を超えて変わった画素は、秋の昼で1.0〜3.2%、春の昼で0.3〜0.8%、夕夜で0.35%以下。平均L*の変化は±0.08以内。比較画像（`compare.png`、ローカル）を並べても違いは目で見分けにくい。
- 単体テスト489件と、`season.e2e.ts`・`garden-details.e2e.ts` の9件が成功。

## 判断

見た目の差は小さいが、春・秋の屋外のプローブの方向性・遮蔽が冬と同じく季節の元シーンから焼いたものになり、近似の質が四季でそろう。取得の失敗もなくなる。入室時の読み込み量は変わらず、春・秋を選んだときだけ約1.3MBずつ取得する。

## 範囲

入室視点の静止画だけで、全周・見回し中・高画質・雨雪・実機は見ていない。描画の処理は変わらない（テクスチャの中身だけが変わる）ため、費用は測っていない。室内・水中のグリッドは引き続き比の補正。元シーンの季節近似で、ブラウザの庭（草花・落ち葉・葉カードの分割）は再現していない。
