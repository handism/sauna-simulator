# Chrome高画質・屋外の上下限までの実時間見回し（2026-10-10）

室内の残件に続き、水風呂の昼→夕暮れと外気浴の夕暮れ→夜を各195秒検証した。Chrome 154.0.8037.98・macOS headless・1280×800・高画質・split・TAA on・動作抑制なし・frameRate full・自動解像度（全標本pixelRatio=1）。製品・配信物・検査コードの変更なし。

録画前にArrowDown 32回／ArrowUp 14回で俯仰を約−0.01radへ揃える。20〜170秒に水平360度と上下±0.86rad相当の実ポインター入力を送り、製品の±0.85rad制限に触れる。最初の12／27分の保持だけ時計オフセットで省略し、録画中は実時間。pitchOffsetは相対入力量で、実カメラ角の計測ではない。全水平×俯仰の組合せや屋外各ステージの両照明経路を網羅しない。

```sh
MOTION_SCOPE=outdoor MOTION_LOOK=full-pitch MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-outdoor-full-pitch.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-outdoor-full-pitch.json docs/3d-qa/warmup-outdoor-full-pitch-high --scope outdoor --look full-pitch --warmup split --browser chromium --quality high
python3 -m unittest discover -s scripts -p test_surround_validation.py
```

## 結果

2/2成功、計403.98秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。各186標本で高画質・自動照明・庭ready・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。集計で入力軌跡・条件・入力ハッシュを照合。

| 経路 | 観察時間 | 標本 | 最大照明目標差 | 最大標本間隔 |
| --- | ---: | ---: | ---: | ---: |
| 水風呂・昼→夕 | 195.059秒 | 186 | 0.008291未満 | 1.122秒未満 |
| 外気浴・夕→夜 | 195.025秒未満 | 186 | 0.008307未満 | 1.115秒未満 |

全WebM／MP4デコード成功。抽出24枚を目視し、水風呂のタイル・壁・注水口、外気浴の椅子・デッキ・屋根・樹木に大きな形状欠落・黒抜けなし。水面のクリーム色の反射像は残る。連続再生による知覚的ちらつき合否は未判定。

型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。集計境界7テスト成功。初回プレビュー起動制限後に許可環境で再実行。録画終了前の集計は未出力レポートで停止し、終了後の再集計が成功した。製品変更がないため通常回帰・soak・回線制限は再実行していない。

次はWebKitの同じ上下入力を検証できる。屋外の反対側照明経路、全方向×俯仰の組合せ、連続映像の知覚的確認、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・モバイル・遅い端末、GPU実確保量、音の実聴は残る。符号化fps・資源数を性能やリーク不存在の証明にしない。既定2D・明示3D・split試験オプションを維持。

- [集計と入力・動画ハッシュ](summary.json)／[検証記録](validation.json)
- [水風呂標本](water-12-samples.json)／[外気浴標本](totonou-27-samples.json)
- ローカル画像：[水風呂](water-12.jpg)／[外気浴](totonou-27.jpg)
- ローカル動画：[水風呂](water-12.mp4)／[外気浴](totonou-27.mp4)
