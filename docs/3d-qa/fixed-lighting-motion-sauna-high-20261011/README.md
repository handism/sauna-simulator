# Chrome高画質・室内固定視点の照明変化（2026-10-11）

[屋外の固定視点](../fixed-lighting-motion-high-20261011/README.md)に続き、既存の `MOTION_SCOPE=sauna` と `MOTION_LOOK=fixed` を組み合わせ、サウナの昼→夕暮れ・夕暮れ→夜を各195秒、観察中の見回し入力なしで録画する。製品描画・配信物・検査コードの変更なし。

1280×800・高画質・split・TAA on・full・動作抑制なし。録画前に一度だけ時計を12／27分へ進め、照明変化中は実時間でrAF／タイマーを進める。集計は視点モード・scopeの混入、見回し記録、入力ハッシュ変更、不完全な録画を拒否する。

```sh
MOTION_SCOPE=sauna MOTION_WARMUP=split MOTION_QUALITY=high MOTION_LOOK=fixed bun run test:browser:motion --reporter=json > /private/tmp/sauna-chrome-fixed-sauna-motion.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-chrome-fixed-sauna-motion.json docs/3d-qa/fixed-lighting-motion-sauna-high-20261011 --warmup split --quality high --look fixed --scope sauna
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/fixed-lighting-motion-sauna-high-20261011
python3 -m unittest discover -s scripts -p '*motion_frame*.py'
python3 -m unittest discover -s scripts -p 'test_surround_validation.py'
```

解析方法と限界は屋外の回と同じ。全フレームを320×200のRec.709輝度へ縮小し、前フレームとの平均絶対差、照明変化区間の連続20秒窓で2.5〜3.1Hz帯の電力比（1〜12Hzの他帯域の平均電力比）を計算する。符号化25fpsは実描画FPSではなく、最大変化前後の画像確認は連続再生の知覚的なちらつき判定を代替しない。

## 結果

Chrome 154.0.8037.98で2/2成功、計411.12秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。全標本で庭ready・高画質・split・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。最大標本間隔1.087秒、目標照明値との最大差0.008297。

| 経路 | 標本数 | 復号フレーム数 | 前フレームと同一 | 20秒窓数 | 2.5〜3.1Hz電力比 | 通常最大差 | キーフレーム付近最大差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| サウナ・昼→夕暮れ | 189 | 4,995 | 2,504 | 8 | 1.609 | 0.594 | 2.471 |
| サウナ・夕暮れ→夜 | 189 | 5,270 | 3,005 | 8 | 1.555 | 0.544 | 2.293 |

全10,265フレームのハッシュ・25fps全PTS・復号数を照合。各178秒の照明変化区間で8個の連続窓を確保した。変化区間の高周波が保持区間の2倍を超えるブロックは両経路とも0。

電力比は屋外（0.379／0.636）より高く1を超えるが、2.5〜3.1Hzに鋭い山があるためではない。同じ窓の下半分輝度のスペクトル（記録外の一時確認）は、上位の周波数でも1〜12Hz平均の約4倍にとどまり、2.35Hz・11.7Hz・2.75Hzなどに散らばっていた。屋外は水の揺れの1〜1.4Hzが平均の約32倍あり分母を押し上げていたため、この比はステージ間で比べない。室内の画面下半分はベンチ・床が主で、鏡像の水面はガラス越しの中央にしか写らない。

WebM／MP4の全デコード成功。等間隔24枚と通常最大差／キーフレーム付近最大差の前後12枚を目視。ベンチ・床・壁・天井・ストーブ・桶・窓枠と、ガラス越しの水風呂・デッキ・樹木に大きな形状欠落・黒抜けなし。キーフレーム付近に広範囲のぼけ・色の浅さが見える。描画側のちらつきや鏡像原因は断定しない。

解析13テスト・入力境界9テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。製品変更がないため通常回帰全体・soak・回線制限は再実行していない。

- [録画集計・ハッシュ](summary.json)／[全フレーム診断](frames.json)／[検証記録](validation.json)
- [昼→夕暮れ標本](sauna-12-samples.json)／[夕暮れ→夜標本](sauna-27-samples.json)
- ローカル動画：[昼→夕暮れ](sauna-12.mp4)／[夕暮れ→夜](sauna-27.mp4)
- ローカル最大変化画像：[昼→夕暮れ](sauna-12-frame-events.jpg)／[夕暮れ→夜](sauna-27-frame-events.jpg)

[WebKitの同条件](../fixed-lighting-motion-sauna-webkit-high-20261011/README.md)も同日に記録した。
