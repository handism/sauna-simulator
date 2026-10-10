# 高画質動画の短時間変化の診断（2026-10-09）

Chrome 154.0.8037.98／WebKit 26.6の既存高画質・分割準備の8動画を再解析した。3ステージ、サウナ室の昼→夕／夕→夜、水風呂の昼→夕、外気浴の夕→夜。製品コード・配信GLBの変更なし。

## 既存動画

`analyze_auto_motion_frames.py` で全40,804フレームを復号。RGBの一時バッファをファイルへ移し、全フレームのPTSが25fps間隔であること、復号数との一致、動画ハッシュ・標本と集計の条件を検査した。数字は320×200のRec.709輝度（0〜255）で、波・葉・TAA・圧縮の変化を含む。見回しとその前後を除いた照明変化区間130秒と変化後13秒を比較する。

| ブラウザ | 条件 | 通常フレーム差の最大値 | キーフレーム付近の最大値 |
| --- | --- | ---: | ---: |
| Chrome | サウナ 昼→夕 | 0.686 | 2.470 |
| Chrome | サウナ 夕→夜 | 0.546 | 2.293 |
| WebKit | サウナ 昼→夕 | 0.615 | 2.430 |
| WebKit | サウナ 夕→夜 | 0.567 | 2.216 |
| Chrome | 水風呂 昼→夕 | 2.298 | 2.495 |
| Chrome | 外気浴 夕→夜 | 0.769 | 2.205 |
| WebKit | 水風呂 昼→夕 | 2.162 | 2.770 |
| WebKit | 外気浴 夕→夜 | 0.661 | 2.108 |

各動画で通常差とキーフレーム付近の最大差の前後3枚、計48枚を目視した。キーフレーム付近では木目・樹木・空・デッキなど広範囲の一時的なぼけがあり、鏡像だけの変化とは一致しない。通常差の最大位置では大きな形状欠落・黒抜けを認めない。水風呂左端には、既存の水底部分反射による[寝椅子灯の像](../auto-lighting/README.md#追記水面のクリーム色の斑の正体2026-09-29)も見える。

20×20画素の高域差ブロックで「変化後の2倍かつ0.3超」は8動画とも0。鏡像更新の約2.8Hz帯の電力比は0.420〜1.074で、周期の明確な突出をこの指標では見出していない。この閾値・指標は知覚的な合否基準ではない。

動画時刻とページのperformance時計には共通の記録マーカーがない。観察時刻への対応は概算で、連続PNGを撮った瞬間の証拠ではない。キーフレーム付近は圧縮と描画が混在し、動画だけではちらつき不存在や鏡像の原因を証明できない。従来の端点差÷500は個別更新の上限にならないため、出力名を `endpointChangeDividedBy500` に改め、記述統計として扱う。

```sh
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-sauna-motion-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-sauna-motion-webkit-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-auto-motion-high
python3 scripts/analyze_auto_motion_frames.py docs/3d-qa/warmup-auto-motion-webkit-high
```

各フォルダの `frames.json` にハッシュ・全数・区間の数値、ローカルの `*-frame-events.jpg` に最大差前後の画像を保存する。画像・動画はGitに含めない。

## PNGでの鏡像更新比較

圧縮の影響を除くため `e2e/mirror-steps.visual.ts` を追加。高画質・分割準備・固定解像度・水風呂の静止視点で、昼→夕／夕→夜の中間点から1秒を60Hzの制御時刻で進め、61枚ずつPNGを撮る。撮影中はアプリのrAFを保留し、波・照明・TAAが進まないことをフレーム数で確認する。

製品の0.002刻みの鏡像キーと、検証ブラウザへ返すバンドルだけで連続値へ変えた診断条件をABBAで比較する。置換対象は1箇所を要求し、応答の変更前後のハッシュを保存。製品コード・配信物は変更しない。モード差と同モードの再撮影差を別々に記録する。実時間動画・性能や全方向の検証ではなく、読み込みごとの波の初期位相も一致を保証しない。

```sh
bun run build
bunx playwright test --config playwright.mirror.config.ts --reporter=json > /private/tmp/sauna-mirror-chrome.json
python3 scripts/summarize_mirror_steps.py /private/tmp/sauna-mirror-chrome.json docs/3d-qa/mirror-steps-chrome --browser chromium
MIRROR_BROWSER=webkit bunx playwright test --config playwright.mirror.config.ts --reporter=json > /private/tmp/sauna-mirror-webkit.json
python3 scripts/summarize_mirror_steps.py /private/tmp/sauna-mirror-webkit.json docs/3d-qa/mirror-steps-webkit --browser webkit
```

実Safari・Windows・モバイル・非HDR実機、全方向の実時間見回し、GPU実確保量、音の実聴は別の残件。既定2Dと分割準備の試験オプションを維持する。

### PNG比較の結果

Chromeで8件・177.27秒、WebKitで8件・121.54秒成功。失敗・skip・再試行・ページ／コンソールエラーなし。計976枚のPNGをハッシュ照合してローカルQAフォルダへ保存した。集計はskip・異なるエンジン・画質混入・フレーム欠落・入力ハッシュ不一致の5改変を拒否した（[記録](rejection-checks.json)）。動画解析の拒否境界4件と合わせ、診断用の検査も成功。

制御区間で製品の鏡像キーは各回1回、連続更新条件では60回変化した。昼→夕の製品で、キー変更時の下半分平均輝度差はChrome 0.332／0.342、WebKit 0.333／0.338、キー保持時の平均は約0.335。夕→夜もキー変更時0.264〜0.285、保持時約0.277。この区間・指標ではキー変更時の突出した変化を見出していない。

方式間の平均RGB差は0.010〜1.098、同方式の製品再撮影差は0.521〜1.114。方式間の画素差だけで鏡像更新に帰属できない。最大差前後の計48枚を目視し、形状欠落・黒抜けを認めないが、連続した知覚的ちらつきの合否は判定しない。光の平滑化は静止中間点から開始しているため、定常速度で180秒進む照明の全更新を代表する記録でもない。

この結果から毎フレーム更新を製品へ採用する根拠は得ていない。製品の0.002刻みを維持する。録画圧縮の混在と短い静止視点での更新比較の診断は完了し、広い見回し範囲の実時間検証へ進む。

- Chrome：[集計](../mirror-steps-chrome/summary.json)／ローカル画像 [一覧](../mirror-steps-chrome/peaks.jpg)
- WebKit：[集計](../mirror-steps-webkit/summary.json)／ローカル画像 [一覧](../mirror-steps-webkit/peaks.jpg)
