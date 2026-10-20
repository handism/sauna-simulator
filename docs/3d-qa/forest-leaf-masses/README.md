# 奥の森の葉の塊（2026-10-21、採用）

[葉群](../forest-clumps/README.md)の後も、外気浴から右へ約92°の奥の森は、霞色のなめらかな丸の重なりに見えた（手前の林は明暗の粒が立っているため、奥だけ塗った書き割りに見える）。部位を色分けして撮ると、54mの帯は立体の上に覗く頭の部分だけで、手前の樹冠の隙間に見える淡い縦の柱は奥の補完樹冠（51.9m）だった。平面感の主因は帯そのものの露出ではなく、全樹冠の陰影がなめらかなグラデーションだけだったことと判断した。

## 変更

`farForest.ts` の断片段で、帯・立体のすべてに約0.9mの葉の塊のセル模様（3×3セルの最近点）を掛ける。塊の中心ほど明るく上側をさらに明るくし、塊の間を暗くする（0.42〜1.37倍、平均はほぼ不変）。塊が約4画素より小さくなる距離（画素の足跡0.12→0.3m）で平均へ戻す。照明・霞・季節色・時間帯は従来どおりで、頂点・三角形・材質・描画パスは変えない。

不採用：

- 奥の層を明るくする距離の係数（0.72〜1.0倍）と裾の霧を縮める案は、森全体が一様に暗い塊になって奥行きが減った。奥の層の淡さは空気遠近として効いていた。
- 輪郭のほつれの `discard` をalpha-to-coverageにする案は、1:1では既に輪郭がMSAAで滑らかで、差がほぼなかった（拡大の補間で段に見えていただけ）。
- 奥の層の下部を暗くして淡い柱を消す案は、柱と周囲の差が画素値で5程度しかなく効かなかった。柱は葉の塊の模様が全体に乗ることで目立たなくなる。
- 葉の塊の振れ幅0.66〜1.16倍は、霞と暗さで画素値の差が最大16に留まり見分けられなかった。

## 確認

- Chrome 155.0.8059.85、1280×800、標準DPR1・固定解像度・動作抑制・夏晴れ。変更前は実旧ビルド（`ad625ea` のworktreeのdist）。`forest-leaf-masses.visual.ts` で3ステージ×昼夕夜×水平3方位（右0／20／60キー）と外気浴の春秋冬の昼の30枚を、前→後→後→前で撮影（計120 PNG）。全4件成功、ページ／console errorなし。同じ版の再撮影差は全画像で0。変更による差は遠景の森だけで、画面全体のΔE>2の画素は0.003〜1.1%、最大ΔE 2.4〜14.6（[値](values.json) の `still`）。春秋冬の樹冠も葉の塊の重なりに読める。冬の灰褐色の広葉樹（枝のない近似）にも塊の模様が乗る。
- 制御した見回し（比較用カメラ・右60キー・段1.5、旧→新→新→旧）の回転補償残差の前後比は画素1.000〜1.004、面1.000、面の99百分位0.999〜1.001。同方式の再撮影は1.000。水風呂・外気浴では模様が見回しの画像に写っている（サウナのこの方向は室内に遮られる）。知覚的なちらつきの合格ではない（`motion`）。
- `forest-back-crowns.gpu.ts`（標準DPR1・右20キー・描画3回反復）を旧→新→新→旧で。描画間隔の比は1.006〜1.013倍、三角形数は同じ（`cost`）。`summarize_forest_back_crowns.py --cost` は前回の変更の三角形の増分を検査するため使えず、同じ添付から直接集計した。

## 再実行

```sh
# 旧版：git worktree add --detach <wt> <変更前>; node_modules をリンクして bun run build、
# <wt>/farForest.before.ts に変更前の src/components/3d/farForest.ts を置く。
FOREST_REVIEW=visual FOREST_RUN=before1 FOREST_BASELINE_DIST=<wt>/dist \
  bunx playwright test --config playwright.forest.config.ts e2e/forest-leaf-masses.visual.ts --reporter=json
FOREST_REVIEW=visual FOREST_RUN=after1 \
  bunx playwright test --config playwright.forest.config.ts e2e/forest-leaf-masses.visual.ts --reporter=json
# after2・before2 も同様。各回の report.json と test-results/visual を保存してから次へ。
# 見回しと負荷は ../forest-back-crowns/README.md と同じ手順。
```

画像はローカルのみ。高画質・雨雪・全周・実機・連続見回しの知覚的合否は未確認。固定方向の近似陰影・既存プローブを共用する近似は残る。
