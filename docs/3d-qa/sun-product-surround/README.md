# 製品化した夕暮れの日光PCSSの全周確認（2026-09-28）

日光が弱いときだけ4＋6標本にする製品版と、変更前の日光16＋24を比較した。固定幅PCFのように距離依存の半影を失っていないか、既定視点の外でも差が許容できるかを確認する。製品コード・配信物は変更していない。

## 条件

- Chrome 154、macOS headless、1200×800、DPR1、動作抑制、夕暮れ。
- 各画質で製品／変更前／製品再撮影の3条件。各108視点＝3ステージ既定＋Cycles6＋全周72（8方位×3俯仰×3ステージ）＋1pxずつの見回し27（9枚×3ステージ）。
- 光源・材質・影マップは同じ。検証ブラウザで平行光の呼び出しを `suiSunShadow` から `getShadow` に戻して変更前を再現する。Cycles参照は空を含めた **v13-sky**（50%・128サンプル）。Blenderの再実行なし。
- 集計時に3条件の入力ハッシュ・撮影名・ブラウザ・画質を照合。失敗・skip・flaky・欠けた条件を拒否する。

## 高画質

3件成功、372.5秒、skip・再試行・ページ／コンソールエラー0件。

- 最大差は `totonou-survey-5-0.png`（白い壁を見る向き）：平均ΔE76 **0.18728**、p99 **0.84699**、ΔE>2 **0%**。全108視点でΔE>2の画素は最大 **0.00125%**。
- 水平全周3一覧と最大差の壁の2倍拡大を目視。わずかな粒の差はあるが、新しい帯・接地影の消失・明暗の崩れは認めない。固定幅PCFで生じた半影の帯とは異なる。上下方向は数値比較で確認（全画像の個別目視ではない）。
- 製品再撮影は105視点で差0。Cycles01/04/05の3視点には孤立した画素差があり、最大平均ΔE76 **0.000225**、ΔE>0.5 **0.00459%未満**。最大画素差は11.89なので「全画素の再現性が同じ」とはしない。全周・見回しの再撮影は差0。
- v13 Cycles6視点との平均ΔE76の変化は **−0.00170〜+0.00058**。既存のCyclesとの差（6.7〜8.6）に対し小さい。画質改善を示すものではない。
- 製品−変更前のLab誤差の見回し時のフレーム間変化は、平均の最大 **0.03730**（サウナ）。光学フローや知覚的ちらつきの合否ではない。

[高画質集計](high/summary.json)、[全標本](high/runs.json)。画像はローカルのみ：[外気浴の全周](high/high-survey-totonou.jpg)、[壁の拡大](high/high-wall-crop.jpg)。

## 標準画質

3件成功、360.0秒、skip・再試行・ページ／コンソールエラー0件。

- 最大の平均ΔE76は同じ白い壁の視点で **0.18073**。全108視点でΔE>2の画素は最大 **0.004375%**（再撮影の孤立画素差を含む）。外気浴の水平全周と壁の2倍拡大を目視し、高画質と同じく、新しい帯や明暗の崩れは認めない。
- 製品再撮影は全周・見回し・既定視点の102枚で差0。Cycles6視点には孤立した差があり、最大平均ΔE76 **0.000226**、ΔE>0.5 **0.00459%未満**。
- v13 Cyclesとの平均ΔE76の変化は **−0.00180〜+0.00052**。見回しのLab誤差変化は平均の最大 **0.03773**。

[標準画質集計](standard/summary.json)、[全標本](standard/runs.json)、[壁の拡大](standard/standard-wall-crop.jpg)（画像はローカルのみ）。

## 判断と限界

昼夕補間は別の[制御撮影](../sun-product-transition/README.md)で確認した。今回の撮影から日光4＋6を戻す必要は認めず、製品の設定を維持する。通常速度の動画、全周を動かしながらの昼夕補間、モバイル実機は未検証。

この診断は既定視点のGPU標本も添付するが、今回の目的は画質確認であり、逆順・複数組の性能追試ではない。速度の根拠は既存の[製品化時の測定](../shadow-per-light/README.md)を参照し、今回の実行から60fpsや高速化率を主張しない。

## 再実行

```sh
SUN_SHADOW_PRODUCT=1 bun run test:browser:gpu e2e/sun-shadow.gpu.ts --reporter=json > /tmp/sauna-sun-product-high.json
python3 scripts/summarize_sun_product.py /tmp/sauna-sun-product-high.json docs/3d-qa/sun-product-surround/high
SUN_SHADOW_PRODUCT=1 SUN_SHADOW_QUALITY=standard bun run test:browser:gpu e2e/sun-shadow.gpu.ts --output=test-results/sun-product-standard --reporter=json > /tmp/sauna-sun-product-standard.json
python3 scripts/summarize_sun_product.py /tmp/sauna-sun-product-standard.json docs/3d-qa/sun-product-surround/standard
```

別の出力先を指定しないGPUテストは `test-results/gpu` を消すので、集計・目視確認の前に次の実行で上書きしないこと。
