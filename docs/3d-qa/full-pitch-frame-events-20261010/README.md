# 上下限見回し動画の短時間変化（2026-10-10）

既存の高画質・split・上下限見回し動画から、Chrome 154.0.8037.98／WebKit 26.6の水風呂・夕→夜、外気浴・昼→夕の4動画を再解析。全20,251フレームの動画ハッシュ・25fpsの全PTS・復号数・標本条件を照合した。製品コード・配信物の変更なし。今回ブラウザを再実行していない。

従来の照明変化区間（見回しとその前後を除く）・変化後区間に加え、20〜170秒の見回し区間を別に集計。320×200のRec.709輝度（0〜255）の前フレームとの差であり、視点移動・波・葉・TAA・露出・圧縮の変化を含む。画質評価やブラウザ間の性能比較には使わない。

| ブラウザ | 経路 | フレーム | 静止照明区間の最大差 | 見回し中の最大差 | 見回し中のキーフレーム付近の最大差 |
| --- | --- | ---: | ---: | ---: | ---: |
| Chrome | 水風呂・夕→夜 | 5,032 | 3.225 | 12.975 | 10.329 |
| Chrome | 外気浴・昼→夕 | 5,070 | 0.778 | 14.965 | 12.983 |
| WebKit | 水風呂・夕→夜 | 5,069 | 1.797 | 12.449 | 10.310 |
| WebKit | 外気浴・昼→夕 | 5,080 | 0.701 | 17.872 | 12.937 |

各動画で静止照明区間／見回し区間の通常最大差とキーフレーム付近最大差の前後3枚、計48枚を目視。見回しの最大差では柱・樹木・屋根・壁・水面の位置が変わっており、視点移動を含む。キーフレーム付近では樹木やデッキ等に一時的な広範囲のぼけが見える。大きな形状欠落・黒抜けは認めない。水面の既知の明るい反射像は残る。最大位置の静止画確認であり、全動画の知覚的な連続再生評価ではない。

静止照明区間は合計24秒あるが、20秒連続する区間はない。鏡像周期帯の解析窓数は0で、比は `null`（算出不可）。短い区間を連結して周期を捏造しない。従来スクリプトで窓不足時にNaNになり得た境界を修正し、ゼロ電力も算出不可にした。`look` の標本／集計不一致を拒否する。

ページと動画の時計に共通マーカーはなく区間対応は概算。JPEG一覧は圧縮動画からの抽出で、ちらつき不存在・鏡像原因・連続角度の網羅・FPS・GPU性能の証拠ではない。毎フレームの鏡像更新など製品変更の根拠は得ていない。

```sh
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-outdoor-reverse-full-pitch-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-outdoor-reverse-full-pitch-webkit-high
python3 -m unittest discover -s scripts -p 'test*motion_frame*.py'
```

- Chrome：[全数集計](../warmup-outdoor-reverse-full-pitch-high/frames.json)、ローカル画像 [水風呂](../warmup-outdoor-reverse-full-pitch-high/water-27-frame-events.jpg)／[外気浴](../warmup-outdoor-reverse-full-pitch-high/totonou-12-frame-events.jpg)
- WebKit：[全数集計](../warmup-outdoor-reverse-full-pitch-webkit-high/frames.json)、ローカル画像 [水風呂](../warmup-outdoor-reverse-full-pitch-webkit-high/water-27-frame-events.jpg)／[外気浴](../warmup-outdoor-reverse-full-pitch-webkit-high/totonou-12-frame-events.jpg)

解析の11テスト、型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。通常回帰・soak・回線制限は再実行していない。次は室内と屋外の元の照明経路の上下限動画を同様に解析できる。知覚的連続映像確認、実Safari・実機・GPU実確保量・実聴等の残件は継続。既定2D・明示3D・split試験オプションを維持する。
