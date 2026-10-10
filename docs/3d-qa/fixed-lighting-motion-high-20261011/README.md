# Chrome高画質・固定視点の照明変化（2026-10-11）

上下限見回しの既存動画は、見回しを除いた照明変化区間に20秒連続の周期解析窓がなかった。`MOTION_LOOK=fixed` を追加し、水風呂の昼→夕暮れ・外気浴の夕暮れ→夜を各195秒、観察中の見回し入力なしで録画する。製品描画・配信物の変更なし。

1280×800・高画質・split・TAA on・full・動作抑制なし。録画前に一度だけ時計を12／27分へ進め、照明変化中は実時間でrAF／タイマーを進める。集計は視点モード混入・見回し記録・入力ハッシュ変更・不完全な録画を拒否する。

```sh
MOTION_WARMUP=split MOTION_QUALITY=high MOTION_LOOK=fixed bun run test:browser:motion --reporter=json > /private/tmp/sauna-fixed-motion.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-fixed-motion.json docs/3d-qa/fixed-lighting-motion-high-20261011 --warmup split --browser chromium --quality high --look fixed
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/fixed-lighting-motion-high-20261011
python3 -m unittest discover -s scripts -p '*motion_frame*.py'
python3 -m unittest discover -s scripts -p 'test_surround_validation.py'
```

全フレームを320×200のRec.709輝度へ縮小し、前フレームとの平均絶対差、照明変化区間の連続20秒窓で2.5〜3.1Hz帯の電力比を計算する。電力比は1〜12Hzの他の帯域の平均電力に対する値。0.002の鏡像更新キーから想定される0.36秒周期付近だが、波・葉・TAA・露出・コーデック更新も混ざり、鏡像原因の証拠ではない。ページと動画の時計の対応は概算で、符号化25fpsは実描画FPSではない。最大変化前後の画像確認は連続再生の知覚的なちらつき判定を代替しない。

## 結果

Chrome 154.0.8037.98で2/2成功、計404.40秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。全標本で庭ready・高画質・split・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。最大標本間隔1.115秒未満、目標照明値との最大差0.008303未満。

| 経路 | 標本数 | 復号フレーム数 | 20秒窓数 | 2.5〜3.1Hz電力比 | 通常最大差 | キーフレーム付近最大差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 水風呂・昼→夕暮れ | 187 | 5,028 | 8 | 0.379 | 2.532 | 3.152 |
| 外気浴・夕暮れ→夜 | 189 | 5,068 | 8 | 0.636 | 0.822 | 2.210 |

全10,096フレームのハッシュ・25fps全PTS・復号数を照合。各178秒の照明変化区間で8個の連続窓を確保できた。今回の下半分の平均輝度では対象帯域の平均電力は他帯域より低いが、局所的変化や知覚的ちらつきがないという意味ではない。通常／分割の比較や鏡像原因の切り分けでもない。

WebM／MP4の全デコード成功。等間隔24枚と通常最大差／キーフレーム付近最大差の前後12枚を目視。水風呂のタイル・壁・水面、外気浴のデッキ・屋根・柱・樹木に大きな形状欠落・黒抜けなし。キーフレーム付近に広範囲のぼけが見え、水面の既知の明るい反射像は残る。描画側のちらつきや鏡像原因は断定しない。

解析13テスト・入力境界9テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。初回はプレビュー起動制限で実行0件、許可環境で再実行した。製品変更がないため通常回帰全体・soak・回線制限は再実行していない。

- [録画集計・ハッシュ](summary.json)／[全フレーム診断](frames.json)／[検証記録](validation.json)
- [水風呂標本](water-12-samples.json)／[外気浴標本](totonou-27-samples.json)
- ローカル動画：[水風呂](water-12.mp4)／[外気浴](totonou-27.mp4)
- ローカル最大変化画像：[水風呂](water-12-frame-events.jpg)／[外気浴](totonou-27-frame-events.jpg)

次はWebKitで同じ固定視点2経路を確認できる。反対側照明経路・室内・知覚的連続再生・連続全角度、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・実モバイル・遅い端末、GPU実確保量・実聴は残件。既定2D・明示3D・split試験オプションを維持する。
