# WebKit高画質・屋外の反対側照明経路（2026-10-10）

直近の残件を継続し、水風呂の夕暮れ→夜と外気浴の昼→夕暮れを各195秒検証。WebKit 26.6・macOS headless・1280×800・高画質・split・TAA on・動作抑制なし・full。製品・配信物・検査コードの変更なし。

録画前にArrowDown 32回／ArrowUp 14回で俯仰を約−0.01radへ揃える。20〜170秒に水平360度と上下±0.86rad相当の実ポインター入力で製品の±0.85rad制限に触れる。最初の12／27分だけ時計オフセットで省略。相対入力は実カメラ角の計測ではなく、全水平×俯仰の組合せの網羅でもない。

```sh
MOTION_BROWSER=webkit MOTION_SCOPE=outdoor-reverse MOTION_LOOK=full-pitch MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-outdoor-reverse-full-pitch-webkit.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-outdoor-reverse-full-pitch-webkit.json docs/3d-qa/warmup-outdoor-reverse-full-pitch-webkit-high --scope outdoor-reverse --look full-pitch --warmup split --browser webkit --quality high
python3 -m unittest discover -s scripts -p test_surround_validation.py
```

2/2成功、計406.02秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。水風呂185、外気浴184標本で庭ready・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。入力ハッシュ・軌跡・条件照合成功。

| 経路 | 観察時間 | 標本 | 最大照明目標差 | 最大標本間隔 |
| --- | ---: | ---: | ---: | ---: |
| 水風呂・夕→夜 | 195.058秒 | 185 | 0.008284未満 | 1.123秒未満 |
| 外気浴・昼→夕 | 195.034秒 | 184 | 0.008267未満 | 1.190秒未満 |

全WebM／MP4デコード成功。抽出24枚の目視でタイル・壁・注水口・椅子・デッキ・屋根・樹木の大きな形状欠落・黒抜けなし。水面のクリーム色の反射像は残る。連続再生の知覚的ちらつき合否は未判定。

型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェックと集計境界8テスト成功。初回はプレビュー起動制限により0件実行後、許可環境で再実行。製品変更がないため通常回帰・soak・回線制限は再実行しない。

既存の上下限見回し経路についてChrome／WebKitの記録が揃った。全方向×俯仰の組合せ・知覚的連続映像確認、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・実モバイル・遅い端末、GPU実確保量・音の実聴は残件。WebKitを実Safariとは扱わず、符号化fps・資源数を性能・リーク不存在の承認とは扱わない。既定2D・明示3D・split試験オプションを維持する。

- [集計](summary.json)／[検証記録](validation.json)
- [水風呂標本](water-27-samples.json)／[外気浴標本](totonou-12-samples.json)
- ローカル画像：[水風呂](water-27.jpg)／[外気浴](totonou-12.jpg)
- ローカル動画：[水風呂](water-27.mp4)／[外気浴](totonou-12.mp4)
