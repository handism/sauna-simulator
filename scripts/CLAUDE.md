# GLB書き出し・シーン定義（scripts）

- 体験用視点と水面位置の正本は `scripts/web_scene.py`。`python3 scripts/web_scene.py` でシーン定義だけ再生成できる。GLB再出力時も同じ関数を呼ぶ。
- 葉の書き出しは `export_web_glb.py` の `sample_whole_leaves()`。接続成分を葉として名前をseedに選ぶ。近景V11 maple 3体とV7 mapleは全枚数を元の5裂の輪郭・水平の向き・元の面のスムーズ設定のまま残す（元形状は1枚10三角形）。V6林の葉（`V6 clustered tree leaves`、1本約4,000枚）は元の葉20枚につき1枚の切り抜きカード（元の葉の面積を保つ長方形、UVは4隅・90度単位の回転）へ置換する。カードは複製した専用材質（名前末尾 ` card`）を使い、その `extras.suiLeafCluster` に枚数を記録する（同じ色材質を使う `V8 selective low grass` にはカードUVがないため共有しない）。`Fine canopy leaves` とその複製は各480枚を間引かず2三角形の平面へ変換する。それ以外は1オブジェクト175枚を上限に、元の位置・向き・広がりを近似した2三角形の平面へ変換する（V5/V6の葉は元から菱形）。建物のDecimateとは分離。中庭外の距離による除外はしない（該当する表示対象は林・植栽帯の木だけで、Cyclesの視点に写る）。奥の植栽帯のモミジは菱形のまま。
- 樹皮（`Tree bark`）のカーブは書き出し時にメッシュ化する（断面分割1、UV削除）。元blendで `hide_render` の `V5 overhead canopy bough` は、見上げ可能なWeb用に限り復元する。V5頭上キャノピーの葉は間引かず全960枚。`Limestone terrace paver` はデッキ材と上面が一致するため書き出し時に3mm持ち上げる。
- V6の枕は両極に未接続の重複頂点があるため、Web書き出し時に距離1e-6で結合してから簡略化する。対象は `V6 compressed linen pillow` のみ。結合後と簡略化後の閉じた形状を検査し、`export-report.json` の `pillow_topology` に記録する。元blendは保存しない。
- 壁の施設名・案内・温度計は、書き出し時に描画対象の `FONT` を元の輪郭・厚み・配置・材質のままメッシュへ変換する。文字は小物の除外・Decimateの対象外。`export-report.json` の `text_meshes` に本文・フォント・三角形数を記録する。ブラウザ用フォントや文字画像は追加しない。
- GLBは書き出し末尾の `scripts/compress_web_glb.mjs` で可逆の `EXT_meshopt_compression` に圧縮する（meshoptimizer 1.1.1、bitstream v0、頂点はATTRIBUTES、インデックスは順序を完全保持するINDICES、フィルターなし）。すべての圧縮領域を復号し、元のバイト列と一致することを出力前に検査する。材質extras・画像・ノード変換は維持し、量子化は採用しない。`compression-report.json` と `export-report.json` に圧縮前後のハッシュと容量を記録。書き出しにはNode.jsと `bun install` が必要。
