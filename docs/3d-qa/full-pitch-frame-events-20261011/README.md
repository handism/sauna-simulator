# 室内・屋外の元の照明経路：上下限見回し動画の短時間変化（2026-10-11）

直近の残件に沿い、既存のChrome 154.0.8037.98／WebKit 26.6・高画質・split・上下限見回し8動画を再解析した。室内の昼→夕／夕→夜、水風呂の昼→夕、外気浴の夕→夜が対象。動画SHA-256・標本と集計の条件・全25fps PTS・復号数を照合し、全40,825フレームを解析。製品・配信物・検査コードの変更なし。ブラウザの新規実行ではない。

320×200のRec.709輝度（0〜255）の前フレームとの平均絶対差。静止照明区間は見回しとその前後を除外し、20〜170秒の見回し区間を別集計する。波・葉・TAA・露出・動画圧縮を含むため、方式比較や性能評価には使わない。

| ブラウザ | 経路 | フレーム | 静止照明区間の最大差 | 見回し中の最大差 | 見回し中のキーフレーム付近の最大差 |
| --- | --- | ---: | ---: | ---: | ---: |
| Chrome | 室内・昼→夕 | 4,997 | 0.712 | 13.700 | 12.231 |
| Chrome | 室内・夕→夜 | 5,274 | 0.553 | 11.466 | 10.019 |
| Chrome | 水風呂・昼→夕 | 5,026 | 1.813 | 14.831 | 13.575 |
| Chrome | 外気浴・夕→夜 | 5,062 | 0.746 | 11.524 | 10.453 |
| WebKit | 室内・昼→夕 | 5,033 | 0.730 | 14.904 | 11.312 |
| WebKit | 室内・夕→夜 | 5,276 | 0.488 | 10.545 | 8.506 |
| WebKit | 水風呂・昼→夕 | 5,074 | 1.713 | 14.750 | 12.019 |
| WebKit | 外気浴・夕→夜 | 5,083 | 0.782 | 11.698 | 9.796 |

各動画で静止照明区間／見回し区間の通常最大差とキーフレーム付近最大差の前後3枚、計96枚を8一覧で目視した。室内の天井・窓枠・ベンチ、屋外の屋根・柱・壁・樹木・水面に大きな形状欠落・黒抜けは認めない。最大差付近には視点移動があり、キーフレーム付近では天井・庭・デッキ・水面などに一時的な広範囲のぼけが見える。水面の既知の明るい反射像は残る。圧縮動画の画像から描画側のちらつきや鏡像更新の原因は断定しない。

全8動画の静止照明区間は合計24秒ずつあるが、20秒連続の窓がない。周期帯解析は窓数0／比null（算出不可）。短い区間を連結して周期を判定しない。ページと動画の時計に共通マーカーがなく区間対応は概算。画像一覧は最大変化前後の確認であり、全動画の知覚的な連続再生評価・連続全角度・実描画FPS・GPU性能・ちらつき不存在を承認するものではない。

```sh
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-sauna-full-pitch-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-outdoor-full-pitch-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-sauna-full-pitch-webkit-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-outdoor-full-pitch-webkit-high
python3 -m unittest discover -s scripts -p '*motion_frame*.py'
```

- Chrome 室内：[全数集計](../warmup-sauna-full-pitch-high/frames.json)、ローカル画像 [室内・昼→夕](../warmup-sauna-full-pitch-high/sauna-12-frame-events.jpg)／[室内・夕→夜](../warmup-sauna-full-pitch-high/sauna-27-frame-events.jpg)
- Chrome 屋外：[全数集計](../warmup-outdoor-full-pitch-high/frames.json)、ローカル画像 [水風呂・昼→夕](../warmup-outdoor-full-pitch-high/water-12-frame-events.jpg)／[外気浴・夕→夜](../warmup-outdoor-full-pitch-high/totonou-27-frame-events.jpg)
- WebKit 室内：[全数集計](../warmup-sauna-full-pitch-webkit-high/frames.json)、ローカル画像 [室内・昼→夕](../warmup-sauna-full-pitch-webkit-high/sauna-12-frame-events.jpg)／[室内・夕→夜](../warmup-sauna-full-pitch-webkit-high/sauna-27-frame-events.jpg)
- WebKit 屋外：[全数集計](../warmup-outdoor-full-pitch-webkit-high/frames.json)、ローカル画像 [水風呂・昼→夕](../warmup-outdoor-full-pitch-webkit-high/water-12-frame-events.jpg)／[外気浴・夕→夜](../warmup-outdoor-full-pitch-webkit-high/totonou-27-frame-events.jpg)

解析11テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。製品変更がないため通常ブラウザ回帰・soak・回線制限は再実行していない。

既存の上下限見回し12動画は、先行する反対側屋外4動画と合わせて全フレーム解析・最大変化前後の画像確認が揃った。知覚的連続再生、連続全角度、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・実モバイル・遅い端末、GPU実確保量・音の実聴は残る。次に数値診断を進めるなら、見回しを含まない20秒以上の照明変化区間を別に録画して周期解析窓を確保する必要がある。既定2D・明示3D・split試験オプションを維持する。
