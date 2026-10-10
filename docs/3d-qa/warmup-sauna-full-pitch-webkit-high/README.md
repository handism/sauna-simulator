# WebKit高画質・室内の上下限までの実時間見回し（2026-10-10）

Chromeの室内検証に続き、WebKit 26.6で昼→夕と夕→夜を各195秒記録。1280×800・高画質・split・TAA on・動作抑制なし・frameRate full・自動解像度。製品・配信物・検査コードの変更なし。

録画前に俯仰を約−0.01radへ揃え、20〜170秒で水平360度と上下±0.86rad相当の実ポインター入力を送る。製品の±0.85rad制限に触れる入力であり、実カメラ角の計測や全水平×俯仰の組合せの網羅ではない。録画中は時計・rAF・タイマーを実時間で進める。

```sh
MOTION_BROWSER=webkit MOTION_SCOPE=sauna MOTION_LOOK=full-pitch MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-full-pitch-webkit.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-full-pitch-webkit.json docs/3d-qa/warmup-sauna-full-pitch-webkit-high --scope sauna --look full-pitch --warmup split --browser webkit --quality high
python3 -m unittest discover -s scripts -p test_surround_validation.py
```

## 結果

2/2成功、計412.38秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。

| 経路 | 観察時間 | 標本 | 最大照明目標差 | 最大標本間隔 |
| --- | ---: | ---: | ---: | ---: |
| 室内・昼→夕 | 195.059秒 | 185 | 0.008256未満 | 1.128秒 |
| 室内・夕→夜 | 195.122秒 | 183 | 0.008284未満 | 1.122秒 |

全標本で庭ready・本体／庭の未描画0。照明終点・同一canvas・2D復帰、入力条件・製品と配信物のハッシュを照合。全WebM／MP4のデコード成功。抽出24枚を目視し、天井・壁・ベンチ・窓枠の大きな形状欠落・黒抜けなし。夕夜の一覧最初の画像は見回し開始前のUIを含む。連続再生による知覚的ちらつき合否は未判定。

型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェックと集計境界7テスト成功。初回プレビュー起動制限後、許可環境で再実行。通常回帰・soak・回線制限は製品変更がないため再実行していない。

次はWebKit屋外の同じ上下入力を検証できる。屋外の反対側照明経路、全方向×俯仰の組合せ、連続映像の知覚的確認、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・モバイル・遅い端末、GPU実確保量、音の実聴は残件。WebKitを実Safariとは扱わず、符号化fps・資源数を性能やリーク不存在の証明にしない。既定2D・明示3D・split試験オプションを維持。

- [集計と入力・動画ハッシュ](summary.json)／[検証記録](validation.json)
- [昼夕標本](sauna-12-samples.json)／[夕夜標本](sauna-27-samples.json)
- ローカル画像：[昼夕](sauna-12.jpg)／[夕夜](sauna-27.jpg)
- ローカル動画：[昼夕](sauna-12.mp4)／[夕夜](sauna-27.mp4)
