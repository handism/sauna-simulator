# Chrome高画質・屋外反対側経路の固定視点の照明変化（2026-10-11）

[屋外の固定視点](../fixed-lighting-motion-high-20261011/README.md)・[室内の固定視点](../fixed-lighting-motion-sauna-high-20261011/README.md)に続き、既存の `MOTION_SCOPE=outdoor-reverse` と `MOTION_LOOK=fixed` を組み合わせ、水風呂の夕暮れ→夜・外気浴の昼→夕暮れを各195秒、観察中の見回し入力なしで録画する。製品描画・配信物・検査コードの変更なし。

1280×800・高画質・split・TAA on・full・動作抑制なし。録画前に一度だけ時計を27／12分へ進め、照明変化中は実時間でrAF／タイマーを進める。集計は視点モード・scopeの混入、見回し記録、入力ハッシュ変更、不完全な録画を拒否する。

```sh
MOTION_SCOPE=outdoor-reverse MOTION_WARMUP=split MOTION_QUALITY=high MOTION_LOOK=fixed bun run test:browser:motion --reporter=json > /private/tmp/sauna-chrome-fixed-reverse-motion.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-chrome-fixed-reverse-motion.json docs/3d-qa/fixed-lighting-motion-reverse-high-20261011 --warmup split --quality high --look fixed --scope outdoor-reverse
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/fixed-lighting-motion-reverse-high-20261011
python3 -m unittest discover -s scripts -p '*motion_frame*.py'
python3 -m unittest discover -s scripts -p 'test_surround_validation.py'
```

解析方法と限界は既存の固定視点の回と同じ。全フレームを320×200のRec.709輝度へ縮小し、前フレームとの平均絶対差、照明変化区間の連続20秒窓で2.5〜3.1Hz帯の電力比（1〜12Hzの他帯域の平均電力比）を計算する。波・葉・TAA・露出・コーデック更新が混ざり、鏡像原因の証拠ではない。符号化25fpsは実描画FPSではなく、最大変化前後の画像確認は連続再生の知覚的なちらつき判定を代替しない。

## 結果

Chrome 154.0.8037.98で2/2成功、計403.97秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。全標本で庭ready・高画質・split・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。最大標本間隔1.115秒、目標照明値との最大差0.008324。資源数は形状128・テクスチャ34で一定。

| 経路 | 標本数 | 復号フレーム数 | 前フレームと同一 | 20秒窓数 | 2.5〜3.1Hz電力比 | 通常最大差 | キーフレーム付近最大差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 水風呂・夕暮れ→夜 | 189 | 5,026 | 24 | 8 | 0.317 | 3.182 | 2.767 |
| 外気浴・昼→夕暮れ | 189 | 5,064 | 2,921 | 8 | 0.459 | 0.782 | 2.439 |

全10,090フレームのハッシュ・25fps全PTS・復号数を照合。各178秒の照明変化区間で8個の連続窓を確保した。変化区間の高周波が保持区間の2倍を超えるブロックは両経路とも0。既存の屋外経路（水風呂昼→夕暮れ0.379、外気浴夕暮れ→夜0.636）と同じく、両経路とも対象帯域の電力比は1未満。

WebM／MP4の全デコード成功。等間隔24枚と通常最大差／キーフレーム付近最大差の前後12枚を目視。水風呂のタイル・縁・柱・庇・庭木、外気浴のパーゴラ・デッキ・石・飛び石・樹木に大きな形状欠落・黒抜けなし。キーフレーム付近に広範囲のぼけ・色の浅さが見える。水面左下のクリーム色の反射像は既知のもの。描画側のちらつきや鏡像原因は断定しない。

解析13テスト・入力境界9テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。製品変更がないため通常回帰全体・soak・回線制限は再実行していない。

- [録画集計・ハッシュ](summary.json)／[全フレーム診断](frames.json)／[検証記録](validation.json)
- [水風呂標本](water-27-samples.json)／[外気浴標本](totonou-12-samples.json)
- ローカル動画：[水風呂](water-27.mp4)／[外気浴](totonou-12.mp4)
- ローカル最大変化画像：[水風呂](water-27-frame-events.jpg)／[外気浴](totonou-12-frame-events.jpg)

[WebKitの同条件](../fixed-lighting-motion-reverse-webkit-high-20261011/README.md)も同日に記録した。
