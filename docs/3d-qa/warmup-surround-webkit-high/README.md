# WebKit高画質の水平8方向×上下3位置の静止画比較

Chromeの同条件記録に続き、3ステージ×昼夕夜×8方向×上下3位置の216視点を、通常→分割→分割→通常のABBAで比較する。製品コード・配信物は変更しない。

```sh
VISUAL_BROWSER=webkit SURROUND_QUALITY=high bun run test:browser:visual e2e/warmup-surround.visual.ts --reporter=json > /private/tmp/sauna-surround-webkit-high.json
python3 scripts/summarize_warmup_surround.py /private/tmp/sauna-surround-webkit-high.json docs/3d-qa/warmup-surround-webkit-high/summary.json --quality high
```

WebKit・1200×800・DPR1・高画質・固定解像度・full・動作抑制あり。高画質は入室前に保存する。庭ready後、各視点で70 rAF待ち、DOM演出を除いてcanvasを撮影する。水平は矢印10回ずつの0.8rad間隔（正確な45度ではない）、上下は製品制限±0.85radと中間約−0.01rad。同一canvasで3ステージを巡る。

集計はABBA順・成功4件・再試行／skip／flakyなし・入力ハッシュ・画像ハッシュ／寸法・全216視点の順・画質・庭ready・分割完了／未描画0を照合する。通常／分割の2組と同方式再撮影差を分ける。画像と一覧はローカルのみ、集計JSONを追跡する。

WebKitは実Safariではない。離散した静止画の確認であり、連続する全角度・動的ちらつき・性能・GPU総メモリ・実機・音の実聴を承認しない。既定2D・明示3D・split試験オプションを維持する。

## 結果（2026-10-10）

WebKit 26.6で4/4成功、計1209.37秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。庭取得は各1回、全ステージで同一canvasを保持。[入力・画像ハッシュと比較JSON](summary.json)。864枚すべての条件照合に成功。

通常1→分割1、通常2→分割2、通常1→通常2、分割1→分割2の全4比較で、216視点すべてRGB全画素一致（変化画素0、RGB成分最大差0）。今回の静止条件で分割方式固有の差は確認されない。Chromeとは検証設定の入力ハッシュが異なるため、同一入力のブラウザ横断比較として集約しない。

分割1回目の9一覧（全216視点）を目視。天井・壁・ベンチ・窓枠・タイル・椅子・屋根・樹木の大きな形状欠落・黒抜けなし。水面の明るいクリーム色の反射像は残る。全原寸画像の細部を個別に承認したものではない。

型検査、48ファイル321単体テスト、Lint、整形、本番ビルド、差分チェック成功。初回プレビュー起動制限後、許可環境で再実行。製品・配信物に変更がないため通常回帰全体・soak・回線制限は再実行しない。

高画質の離散した角度組合せ比較はChrome／WebKitで記録が揃った。連続する全水平×俯仰・知覚的連続映像、自然発生MSL失敗の全文ログ、起動可能なFirefox、非HDR実機・Windows・実モバイル・遅い端末、GPU実確保量・音の実聴は残件。
