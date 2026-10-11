# WebKit高画質・屋外反対側経路の固定視点の照明変化（2026-10-11）

[Chromeの同条件](../fixed-lighting-motion-reverse-high-20261011/README.md)に続き、Playwright WebKitで水風呂の夕暮れ→夜・外気浴の昼→夕暮れを各195秒、観察中の見回し入力なしで録画する。製品描画・配信物・検査コードの変更なし。WebKitの結果を実Safariの検証とは扱わない。

1280×800・高画質・split・TAA on・full・動作抑制なし。録画前に一度だけ時計を27／12分へ進め、照明変化中は実時間でrAF／タイマーを進める。集計はエンジン・視点モード・scopeの混入、見回し記録、入力ハッシュ変更、不完全な録画を拒否する。

```sh
MOTION_BROWSER=webkit MOTION_SCOPE=outdoor-reverse MOTION_WARMUP=split MOTION_QUALITY=high MOTION_LOOK=fixed bun run test:browser:motion --reporter=json > /private/tmp/sauna-webkit-fixed-reverse-motion.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-webkit-fixed-reverse-motion.json docs/3d-qa/fixed-lighting-motion-reverse-webkit-high-20261011 --warmup split --browser webkit --quality high --look fixed --scope outdoor-reverse
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/fixed-lighting-motion-reverse-webkit-high-20261011
python3 -m unittest discover -s scripts -p '*motion_frame*.py'
python3 -m unittest discover -s scripts -p 'test_surround_validation.py'
```

解析方法と限界はChromeの回と同じ。

## 結果

WebKit 26.6で2/2成功、計404.97秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。全標本で庭ready・高画質・split・本体／庭未描画0、照明終点・同一canvas・2D復帰を確認。最大標本間隔1.119秒、目標照明値との最大差0.008272。資源数は形状128・テクスチャ34で一定。

| 経路 | 標本数 | 復号フレーム数 | 前フレームと同一 | 20秒窓数 | 2.5〜3.1Hz電力比 | 通常最大差 | キーフレーム付近最大差 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 水風呂・夕暮れ→夜 | 189 | 5,054 | 237 | 8 | 0.286 | 2.950 | 2.507 |
| 外気浴・昼→夕暮れ | 189 | 5,079 | 2,809 | 8 | 0.704 | 0.919 | 2.442 |

Chromeの同条件（電力比0.317／0.459、同一フレーム24／2,921）と比べ、水風呂はやや低く、外気浴は高いが、両経路とも1未満。水風呂で前フレームと同一のフレームがChromeより多い傾向は既存の昼→夕暮れの回（471対31）と同じで、描画の更新間隔か録画側の重複かは切り分けない。エンジン間の差を性能や鏡像の比較として扱わない。

全10,133フレームのハッシュ・25fps全PTS・復号数を照合。各178秒の照明変化区間で8個の連続窓を確保した。変化区間の高周波が保持区間の2倍を超えるブロックは両経路とも0。

WebM／MP4の全デコード成功。等間隔24枚と通常最大差／キーフレーム付近最大差の前後12枚を目視。水風呂のタイル・縁・柱・庇・庭木、外気浴のパーゴラ・デッキ・石・飛び石・樹木に大きな形状欠落・黒抜けなし。キーフレーム付近に広範囲のぼけ・色の浅さが見える。水面左下のクリーム色の反射像はChromeと同じ位置に出ており、既知のもの。描画側のちらつきや鏡像原因は断定しない。

解析13テスト・入力境界9テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。製品変更がないため通常回帰全体・soak・回線制限は再実行していない。

- [録画集計・ハッシュ](summary.json)／[全フレーム診断](frames.json)／[検証記録](validation.json)
- [水風呂標本](water-27-samples.json)／[外気浴標本](totonou-12-samples.json)
- ローカル動画：[水風呂](water-27.mp4)／[外気浴](totonou-12.mp4)
- ローカル最大変化画像：[水風呂](water-27-frame-events.jpg)／[外気浴](totonou-12-frame-events.jpg)

屋外4経路・室内2経路の固定視点がChrome／WebKitで揃った。知覚的連続再生・連続全角度、自然発生MSL失敗の全文ログ、起動可能なFirefox、実Safari・非HDR実機・Windows・実モバイル・遅い端末、GPU実確保量・実聴は残件。既定2D・明示3D・split試験オプションを維持する。
