# ストーブ・桶・柄杓の形状と材質

2026-10-19。黒い鉄のストーブ、落ち着いた木桶・木製柄杓へ改善する承認範囲。

## 実装

- `scripts/refine_loyly_props.py` を `export_web_glb.py` の材質変換前に呼ぶ。元blendを保存せず、名前と位置を検査した既存76部品を置き換える。元のストーブ中心 `(-1.25, 1.28)` と桶中心 `(-2.1, 1.74)`（Blender XY、m）は維持する。
- ストーブは24本の面取りした縦部材、上下・中間の帯、下部の遮熱胴と脚。上部は開いた石かごで、42個の石を4層にずらして配置。石は固定乱数1927で大小・角度・輪郭を変え、木・石の既存画像を再利用する。
- 桶は18枚の先広がりの板、厚みのある縁・内壁・底と2本の鉄帯。橙色を抑えた木目と板ごとの既存の色むらを使う。水面は縁から約10cm下がった1枚の半透明面（alpha .38、roughness .12）で底を見せる。反射は既存の低周波プローブによる柔らかな光沢。屈折や水のシミュレーションではない。
- 柄杓は内外のある楕円の匙と、握りに向かって太さの変わる柄。桶の縁に預けた配置。回転体の極の重複頂点を結合してから書き出す。
- 新しい5材質だけを追加し、材質ごとに結合。新部品の面取り2分割と決めた形状は汎用Decimateから除外する。既存のプローブ・反射・影・材質準備・解放処理を使い、描画側のTS/シェーダーは変更しない。
- 小物の形状が変わるため、既存プローブに含まれる元形状の遮蔽・間接反射は近似として残る。2D画像・庭・カメラ・蒸気と音源の座標は変更しない。

## 生成物の確認

`export-scope.json`：本体 2,390,472 → 2,501,888 bytes（+111,416 bytes）、107,552 → 115,618三角形（+8,066）。庭GLBとシーン定義はバイト一致。既存3共有材質（木・石・黒金属）以外の69材質グループは、Meshopt復号後の属性・インデックス・ノード変換が一致。埋め込み画像も一致。3共有材質の全頂点一致を主張する検査ではない。

書き出し処理は入力blendの前後SHA-256一致を要求する。書き出し元と対象部品一覧は `docs/3d-export/export-report.json`、圧縮誤差は `compression-report.json`。

## 静止画

`comparison.json` と `comparison.jpg`：Chrome、標準画質、DPR1、固定解像度、夏・晴れ、動作抑制。着座1280×800・近接1280×800・縦390×844・横844×390 × 昼夕夜を変更前→後→後→前で48枚撮影。各撮影前70 rAF整定、UIを除いた景色を比較。12条件すべてで同方式の再撮影差は0画素、page/console errorなし。

原寸の近接昼夜・着座昼と比較一覧で、石の積み重なり、金属の帯と縦部材、桶の内側・水面、柄杓のくぼみを確認。画像はローカルのみ（Git管理外）。連続動作・実機・実Safari・全画質/季節/天気の評価ではない。

## 負荷の診断

`cost.json`：Chrome 155.0.8059.80、標準・DPR1・1200×800固定解像度・動作抑制。予備実行後、3ステージ×昼夜を変更前→後→後→前で比較。描画を発行したrAF間隔の平均を4回の反復描画数で割った値であり、純GPU時間・実機FPSではない。

| 視点 | 昼の後/前 | 夜の後/前 |
| --- | ---: | ---: |
| サウナ | 0.998 | 0.989 |
| 水風呂 | 1.000 | 1.000 |
| 外気浴 | 0.996 | 1.002 |

この条件では大きな増加を検出しなかった。小さな差を速度改善やゼロコストの証明にはしない。主描画の呼び出し数はサウナ+6、水風呂+2、外気浴±0。従来は大きな共有メッシュに混ざっていた小物が独立したことで、画面外ではカリングされる（外気浴の送信三角形数は減る）。静止画像の撮影と計測は分けて実行した。

## 回帰確認

`regression.json`：14件成功、失敗・再試行・スキップ0。ロウリュ時の描画、全速描画指定、5回の2D/3D切替と3ステージ一巡、実コンテキスト喪失後の2D継続・再試行、読み込み中の2D切替、実時間30秒の期限、壊れたGLB、庭の通信失敗、非HDR相当の低/標準/高画質、初回/準備後×通常/分割準備のシェーダー失敗後の復帰を確認。

型検査、436単体テスト、Lint、整形、ビルド、差分チェック、Python構文確認は成功。2D入口JS 230.92kB・遅延3Dチャンク890.14kBは不変。3Dの850kB警告は従来どおり残る。通常ブラウザ回帰の全件や実機/Safari、実聴、連続見回しの評価ではない。

`survey/survey.json`：配信モデルで3ステージ×昼夕夜×8方位×3俯仰の216枚を撮影し、同一canvasで一巡・page/console errorなし。縮小全体一覧とサウナ夜一覧を目視した範囲に大きな欠け・黒抜けは見つからなかった。全216原寸の精査や連続見回しの合格ではない。

## 再実行

変更前GLBを `BEFORE` として別途確保する（生成前なら現行 `public/models/sauna.glb` をコピー）。変更後は通常のエクスポートを比較先へ出す。

```sh
SUI_WEB_EXPORT_DIR=/private/tmp/loyly-props-candidate \
  /Applications/Blender.app/Contents/MacOS/Blender \
  -b blender/scene/SUI_Retreat.blend --python-exit-code 1 \
  --python scripts/export_web_glb.py

node scripts/check_loyly_export.mjs "$BEFORE" \
  /private/tmp/loyly-props-candidate/sauna.glb docs/3d-qa/loyly-props/export-scope.json

QA_LOYLY_BASELINE="$BEFORE" QA_LOYLY_CANDIDATE=/private/tmp/loyly-props-candidate/sauna.glb \
  bun run test:browser:visual e2e/loyly-props.visual.ts --reporter=json > /tmp/loyly-comparison.json
python3 scripts/summarize_loyly_props.py visual /tmp/loyly-comparison.json \
  test-results/visual docs/3d-qa/loyly-props

QA_LOYLY_BASELINE="$BEFORE" QA_LOYLY_CANDIDATE=/private/tmp/loyly-props-candidate/sauna.glb \
  bun run test:browser:gpu e2e/loyly-props.gpu.ts --reporter=json > /tmp/loyly-cost.json
python3 scripts/summarize_loyly_props.py cost /tmp/loyly-cost.json docs/3d-qa/loyly-props

bun run test:browser:visual e2e/scene-survey.visual.ts --reporter=json > /tmp/loyly-survey.json
python3 scripts/summarize_visual_survey.py /tmp/loyly-survey.json docs/3d-qa/loyly-props/survey
```

比較用環境変数を省略した `loyly-props.visual.ts` は配信モデルの12条件だけ撮影する。GPU検証は候補パスが必須で、他のブラウザ撮影やBlenderと同時に実行しない。
