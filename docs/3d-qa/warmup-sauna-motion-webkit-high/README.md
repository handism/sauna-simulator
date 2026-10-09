# WebKit高画質サウナ室の自動照明と見回し（2026-10-09）

WebKit 26.6・macOS headless、1280×800・高画質・分割準備・動作抑制なし・`frameRate=full`。製品コード・配信物・テストの変更なし。

室内の昼→夕暮れと夕暮れ→夜を各195秒観察し、50〜70秒と110〜130秒に左右約±0.5radの見回しを行う。開始前の保持時間のみDate.nowのオフセットで省略し、その後の時計・rAF・タイマーは実時間で進める。

```sh
MOTION_BROWSER=webkit MOTION_QUALITY=high MOTION_SCOPE=sauna MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-webkit-sauna-high.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-webkit-sauna-high.json docs/3d-qa/warmup-sauna-motion-webkit-high --scope sauna --warmup split --browser webkit --quality high
```

## 結果

2件成功、計411.23秒。失敗・skip・flaky・再試行なし、ページ／コンソールエラーなし。初回のプレビュー起動制限後、許可環境で再実行した。

| 条件 | 観察時間 | 標本数 | 照明値 | 目標との差の最大値 |
| --- | ---: | ---: | --- | ---: |
| 室内・昼→夕暮れ | 195.039秒 | 188 | 0→1 | 0.008283 |
| 室内・夕暮れ→夜 | 195.099秒 | 189 | 1→2 | 0.008278 |

全標本でサウナ・高画質・分割完了・本体／庭の未描画グループ0。照明終点・同一canvas・2D復帰を確認。ジオメトリ128・テクスチャ34は一定だが、GPU実確保量やリーク不存在の証明ではない。

WebMとMP4の全デコード成功。抽出24枚を目視し、ベンチ・ストーブ・窓枠と窓越しの庭が見回し中も保たれ、夕暮れ／夜への変化を確認した。大きな形状欠落・黒抜けは見られない。短時間のちらつき・鏡像更新の段差は未判定。

型検査、48ファイル316単体テスト、Lint、整形、本番ビルド、差分チェック成功。通常回帰全体・soak・回線制限・全周画像は今回再実行していない。

次の作業は、既存動画で未判定の短時間のちらつき・鏡像更新の段差の診断。全方向、非HDR実機、実Safari・Windows・モバイル・遅い端末、Firefox、GPU実確保量、音の実聴も残る。WebKitは実Safariではなく、動画の符号化fpsもアプリのfpsではない。既定2Dと分割準備の試験オプションを維持する。

- [集計・入力と動画のハッシュ](summary.json)／[検証記録](validation.json)
- [昼→夕暮れの標本](sauna-12-samples.json)／[夕暮れ→夜の標本](sauna-27-samples.json)
- ローカル動画：[昼→夕暮れ](sauna-12.mp4)／[夕暮れ→夜](sauna-27.mp4)
- ローカル画像一覧：[昼→夕暮れ](sauna-12.jpg)／[夕暮れ→夜](sauna-27.jpg)
