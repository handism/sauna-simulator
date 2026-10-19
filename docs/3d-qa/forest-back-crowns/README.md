# 奥の森の樹冠の補完（2026-10-19）

## 変更

基準は `17e77d7`。奥54mの帯のうち、従来の手前73樹冠・中間19樹冠で覆われずに平面の輪郭が露出していた18か所へ、小さな立体の樹冠を補った。大小3葉群を各4段×8分割の閉じた形状とし、中心半径51.9〜52.1m、頂部は元の樹冠より0.1m低く、幅は従来の手前の76%。底は地形の下へ埋める。帯に合わせた固定世界方向の近似陰影を頂点色へ掛ける。季節・時間帯・曇天・霞・解放経路は既存のものを共用する。

1メッシュ・1材質のまま。森の三角形は30,188→32,780（+2,592）、頂点属性配列は4,347,072→4,720,320 bytes（+373,248）。新しいテクスチャ・光源・影パスはない。配列サイズはGPU総確保量ではない。GLB・プローブ・2D・前回のTAA補正は変更しない。冬の広葉樹は既存と同じ灰褐色の樹冠近似で、枝モデルにはしていない。

## 静止画と目視

- Chrome 155.0.8059.80、1280×800、標準DPR1・固定解像度・動作抑制・夏晴れ。3ステージ×昼夕夜×水平3方位（初期から0／91.7／275.0度）と、外気浴正面の秋冬の昼を、前→後→後→前で撮影。29枚×4件、計116 PNG。全4件成功、ページ／console errorなし。方位変更ごとに実際の見回し要素へフォーカスし、前の方位と画像が十分変わることも検査した。
- 同一最終ビルドの `gardenEdge=20000` の新しい樹冠だけを、検証ブラウザのfragment shaderで省いた対照。既存の帯・手前／中間の樹冠は維持。同じビルド・素材・ブラウザであり、差は追加樹冠の可視部分。配信JSのファイル名とHTTP応答のSHA-256を検査した。
- 実際の旧ビルドとの照合も行い、外気浴昼・右20キー分の原寸PNGは、同一ビルドの省略対照と全画素一致した（`equivalence/comparison.json`）。
- 修正後の静止画の同方式再撮影は全29条件で全画素一致。前後差は0〜4,551画素が1 RGB階調を超えた。これは変更範囲であり画質向上率ではない。室内の壁等に遮られて変化が見えない条件もある（`static/comparison.json`）。
- 外気浴正面・275度の昼の前後一覧、右20キー分の昼の原寸前後を表示して確認。奥の一部に肩の明暗と重なりが増えるが、変化は控えめで、平面の帯全体の印象は残る。確認範囲に新しい大きな欠け・黒抜け・浮いた底は見当たらなかった。全原寸・全周・連続動画の画質合格ではない。

## 制御した見回し

旧ビルド→新→新→旧の独立ビルドABBA。各回、実際に読み込んだJSのURLとHTTP応答SHA-256を検査した。標準DPR1.5、1200×800 CSS px、夏晴れ・昼夕・動作抑制・固定解像度、比較用カメラ（`?camera=review`）を右60キー分向け、1 CSS px（yaw 0.004rad）ずつ12ステップ。実アプリのrAFを撮影中は保留し、各ステップ2フレームだけ進めた。3ステージ×昼夕×13枚を4回、計312 PNG。4件とも成功。

水風呂・外気浴では新しい樹冠が実際に見えていることを画像差でも確認した。サウナのこの方向は室内に遮られるため、追加樹冠の見回し評価にはならない。回転を補償したL*残差の前後比は、画素0.9993〜1.0000、面1.0000、面の99百分位0.9995〜1.0000。残差自体を小数4桁へ丸めた集計値による比である。同方式再撮影の比はすべて1.000。この条件・精度で残差の増加は検出しなかったという結果で、知覚的なちらつきや残像の合格ではない（`motion/comparison.json`）。

## 負荷

