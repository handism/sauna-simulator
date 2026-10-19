# サウナ室内の昼照明と座面側面／裏面・溝・ガラス際の陰影補正（2026-10-19）

室内照明改善（昼の室内照明、ベンチ側面・裏面・蹴込み、板溝、ガラス際）の要望に基づき、既存の床・背面壁・ベンチ上面・左杉壁・天井下面の補正に続けて、受光範囲を座面側面・面取り・裏面・蹴込み（遮光リップ/角材）・背もたれ・床全域へ拡張し、昼の直接光補正およびスリット/裏面の陰影を局所補正した。[前後一覧](comparison.jpg) は左が従来の室内照明（v2対照）、右が補正あり。画像はローカルのみ。

## 方式と範囲

- 既存6灯は部屋全体で平均した遮蔽率を使っていた。新しい受光面では元blendの灯りの形・位置・向き・出力を使い、各面光源1024点の面積積分と静的な不透明形状の遮蔽に置き換える。灯りは加算せず、対象部分の6灯の既存直接拡散光を有効度分だけ減らす。太陽や他の光源、反射は変更しない。
- 昼の室内照明（6灯）を有効化。ベンチ座面の平坦上面はフラットな直接光で置き換え、面取りやスリット垂直面は方向性のある `suiRectFormFactor` と隙間の暖色散乱光（0.18）、裏面は上方光の遮蔽（0.65）を適用。前列鼻先は隙間散乱から除外。
- 背面壁のスリット位置（y=1.455〜1.535m）およびベイク上限（y=2.6m）のフェードにより、板溝の不自然な発光や天井際への漏れ・境界跳びを解消。
- `roomIrradiance.ts` は対象木材から属性共有で受光面（2,928三角形、計3材質）を分離する。GLB・既存プローブ・元blend・2D経路は変更しない。

## 静止画の確認

Chrome 155.0.8059.80、標準・DPR1・1280×800・固定解像度・動作抑制・夏・晴れ・ミュート。同一最終ビルドで新しい4面の定義 `SUI_ROOM_EXTENSION` だけを外した対照→補正あり→補正あり→対照で、着座正面・ベンチ・左壁・天井×昼夕夜を撮影した。[記録](comparison.json)。

- 4件・48 PNGが成功。同じ版の再撮影差は天井の補正ありで3画素、その他11条件は0画素。
- 独立Cycles参照（bench, left, ceiling × day, evening, night）との比較において、9組全条件でv2対照および前回製品（HEAD）の双方に対してΔE76の改善を達成。[記録](reference-check.json)。

| 視点 | 昼 前(v2)→後 | 夕暮れ 前(v2)→後 | 夜 前(v2)→後 |
| --- | --- | --- | --- |
| ベンチ | 8.23→5.75 | 7.40→5.77 | 7.65→6.07 |
| 左壁 | 5.66→4.47 | 5.15→4.18 | 5.21→4.26 |
| 天井 | 6.17→3.07 | 8.58→3.55 | 9.21→3.82 |

## 描画負荷

変更前HEAD `dcf97f0` の隔離コピーと最終版を、前→後→後→前で比較。Chrome 155・標準・DPR1・1280×800・固定解像度・動作抑制・ミュートで、着座正面／ベンチ／左壁／天井の昼夜を各4秒、1コールバックで3回反復描画した。描画を発行したフレーム間隔の平均÷3を使う。[数値と描画数](cost.json)。

- 着座正面の昼夜は1.003〜1.013倍。天井の昼夜は1.000倍。
- ベンチの昼夜は1.017〜1.026倍。左壁の昼は1.031〜1.040倍、夜は1.067〜1.071倍。
- 全条件で描画呼び出しは同数、受光面三角形数は192→2,928三角形（全体の約0.4%）。アプリFPS・純GPU時間・実機の性能ではない。

各チェックアウトで `ROOM_COST_VARIANTS=warmup,product bunx playwright test --config playwright.gpu.config.ts e2e/room-surfaces.gpu.ts --reporter=json` を実行し、2回目は `ROOM_COST_VARIANTS=product` とする。同じ検証ファイルを変更前にも置く。4報告を `summarize_room_surfaces_cost.py <前1> <後1> <後2> <前2> <出力.json>` へ渡す。撮影・Blender描画・別のGPU検証は同時に走らせない。

## 回帰・全周

型検査、436単体テスト、Lint、整形、本番ビルド、差分チェック、Pythonの構文確認が成功。庭・天気・季節、HDRのモード／ステージ／実コンテキスト喪失後の復帰、非HDR相当の低／標準／高画質の描画・復帰を対象とした13ブラウザケースも成功した。通常ブラウザ回帰の全件ではない。[成功報告と入力ハッシュ](validation.json)。

3ステージ×昼夕夜×8方位×3俯角の216枚も撮影成功し、同一canvasの継続とページ／コンソールerrorなしを確認。標準・DPR1・動作抑制・夏・晴れで、解像度設定は既存の自動（記録されたpixelRatioは全216枚で1）。[記録](survey/survey.json)。9条件の縮小一覧とサウナ夜の一覧を確認し、大きな欠け・黒抜けは見つからなかった。全原寸・全角度の画質合格ではなく、前後の全周比較でもない。

## 再実行

元blendは保存しない。ベースv2は従来の間接光＋直接光の結合データで、再生成は [room-light](../room-light/README.md) の手順を使う。すでにv3へ拡張したデータを入力に再拡張しない。

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_room_direct.py -- /tmp/room-combined /tmp/room-surfaces --extend --samples 1024
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/blender_room_surfaces_reference.py -- /tmp/room-surfaces-references
```

生成ヘッダーのversion・width・height・scenes・surfaces・input_sha256・bin_sha256だけを配信用JSONへ抜き出し、生成バイナリを配信する。詳細はQA側へ保存する。

```sh
bun run build
bunx playwright test --config playwright.visual.config.ts e2e/room-surfaces.visual.ts --output test-results/room-surfaces/final --reporter=json > /tmp/room-surfaces-final.json
python3 scripts/summarize_room_surfaces.py /tmp/room-surfaces-final.json test-results/room-surfaces/final docs/3d-qa/room-surfaces
python3 scripts/compare_room_surfaces_reference.py test-results/room-surfaces/final /tmp/room-surfaces-references docs/3d-qa/room-surfaces/reference-check.json
```

## 制限

昼や座面の側面・裏面、季節別の方向性／遮蔽の再ベイク、反射の一致は今回の改善に含めない。全画質／全季節天気の全周・連続見回し・自動照明遷移の連続動画・実Safari・モバイル実機・純GPU時間・実機FPS・音の実聴は未確認。
