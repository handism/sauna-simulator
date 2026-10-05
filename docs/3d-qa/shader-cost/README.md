# 初回のシェーダーコンパイルを減らす（2026-10-05、採用）

[他ブラウザの確認](../other-browsers/README.md)の残件「初回コンパイルの停止の対策」。Metalのシェーダーキャッシュがない初回は、入室時にメインスレッドが軽量約6秒・標準／高精細約14.5秒止まっていた。

**どこで時間を使っているかを特定し、無駄に作っていたMetalのパイプラインを2か所なくした。標準・高精細の初回は約15.7秒→約10.8秒、軽量は約7.0秒→約5.9秒。画像は変わらない（30視点で全画素一致）。** 残りは描画に本当に必要なパイプラインで、停止はまだ約10秒ある。

## 原因

- ANGLEのMetalバックエンドは、プログラムのリンク（約0.3秒、並列に進む）とは別に、**描画した状態の組み合わせごとにMetalのパイプラインを作る**（描画先の形式・標本数・ブレンド・深度書き込み・alpha-to-coverage。約0.2秒、GPUプロセスで直列）。メインスレッドは、次にGPUプロセスを待つ同期呼び出し（多くはthreeが新しいプログラムを初めて使うときの `getProgramInfoLog`）でまとめて待たされる。ChromeのWebGLの `finish()` は待たないので、描画の直後に計っても時間は出ない。
- 重い材質プログラム（MSLで約8.7万字）1つあたりの費用は、影・スポット光5灯・面光源6灯を外しても1〜2割しか減らない（[値](cedar-variants.json)。合成ページで、名前の新しいuniformを足して毎回キャッシュを外す）。PCSSのループを展開させない変更でも初回は変わらなかった（[値](pcss-loops.json)）。減らせるのはパイプラインの**数**。
- 読み込み時に作っていた重い（16万字超の）材質のパイプラインは47個（CfT・標準、[値](pipelines-before.json)）：

| 描画先 | 数 | 内容 |
| --- | ---: | --- |
| 主描画（RGBA16F・4倍MSAA） | 21 | 各材質、水中の材質の側面の像（反転あり・なしの2通り）、側面の奥の壁 |
| 水面の鏡像（RGBA16F・2倍MSAA） | 13 | 鏡像に写る材質 |
| 影マスク（RGBA32F・MSAAなし） | 13 | **不要**：影マップを描き直すフレームで、影マスクのターゲットへ本物の材質のまま全体を描いていた |

## 変更

1. **影マスクの影の更新**（`shadowMask.ts`）：静的な影マップは更新後の最初の描画で、そのカメラのレイヤーの物体から描かれるため、影マスクは更新が必要なフレームで元のレイヤーのまま一度描いている。このとき `scene.overrideMaterial` に色も深度も書かない材質を指定する。threeは影マップを各物体自身の材質から作る深度材質で描くので、影マップは同じ投射物で描かれ、材質はこのターゲットの形式で描かれない（13個減る。画質変更時の描き直しのGPU時間も減る）。
2. **側面の像の反転**（`refraction.ts`）：1回だけ鏡映した像（側面）と2回の像（角）は、`SUI_SIDE_FLIPPED` の定義で別プログラムだった。反転は既存のuniform `suiSide` から決まる（`x·y == 0`）ので、シェーダー内の分岐にして1つのプログラムにした（重いプログラム・パイプラインが4個減る）。カリングする面の入れ替えは描画状態なので従来どおり。

変更後は重い材質のパイプラインが30個（[影の更新だけ](pipelines-shadow-refresh.json)で34個、[両方](pipelines-after.json)で30個）。

## 初回の時間

`diagnose_other_browsers.mjs` を `SUI_COLD=1` で（cft・webkitの専用のMetalキャッシュを消して）実行。macOS・Apple M1 Max・headless・1200×800・DPR 1.5。変更前は[前回の記録](../other-browsers/cold.json)。

