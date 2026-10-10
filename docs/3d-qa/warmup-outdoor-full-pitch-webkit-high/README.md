# WebKit高画質・屋外の上下限までの実時間見回し（2026-10-10）

室内に続き、WebKit 26.6で水風呂の昼→夕と外気浴の夕→夜を各195秒検証。1280×800・高画質・split・TAA on・動作抑制なし・frameRate full・自動解像度。製品・配信物・検査コードの変更なし。

録画前に俯仰を約−0.01radへ揃え、水平360度と上下±0.86rad相当の実ポインター入力で製品の±0.85rad制限に触れる。相対入力量は実カメラ角の計測ではなく、全水平×俯仰の組合せの網羅でもない。録画中は実時間で時計・rAF・タイマーを進める。

```sh
MOTION_BROWSER=webkit MOTION_SCOPE=outdoor MOTION_LOOK=full-pitch MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-outdoor-full-pitch-webkit.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-outdoor-full-pitch-webkit.json docs/3d-qa/warmup-outdoor-full-pitch-webkit-high --scope outdoor --look full-pitch --warmup split --browser webkit --quality high
python3 -m unittest discover -s scripts -p test_surround_validation.py
```

## 結果

2/2成功、計405.97秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。全標本で庭ready・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。入力軌跡・条件・入力ハッシュを集計で照合。

| 経路 | 観察時間 | 標本 | 最大照明目標差 | 最大標本間隔 |
| --- | ---: | ---: | ---: | ---: |
| 水風呂・昼→夕 | 195.102秒 | 186 | 0.008262未満 | 1.116秒 |
| 外気浴・夕→夜 | 195.107秒 | 184 | 0.008295未満 | 1.193秒 |

全WebM／MP4デコード成功。抽出24枚を目視し、タイル・壁・注水口・椅子・デッキ・屋根・樹木に大きな形状欠落・黒抜けなし。水面のクリーム色の反射像は残る。連続再生による知覚的ちらつき合否は未判定。

型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェックと集計境界7テスト成功。初回プレビュー起動制限後、許可環境で再実行。製品変更がないため通常回帰・soak・回線制限は再実行していない。

次は屋外の反対側照明経路を検証できる。全方向×俯仰の組合せ、連続映像の知覚的確認、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・モバイル・遅い端末、GPU実確保量、音の実聴は残件。WebKitを実Safariとは扱わず、符号化fps・資源数を性能やリーク不存在の証明にしない。既定2D・明示3D・split試験オプションを維持。

- [集計と入力・動画ハッシュ](summary.json)／[検証記録](validation.json)
- [水風呂標本](water-12-samples.json)／[外気浴標本](totonou-27-samples.json)
- ローカル画像：[水風呂](water-12.jpg)／[外気浴](totonou-27.jpg)
- ローカル動画：[水風呂](water-12.mp4)／[外気浴](totonou-27.mp4)
