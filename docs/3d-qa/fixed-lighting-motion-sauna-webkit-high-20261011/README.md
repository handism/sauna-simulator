# WebKit高画質・室内固定視点の照明変化（2026-10-11）

[Chromeの同条件](../fixed-lighting-motion-sauna-high-20261011/README.md)に続き、Playwright WebKitでサウナの昼→夕暮れ・夕暮れ→夜を各195秒、観察中の見回し入力なしで録画する。製品描画・配信物・検査コードの変更なし。WebKitの結果を実Safariの検証とは扱わない。

1280×800・高画質・split・TAA on・full・動作抑制なし。録画前に一度だけ時計を12／27分へ進め、照明変化中は実時間でrAF／タイマーを進める。集計はエンジン・scope・視点モードの混入、見回し記録、入力ハッシュ変更、不完全な録画を拒否する。

```sh
MOTION_BROWSER=webkit MOTION_SCOPE=sauna MOTION_WARMUP=split MOTION_QUALITY=high MOTION_LOOK=fixed bun run test:browser:motion --reporter=json > /private/tmp/sauna-webkit-fixed-sauna-motion.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-webkit-fixed-sauna-motion.json docs/3d-qa/fixed-lighting-motion-sauna-webkit-high-20261011 --warmup split --browser webkit --quality high --look fixed --scope sauna
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/fixed-lighting-motion-sauna-webkit-high-20261011
python3 -m unittest discover -s scripts -p '*motion_frame*.py'
python3 -m unittest discover -s scripts -p 'test_surround_validation.py'
```

解析方法と限界はChromeの回と同じ。符号化25fpsは実描画FPSではなく、最大変化前後の画像確認は連続再生の知覚的なちらつき判定を代替しない。

## 結果

WebKit 26.6で2/2成功、計411.23秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。全標本で庭ready・高画質・split・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。最大標本間隔1.122秒、目標照明値との最大差0.008283。

| 経路 | 標本数 | 復号フレーム数 | 前フレームと同一 | 20秒窓数 | 2.5〜3.1Hz電力比 | 通常最大差 | キーフレーム付近最大差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| サウナ・昼→夕暮れ | 187 | 5,022 | 2,503 | 8 | 1.215 | 0.553 | 2.443 |
| サウナ・夕暮れ→夜 | 191 | 5,268 | 3,134 | 8 | 0.994 | 0.599 | 2.219 |

全10,290フレームのハッシュ・25fps全PTS・復号数を照合。各178秒の照明変化区間で8個の連続窓を確保した。変化区間の高周波が保持区間の2倍を超えるブロックは両経路とも0。

Chromeの室内（1.609／1.555）と同じく、電力比は2.5〜3.1Hzの鋭い山によるものではない（下半分輝度の上位周波数は1.05〜1.25Hzと2.35Hz付近、1〜12Hz平均の約4〜11倍）。室内は水の揺れの強い低周波がない分、屋外より比が大きく出やすく、ステージ間で比べない。前フレームと同一のフレーム数はChromeと同程度。エンジン間の差を性能や鏡像の比較として扱わない。

WebM／MP4の全デコード成功。等間隔24枚と通常最大差／キーフレーム付近最大差の前後12枚を目視。ベンチ・床・壁・天井・ストーブ・桶・窓枠と、ガラス越しの水風呂・デッキ・樹木に大きな形状欠落・黒抜けなし。キーフレーム付近に広範囲のぼけ・色の浅さが見える。描画側のちらつきや鏡像原因は断定しない。

解析13テスト・入力境界9テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。製品変更がないため通常回帰全体・soak・回線制限は再実行していない。

- [録画集計・ハッシュ](summary.json)／[全フレーム診断](frames.json)／[検証記録](validation.json)
- [昼→夕暮れ標本](sauna-12-samples.json)／[夕暮れ→夜標本](sauna-27-samples.json)
- ローカル動画：[昼→夕暮れ](sauna-12.mp4)／[夕暮れ→夜](sauna-27.mp4)
- ローカル最大変化画像：[昼→夕暮れ](sauna-12-frame-events.jpg)／[夕暮れ→夜](sauna-27-frame-events.jpg)

Chrome／WebKitの固定視点は屋外2経路・室内2経路が揃った。屋外の反対側照明経路、知覚的連続再生、連続全角度、自然発生MSL失敗の全文ログ、起動可能なFirefox、実Safari・非HDR実機・Windows・実モバイル・遅い端末、GPU実確保量・実聴は残件。既定2D・明示3D・split試験オプションを維持する。
