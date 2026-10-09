# WebKit高画質の分割準備後の自動照明と見回し（2026-10-09）

WebKit 26.6・macOS headless、1280×800・高画質・動作抑制なし・`frameRate=full`。実Safariの検証ではない。製品コード・配信物・テストの変更はない。

水風呂の昼→夕暮れ（12〜15分）、外気浴の夕暮れ→夜（27〜30分）を各195秒観察。開始前の保持時間だけをDate.nowのオフセットで省き、その後は時計・rAF・タイマーを実時間で進める。50〜70秒と110〜130秒に左右約±0.5radの見回しを行う。

入室前から高画質を指定し、全標本で高画質・自動照明・庭ready・分割完了・本体／庭の未描画グループ0を要求。照明値の単調増加と終点到達、目標との差0.025未満、時計差250ms未満、標本間隔5秒未満、同一canvas維持・2D復帰・エラーなしを検査する。集計はブラウザ・方式・画質の混入、失敗・欠落・入力ハッシュ変更を拒否し、WebMとMP4を全デコードする。

```sh
MOTION_BROWSER=webkit MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-webkit-high-split-motion.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-webkit-high-split-motion.json docs/3d-qa/warmup-auto-motion-webkit-high --warmup split --browser webkit --quality high
```

## 結果

2件成功、計405.56秒。失敗・skip・flaky・再試行なし、ページ／コンソールエラーなし。

| 条件 | 観察時間 | 標本数 | 照明値 | 目標との差の最大値 |
| --- | ---: | ---: | --- | ---: |
| 水風呂・昼→夕暮れ | 195.10秒 | 189 | 0→1 | 0.00826 |
| 外気浴・夕暮れ→夜 | 195.12秒 | 185 | 1→2 | 0.00831 |

全標本で高画質・分割完了・本体／庭の未描画グループ0。照明終点・同一canvas・2D復帰を確認。ジオメトリ128・テクスチャ34は一定だが、GPU実確保量やリーク不存在の証明ではない。

WebM・MP4の全デコード成功。抽出24枚を目視し、水風呂のタイル・水面、外気浴のデッキ・樹木が見回し方向でも保たれ、夕暮れ／夜への空の変化を確認。大きな形状欠落・黒抜けは見られない。水面左端のクリーム色の反射像は残る。短時間のちらつき・鏡像更新の段差は未判定。

型検査、48ファイル316単体テスト、Lint、整形、本番ビルド、差分チェック成功。初回プレビュー起動制限後、許可環境で再実行。通常ブラウザ回帰全体・soak・回線制限・全周画像は今回再実行していない。

動画の符号化fpsはアプリのfpsではなく、抽出画像は連続再生による知覚的な合否を保証しない。通常／分割の動画画素比較、サウナの動的視点・全方向、非HDR実機、実Safari・Windows・モバイル・遅い端末、GPU確保量、音の実聴は残件。既定2Dと分割準備の試験オプションを維持する。

- [集計・入力と動画のハッシュ](summary.json)／[検証記録](validation.json)
- [水風呂の標本](water-12-samples.json)／[外気浴の標本](totonou-27-samples.json)
- ローカル動画：[水風呂](water-12.mp4)／[外気浴](totonou-27.mp4)
- ローカル画像一覧：[水風呂](water-12.jpg)／[外気浴](totonou-27.jpg)
