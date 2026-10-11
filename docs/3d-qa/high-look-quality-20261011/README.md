# 高画質の見回し中の残差と水面反射の残件（2026-10-11）

現在の天気追加後のソース `d90f518` で、3D画質課題を整理し、高画質のゆっくりした見回しをTAA有効／無効で比較した。製品・配信物・検査コードは変更していない。

## 水面の反射像についての訂正

クリーム色の像は原因不明の不具合ではない。[既存調査](../auto-lighting/README.md)で水の底面で部分反射する寝椅子灯と特定され、Cyclesにも同位置に出る。[タイル光沢の追加](../water-gloss-capture/README.md)後、夕暮れの斑の平均表示輝度はCyclesと0.4以内、夜は約1.5〜1.6明るい。

残るのは形・遮蔽・明るさの差。[浅い角度と遮蔽の切り分け](../water-gloss-grazing/README.md)では、中心1点の影マップが細い梁による円盤の部分遮蔽を表せず、光源の広げ方にも誤差がある。異方性に直した試作は斑を暗くしてCyclesから離れ、不採用だった。この記録は過去の晴れ・静止画の結果で、天気追加後の再比較ではない。像を一律に消す／暗くする補正の根拠にはしない。

## 今回の撮影

- Chrome 154.0.8037.98／macOS、1200×800 CSS px、DPR 2、高画質、晴れ、昼／夕暮れ、3ステージの既定視点。
- `resolution-shimmer.visual.ts` をTAA有効→無効の順に各1回。両方成功、約79.9／78.7秒、失敗・skip・flaky・再試行なし。庭readyを待機し、ページエラーなし。
- 動作抑制・保持したrAF時刻で波と照明を止め、1 CSS px（yaw 0.004rad）ずつ12ステップ、各ステップ2 rAF。各6系列×13枚、合計156 PNG（2400×1600）。実時間の動画ではない。
- 既存集計で回転を射影変換して差し引き、L*の残差を画素と16×16画素（8 CSS px）の面で集計。逆方向のyawでは残差が増えることを全系列で検査。
- [入力・画像ハッシュと成功記録](validation.json)、[有効側](on/shimmer.json)、[無効側](off/shimmer.json)、[比較](comparison.json)。入力ハッシュは両撮影後に取得した。撮影中にソース編集なし。元reportは `/private/tmp/sauna-quality-taa-{on,off}.json`（ローカル）。

## 結果

TAA有効÷無効の比：

| 指標 | 最小 | 中央値 | 最大 |
| --- | ---: | ---: | ---: |
| 画素の平均残差 | 0.582 | 0.596 | 0.628 |
| 面の平均残差 | 0.631 | 0.643 | 0.652 |
| 面の99百分位 | 0.611 | 0.647 | 0.658 |

この診断の範囲で、TAA有効側の面の残差は約35〜37%小さい。残差マップ6枚の目視では庭の葉・細い枝、柱・屋根・水槽の細い縁に集中する。TAA有効側の初め／最後と無効側の初めの18枚を一覧で確認し、大きな形状欠落・黒抜けは見られない。夕暮れの水面左端に既知の反射像が残る。画像は `frames-review.png`、残差一覧は `on/review.png`（ローカルのみ）。残差の位置から、実時間の反射像の点滅やその原因は断定できない。

## 判断と次の作業

TAAを維持する。新しい画質補正を採用する根拠は今回得られていない。次は残差が集中する屋外の葉・細い縁について、速い見回しと上下方向の制御撮影を同条件で比較し、同方式の再撮影差も測る。波・照明が動く連続再生、夜、全水平×俯仰、他ブラウザ・実機、反射像のCycles再比較は残る。

今回は1組のみで、同方式の再撮影差を測っていない。rAF保持・スクリーンショット待機による履歴更新を含む既存診断の条件であり、実時間の知覚的ちらつき・FPS・性能の合否には使わない。全周撮影・通常回帰全体・soak・回線制限は再実行していない。

型検査、49ファイル334単体テスト、Lint、整形、本番ビルド成功。初回のプレビュー起動制限後、許可環境で撮影を実行。

## 再実行

各撮影後、次の実行が出力を消す前にPNGを別フォルダへコピーする。

```sh
SHIMMER_QUALITY=high SHIMMER_RATIOS=2 bun run test:browser:visual e2e/resolution-shimmer.visual.ts --reporter=json > /private/tmp/sauna-quality-taa-on.json
SHIMMER_QUALITY=high SHIMMER_RATIOS=2 SHIMMER_QUERY='&temporal=off' bun run test:browser:visual e2e/resolution-shimmer.visual.ts --reporter=json > /private/tmp/sauna-quality-taa-off.json
python3 scripts/summarize_resolution_shimmer.py <report> <captures> <output>
```
