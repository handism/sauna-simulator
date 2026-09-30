# 深度だけのプリパス（Zプリパス）（2026-09-30、採用）

水面のタイル光沢の追究（[前回](../water-gloss-grazing/README.md)）を費用に見合わないとして打ち切り、60fps目標に向けた性能の診断へ移った。フレームの時間は画素ごとの計算がほぼすべてで、結合したメッシュのため同じ画素を何度も計算していた。不透明な面の深度だけを先に描くプリパスを入れ、**画像を変えずに**サウナで約5割、外気浴で4〜6割、水風呂で2割、GPU時間を減らした。

## 切り分け

`e2e/frame-cost.gpu.ts`（標準画質・1200×800・DPR1・動作抑制・庭の準備完了後、3ステージ既定視点×昼夕夜）。Chrome 154／ANGLE Metal（Apple M1 Max、`WEBGL_debug_renderer_info` で確認。ソフトウェア描画ではない）。

- **描画先・描画ごとの時間は測れない。** 描画先を切り替えるたびにタイマーを区切ると、鏡像・主パス・トーンマッピングの各区間がそれぞれフレーム全体に近い値を返し、合計がフレームの約3倍になった（ANGLEのMetal実装はコマンドバッファ単位で計る）。以後はフレーム全体の時間を保ったまま機能を外す比較にした。
- **画素の計算がほぼすべて。** 描画の画素シェーダをすべて定数にすると（`trivial`）、全条件で1.2〜1.7ms（製品は39〜139ms）。頂点処理・ラスタライズ・4倍MSAA・解決・トーンマッピングは無視できる。
- **重ね描きが多い。** 加算合成で数えた1画素あたりの計算回数（`overdraw`）は、サウナ4.73（3回以上の画素93%）、水風呂3.14、外気浴2.52。threeは不透明物を手前から並べるが、材質ごとに結合したメッシュはシーン全体にまたがり、並べ替えが効かない。
- **Apple GPUの隠面除去（HSR）も効いていない。** 実行されない `discard` を全シェーダに足すとHSRは無効になるが、時間は変わらなかった（サウナ昼 81.5・91.4ms → 80.9・87.5ms、全条件で順序による揺れの範囲内）。

## 変更

`src/components/3d/depthPrepass.ts`：不透明な面のメッシュに、形状を共有する深度だけの子メッシュ（`colorWrite: false`、元の面の向き、polygonOffset 1,1）をレイヤー4に加える。`hdrOutput.ts` がそのレイヤーだけを先に描き、深度を消さずに通常の描画を重ねる。子メッシュなので変換・表示／非表示は元に従う。庭も読み込み後に同じく加える。

対象外（従来どおり通常の描画だけ）：半透明・合成する面、アルファテスト／alpha-to-coverageの葉、水中の材質（`SUI_REFRACTION`：頂点を屈折した位置へ動かし、`discard` する）、既定以外のレイヤー（側面の像・鏡像専用の光源・蒸気）、`ShaderMaterial`（空など）、インスタンス・スキン・モーフ。本体・庭で78メッシュ（`data-prepass-meshes`）。描画数・三角形数の `data-*` は従来どおり通常の描画だけの値。鏡像パス（状態が変わったときだけ描く）には入れていない。

`disposeTree` は共有する形状を1回だけ解放するよう集合にした。

## 結果

### GPU時間

HEADのworktreeと交互に計測した中央値（ms）。値は [cost.json](cost.json)。

| 標準画質（3組） | 変更前 | 変更後 | 比 |
| --- | ---: | ---: | ---: |
| サウナ 昼 | 78.0〜82.0 | 37.2〜38.8 | 0.46〜0.50 |
| サウナ 夕暮れ | 109.2〜110.1 | 59.0〜61.0 | 0.54〜0.56 |
| サウナ 夜 | 126.1〜127.9 | 68.1〜70.3 | 0.53〜0.56 |
| 水風呂 昼 | 67.4〜71.2 | 54.4〜61.6 | 0.76〜0.90 |
| 水風呂 夕暮れ | 99.0〜104.2 | 80.0〜85.8 | 0.77〜0.87 |
| 水風呂 夜 | 112.9〜115.2 | 89.8〜94.0 | 0.78〜0.83 |
| 外気浴 昼 | 38.5〜39.0 | **13.1〜13.7** | 0.34〜0.35 |
| 外気浴 夕暮れ | 64.5〜65.4 | 40.6〜41.4 | 0.62〜0.64 |
| 外気浴 夜 | 74.3〜75.9 | 44.1〜45.3 | 0.59〜0.60 |

高画質（2組、この条件ではDPR1なので違いは影の解像度と鏡像の解像度）も同じ傾向：サウナ0.47〜0.53、水風呂0.76〜0.81、外気浴0.34〜0.63。全組で範囲が重ならない。描画数・三角形数は同じ。

外気浴の昼はGPU時間が16.7msを下回った。ほかの条件は60fps目標に届かない。水風呂の減り方が小さいのは、画面の多くを占める水中の面が対象外のため。

### 画像

変更前後で同じ撮影を比べた（[cost.json](cost.json) `images`）：Cycles同視点18枚・水風呂ステージ12枚（画面演出を除く）は**全画素一致**。全周216枚はサウナ・外気浴の144枚が全画素一致、水風呂72枚は画面の縁だけ差があり中央（縁20%を除く）は差0：全周撮影が残す `.cooling-glow` の脈動で、[既知](../../../e2e/CLAUDE.md)の撮影間の差。

## 残件

- 水中の材質もプリパスに入れる（屈折した頂点位置を同じ式で出す深度材質、`discard` の扱い）。水風呂の残り（56〜94ms）の大半。
- 夕暮れ・夜は暖色灯5灯・月の影（PCSS）の計算がなお重い。1画素1回になったので、影の費用の比率は以前の測定より大きくなっている可能性があり、光源ごとの費用を測り直す。
- 他の端末（Windowsの外付け・内蔵GPU、モバイル）での効果は未測定。即時描画型のGPUでは手前から並べる効果が同じく効かないため効くと見込むが、確認していない。

## 検証

型検査、38ファイル224単体テスト（`depthPrepass.test.ts` 3件追加、`hdrOutput.test.ts` 2件を描画順に合わせて更新）、Lint、整形、本番ビルド、ブラウザ回帰15件、撮影246枚（変更前はHEADのworktree）、GPU時間（標準3組・高画質2組）、切り分け（定数シェーダ2回・`discard` 2回・重ね描き1回）。継続利用1件（8周・5.9分）成功。

## 再実行

```sh
bun run test:browser:gpu e2e/frame-cost.gpu.ts --reporter=json > ablation.json   # 製品・定数・定数・製品、重ね描き
FRAME_COST_VARIANTS=product,discard,discard,product bun run test:browser:gpu e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > discard.json
# 変更前後：HEADのworktreeと交互に（ビルド済みなら playwright test --config playwright.gpu.config.ts で直接）
FRAME_COST_VARIANTS=product bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > after-1.json
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/depth-prepass/cost.json \
  --runs standard before=before-1.json,... after=after-1.json,... --runs high before=... after=... \
  --ablation ablation.json discard.json --images <変更前の test-results/visual> test-results/visual
```

`FRAME_COST_QUALITY=high` で高画質。
