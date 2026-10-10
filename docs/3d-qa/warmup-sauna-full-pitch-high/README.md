# Chrome高画質・室内の上下限までの実時間見回し（2026-10-10）

残件の全俯仰を室内2経路から検証。製品・配信物は変更せず、録画テストに `MOTION_LOOK=full-pitch` を追加した。Chrome 154.0.8037.98・macOS headless・1280×800・高画質・split・TAA on・動作抑制なし・frameRate full・自動解像度（全標本pixelRatio=1）。

昼→夕（12〜15分）と夕→夜（27〜30分）を各195秒記録する。最初の保持時間だけ時計オフセットで省き、録画中の時計・rAF・タイマーは実時間。20〜170秒で水平360度と上下2往復の実ポインター入力を送る。録画前にArrowDown 32回／ArrowUp 14回で俯仰を約−0.01radへ揃え、上下±0.86rad相当（215 CSS px）の入力で製品の±0.85rad（約49度）制限に触れる。pitchOffsetは入力から計算した相対量で、実カメラ角の計測ではない。水平と上下の組合せは一つの軌跡であり、すべての組合せを網羅しない。

```sh
MOTION_SCOPE=sauna MOTION_LOOK=full-pitch MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-full-pitch.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-full-pitch.json docs/3d-qa/warmup-sauna-full-pitch-high --scope sauna --look full-pitch --warmup split --browser chromium --quality high
python3 -m unittest discover -s scripts -p test_surround_validation.py
```

## 結果

2/2成功、計411.43秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。

| 経路 | 観察時間 | 標本 | 最大照明目標差 | 最大標本間隔 |
| --- | ---: | ---: | ---: | ---: |
| 室内・昼→夕 | 195.02秒 | 186 | 0.008282未満 | 1.157秒未満 |
| 室内・夕→夜 | 195.06秒 | 187 | 0.008299未満 | 1.101秒未満 |

全標本で高画質・自動照明・庭ready・本体／庭の未描画0。照明終点・同一canvas継続・2D復帰を確認。ポインター入力1275／1278件の継続・水平総移動・上下軌跡を照合した。全WebM／MP4のデコード成功、抽出24枚を目視し天井・壁・ベンチ・窓枠の大きな形状欠落・黒抜けなし。窓越しの庭と昼夕夜の変化も確認。全連続再生による知覚的ちらつき合否は未判定。

型検査・48ファイル321単体テスト・Lint・整形・本番ビルド・差分チェック成功。集計境界7テスト成功（従来5件、入力モード混在と上下軌跡改変の拒否を追加）。最初のプレビュー起動制限後に許可環境で再実行。製品変更がないため通常ブラウザ回帰・soak・回線制限は再実行していない。

水風呂・外気浴とWebKitの同じ上下入力、全水平×俯仰の組合せ、連続映像の知覚的確認、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・モバイル・遅い端末、GPU実確保量、音の実聴は残る。符号化fps・一定の資源数を実描画性能やリーク不存在の証明にしない。既定2D・明示3D・split試験オプションを維持。

- [集計と入力・動画ハッシュ](summary.json)／[検証記録](validation.json)
- [昼夕標本](sauna-12-samples.json)／[夕夜標本](sauna-27-samples.json)
- ローカル画像：[昼夕](sauna-12.jpg)／[夕夜](sauna-27.jpg)
- ローカル動画：[昼夕](sauna-12.mp4)／[夕夜](sauna-27.mp4)