| ブラウザ | 画質 | 変更前 `data-load-ms` | 変更後 | 変更後の最長の停止 | 2回目（キャッシュあり） |
| --- | --- | ---: | ---: | ---: | ---: |
| CfT | 軽量 | 7049 | 5816 | 4.6秒 | 416 |
| CfT | 標準 | 15669 | 10635 | 9.4秒 | 580 |
| CfT | 高精細 | 15606 | 10856 | 9.6秒 | 581 |
| WebKit | 軽量 | 6903 | 6009 | 4.8秒 | 354 |
| WebKit | 標準 | 15801 | 10989 | 9.8秒 | 393 |
| WebKit | 高精細 | 15858 | 11014 | 9.8秒 | 394 |

[値](cold.json)。エラー・2Dへのフォールバックはなし。

## 画像

`stage-compare.visual.ts`（水風呂12視点）と `cycles-compare.visual.ts`（Cyclesの6視点×昼夕夜）を `CAPTURE_PNG=1 CAPTURE_QUERY='&resolution=fixed'`・標準画質で、変更前（HEAD `0a616ee` のworktree）→変更後→変更前→変更後の順に撮った。30枚すべてで、同じ回の変更前と変更後が全画素一致（同じ版の1回目と2回目の間には一部の視点で18〜45画素の揺らぎがあり、それも変更前後で同じ。[値](images.json)）。

## 採らなかったもの・残り

- **リンクの確定を1つずつ分ける：効果なし。** 読み込み時に各プログラムの `getUniforms()` を1つずつ呼んでメインスレッドを譲っても、どれもすぐ返り、停止は最初の描画の後の小さなプログラムの `getProgramInfoLog` で約10秒のまま。重いのはリンクではなく描画で作るパイプラインのため。
- **鏡像を4倍MSAAにする：未採用（判断待ち）。** 主描画と同じ標本数ならパイプラインを共有でき、標準の初回が約2.5秒短くなった（影の変更の前の版で、CfT 13.4秒・WebKit 13.9秒。同じ日の変更前は15.7〜16.4秒。[値](mirror-samples4.json)）。ただし2026-10-04に[メモリのため2倍にした](../mirror-msaa/README.md)判断（高精細・1280×800で約23MiB、DPR 2で約94MiB）を戻すことになる。
- 残りの約10秒を減らすには、水中の材質の「側面の奥の壁」（ブレンドする複製、`SUI_HARD_SHADOW`）と本体の統合、材質どうしの統合など、画像が変わり得る変更が要る。本物の描画を複数のフレームに分けて温める方法は、停止を短く分けられるが合計は変わらず、影マップ・鏡像の描き直し条件と絡むため未実施。
- 範囲：macOS・Apple GPUのみ。実際のSafari・Windows・遅い端末での初回の長さ（30秒の期限）は未確認。GPU時間は測っていない（変更1は影の描き直しのフレームだけ、変更2はuniformによる一様な分岐）。

## 再実行

```sh
bun run build && bun run preview -- --host 127.0.0.1 --port 4191 --strictPort &
# 読み込み時に作るパイプライン（描画状態の組み合わせ）と遅い呼び出し
node scripts/diagnose_shader_cost.mjs attribute http://127.0.0.1:4191/sauna-simulator/ pipelines.json cft standard
# 初回の時間
SUI_COLD=1 node scripts/diagnose_other_browsers.mjs http://127.0.0.1:4191/sauna-simulator/ cold.json "" cft,webkit
# 1つの材質プログラムの費用と、影・光源を外した場合（合成ページ）
node scripts/diagnose_shader_cost.mjs capture http://127.0.0.1:4191/sauna-simulator/ sources.json standard
SUI_PROGRAM="V11 | cedar end grain" node scripts/diagnose_shader_cost.mjs measure sources.json cedar.json cft
```

`sources.json`（全プログラムのソース、約5MB）と画像はGit管理外。