同一ビルドのfragment discardは使わず、実際の旧形状を含む旧ビルドと比較した。Chrome 155、1280×800、標準DPR1、固定解像度・動作抑制、3ステージの水平・右20キー分の昼夜6条件。描画3回反復のrAF間隔の平均÷3を、各版の予備実行を含め、前→後→後→前で測った。計6件成功。撮影・画像解析・別の検証と同時に測定していない。

後／前の12組は0.994〜1.006倍。全条件で描画回数・ジオメトリ数・テクスチャ数は同じ、主描画の三角形だけ+2,592を検査した。今回の条件では大きな増加を検出しなかったが、費用ゼロ・速度改善・実機FPS・GPU単体時間・GPU総メモリの証明ではない。数値と元報告は `cost.json`、`cost-{before1,after1,after2,before2}.json`。

## 回帰と実装検査

- 全頂点の半径・高さ・有限値、帯の境界接続、追加葉群の閉じた辺の共有と三角形数の上限を単体テストで検査。441単体テスト成功。
- 庭・季節9件、HDRの反復モード／ステージ移動／実コンテキスト喪失後の復帰1件、非HDR相当3画質の表示／復帰3件、計13件成功。失敗・skip・retryなし。通常ブラウザ回帰の全件ではない。
- 型検査・Lint・整形・本番ビルド・Python構文・差分チェックはすべて成功。3Dチャンク905.85kB（gzip250.27kB）、2D入口230.92kB（gzip73.79kB）。既存850kB警告は継続。

## 除外した診断

初回の静止画は時間帯メニューにフォーカスが残り、方位ラベルに重複があったため除外し、フォーカスと画像差の検査を足して全4件を撮り直した。また設定継承で検証サーバーが配列として追加され、最初の旧ビルド指定でも新ビルドを配信したため、その比較も除外した。単一設定オブジェクトでサーバーを置換し、配信JSのハッシュ検査を追加して取り直した。除外した結果は成功数・改善判断に含めない。理由・原報告ハッシュ・ローカル保存先は `discarded-diagnostics.json`。

## 再実行

変更前の本番 `dist` と `farForest.before.ts` を同じ親ディレクトリへ退避してから変更後をビルドする。既定の配信は現在の `dist`、`FOREST_BASELINE_DIST=/path/to/before-dist` を指定するとその旧ビルドを使う。モデル等も含めてコピーし、入力ハッシュを照合する。

```sh
bun run build
bunx playwright test --config playwright.visual.config.ts e2e/forest-back-crowns.visual.ts --reporter=json > /tmp/forest-static.json
# test-results/visual を保存してから次の撮影へ進む。
python3 scripts/summarize_forest_back_crowns.py /tmp/forest-static.json <captures-root> <out>

FOREST_REVIEW=visual SHIMMER_ABBA=0 SHIMMER_FIXED=1 SHIMMER_CONTROLLED=1 \
  SHIMMER_RATIOS=1.5 SHIMMER_HEADING_STEPS=60 SHIMMER_QUERY='&camera=review' \
  bunx playwright test --config playwright.forest.config.ts e2e/resolution-shimmer.visual.ts --reporter=json
# 旧→新→新→旧で各回の画像・report.jsonを motion/<run>/ へ保存。
python3 scripts/summarize_forest_back_crowns.py --motion <motion-root>

FOREST_COST_RUNS=warmup,before1 FOREST_BASELINE_DIST=/path/to/before-dist \
  bunx playwright test --config playwright.forest.config.ts e2e/forest-back-crowns.gpu.ts --reporter=json
# 新側はFOREST_BASELINE_DISTを外す。最初の各版はwarmupを含め、その後after2/before2。
python3 scripts/summarize_forest_back_crowns.py --cost <before1.json> <after1.json> <after2.json> <before2.json> <out>
```

画像はローカルのみ、README・JSONをGit管理する。今回の静止画は水平3方位の限定比較で、全周・他の季節天気や高画質の網羅ではない。実Safari・モバイル実機・連続見回しの知覚的合否・音の実聴は未確認。固定の陰影・冬の樹冠・既存プローブを共用する近似は残る。
