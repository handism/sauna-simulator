# 葉・細い縁の見回し中の明滅（2026-10-19）

## 変更

`temporalAA.ts` の履歴制限を、現在画素と上下左右の5点の平均±標準偏差から、平均±1.25×標準偏差へ小さく広げた。画素境界をまたぐ細い葉や輪郭の履歴を捨てすぎないようにする。現在画素を必ず含む制限、履歴重み0.9、Catmull-Rom、60静止フレーム後のパス省略、ジャンプ／ステージ／解像度変更時の履歴破棄は維持する。

新しい描画パス・テクスチャ・サンプルはない。画面をずらすサブピクセルジッターは使わない。GLB・プローブ・材質・2Dは変更しない。適用は従来どおりHDRの標準／高画質のみ。

## 比較方法

Chrome 155.0.8059.80、1200×800 CSS px、夏・晴れ、動作抑制、固定解像度。標準DPR1.5と高画質DPR2で、3ステージ×昼夕×13枚を各4回（前→後→後→前）。同じ最終ビルドのWebGLシェーダー内の `historySigma` だけを1.0へ戻した対照と1.25の製品を比べる。置換箇所・適用回数を確認し、ページ／console errorは失敗にする。

`?camera=review` でシーン定義の比較用視点を使い、集計の再投影と投影角を一致させる。現在の着座・初期俯角での既定視点の改善量へは読み替えない。実際の既定視点の静止／停止後の画像は別の回帰テストで確認した。

`SHIMMER_CONTROLLED=1` では `installRefractionClock` で実アプリのrAFを撮影中に保留する。70フレーム整定後、1 CSS px（yaw 0.004rad）のポインター移動ごとに正確に2フレーム進め、撮影の待ち時間には描画を進めない。集計時には13枚の順序・ステップ間フレーム数・設定／ソース一致を検査する。回転を補償したL*残差を画素、8 CSS px四方の面、その99百分位で集計し、同条件の再撮影差も分ける。

`preliminary/` は従来の時刻固定だけの撮影による予備結果。撮影の待ち時間にも蓄積が進み、同方式の残差比に最大約4%の差があったため、採用の改善量には使わない。

## 結果

数値は変更後÷変更前。括弧内は中央値。標準・高画質とも4回のABBA比較が成功し、計624 PNGを撮影した。

| 条件 | 画素の残差 | 面の残差 | 面の99百分位 |
|---|---|---|---|
| 標準・DPR1.5 | 0.978〜0.989（0.986） | 0.948〜0.973（0.960） | 0.943〜0.975（0.968） |
| 高画質・DPR2 | 0.978〜0.990（0.987） | 0.951〜0.976（0.967） | 0.957〜0.978（0.968） |

面の残差は標準で2.7〜5.2%（中央値4.0%）、高画質で2.4〜4.9%（同3.3%）低減。大幅な画質向上ではなく、既存TAAへの控えめな上積み。静止した最初の画像の前後差は両画質とも全6条件で0画素だった。同方式の再撮影では、丸め後の面残差の比は全条件で1.000。PNG自体は完全一致ではなく、平均RGB差の最大は標準約0.0027・高画質約0.0029階調（8bit）。最大差だけは7／8階調で、微小なGPU側の差は残る。

12ステップ後のL*勾配の前後比は標準1.006〜1.010、高画質1.006〜1.010。全体の勾配の低下は見られなかったが、これはエイリアシングによる段差も含み、純粋なぼけの測定ではない。標準の外気浴昼の前後、水風呂昼・サウナ夕の変更後、高画質の外気浴昼の変更後の代表フレームを表示して確認した範囲で、大きな欠け・二重像は見られなかった。全原寸・連続映像の目視合格ではない。

詳しい系列別の数値・画像SHA-256・再撮影差は `standard/comparison.json` と `high/comparison.json`。入力に使ったソースとモデルのハッシュは `validation.json`。

## 負荷

`temporal-variance.gpu.ts`、Chrome 155、1200×800・標準DPR1.5・固定解像度・動作抑制。3ステージ×昼夜を、予備実行→前→後→後→前で測定（5件成功）。1フレームにつき描画を3回反復し、各描画後に微小な往復ポインター入力を送る。実際のTAA描画回数が測定フレーム数の2倍より多いことを検査し、静止時のTAA省略を測ってしまわないようにした。

描画を発行したrAF間隔の平均÷3の変更後／前は0.958〜1.006倍。前半の組だけ一様に低く、後半は1.000〜1.006倍。同じ方式にも時間順の変動があり、速度改善・ゼロコストの証明とはしない。今回の条件で大きな増加は検出しなかった。純GPU時間・実機FPSではない（`cost.json`、原報告は `cost-report.json`）。

型検査・440単体テスト・Lint・整形・ビルド・Python構文確認が成功。遅延3Dチャンクは905.72kB（gzip250.23kB）で、既存850kB警告は継続。2D入口は230.92kB（gzip73.79kB）。


## 静止・停止後と復帰

`temporal-aa.e2e.ts` を標準DPR1.5／高画質DPR2へ拡張。見回し前の静止画、12ステップ見回した画像、停止70フレーム後の画像を、同じ視点の `?temporal=off` と比べる。静止時は両画質とも1 RGB階調を超える差0画素。停止後は標準0画素、高画質5画素（0.0001302%）で既存基準0.001%未満を満たした。動いている最中の残像の知覚的合否とは区別する。

HDRの反復2D/3D変更・ステージ移動・実コンテキスト喪失後復帰、非HDR相当の3画質の表示／復帰、CDPによるタッチ操作とキャンセルも含め、7件成功・skip/retry/失敗0（`regression.json`）。実機タッチや実Safariの結果ではない。

## 再実行

```sh
bun run build
SHIMMER_ABBA=1 SHIMMER_FIXED=1 SHIMMER_CONTROLLED=1 SHIMMER_RATIOS=1.5 \
  SHIMMER_QUERY='&camera=review' \
  bunx playwright test --config playwright.visual.config.ts e2e/resolution-shimmer.visual.ts \
  --reporter=json > /tmp/temporal-standard.json
# test-results/visual を standard/captures へ保存してから、次の撮影を行う。
# 高画質は同じ指定に SHIMMER_QUALITY=high SHIMMER_RATIOS=2 を使う。
python3 scripts/summarize_temporal_variance.py /tmp/temporal-standard.json \
  docs/3d-qa/temporal-variance/standard/captures docs/3d-qa/temporal-variance/standard

bunx playwright test --config playwright.gpu.config.ts e2e/temporal-variance.gpu.ts \
  --reporter=json > /tmp/temporal-cost.json
python3 scripts/summarize_temporal_variance.py /tmp/temporal-cost.json - \
  docs/3d-qa/temporal-variance --cost

bunx playwright test e2e/temporal-aa.e2e.ts e2e/scene-touch.e2e.ts \
  e2e/scene-lifecycle.e2e.ts e2e/scene-no-hdr.e2e.ts \
  --grep 'temporal blend|touch look|repeated modes|split request without HDR'
```

JSONのみGit管理し、PNGと比較画像はローカルに置く。負荷測定中には画像集計や別のGPU処理を実行しない。

## 範囲と残件

これは制御された静止フレーム列の数値と限定した目視確認で、連続映像の知覚的ちらつき・残像の合格、GPU単体時間、実機FPSの証明ではない。速いフリック、動的解像度の低い段、四季／夜／雨雪、全周、実機、実Safariは今回の比較対象外。ぼけとの釣り合いから補正は1.25倍に留め、葉や細い縁の残差は残る。
