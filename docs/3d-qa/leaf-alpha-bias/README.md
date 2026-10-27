# 林のカードのアルファを遠景でぼけたミップから読む（2026-10-27）

[TAAの制限幅を広げる案](../taa-ghosting/README.md)を打ち切った後の、樹冠の見回し中のちらつきへの対応。残りは樹冠の内側の1画素の粒で、葉が画素より小さい距離ではカード上の位置が画素の格子に対してずれるたびに、alpha-to-coverageの被覆が4倍MSAAの1/4ずつ飛ぶ。

## 変更

`leafCluster.ts` の `suiLeafBias`：1画素が覆うテクセル数（`suiLeafFootprint`、短軸）が2→4のあいだで、アルファマップを読むLODバイアスを0→1（`LEAF_FAR_BIAS`）にする。ぼけたミップ（各段は被覆率を保つよう補正済み）から読むので、被覆が見回しの角度に対してなだらかに変わる。照明パス（three の `alphamap_fragment` を置き換え）・深度プリパス（`depthPrepass.ts`）・影マスク（`shadowMask.ts`）で同じ読み方にする。影マップは従来どおり0.5で切る（バイアスなし）。近い葉（2テクセル未満）は変わらない。

## 比較

`resolution-shimmer.visual.ts` の制御撮影（Chrome 155.0.8059.85、1200×800・標準DPR1.5・固定解像度・`camera=review`・動作抑制、3ステージ×昼夕×13枚、1 CSS pxずつ）。製品版は `SHIMMER_CONTROL=leaf-alpha` で、before の回に検証ブラウザ内で `suiLeafBias(…)` を0へ戻した対照を、同じビルドでABBA比較した。面の残差（8 CSS px）の変更後÷変更前。

| 視点 | 遠景だけ（2→4テクセル、採用） | 全距離（1→2テクセル、不採用） |
|---|---|---|
| サウナ昼 | 0.992 | 0.962 |
| サウナ夕 | 0.975 | 0.920 |
| 外気浴昼 | 0.963 | 0.922 |
| 外気浴夕 | 0.914 | 0.812 |
| 水風呂昼 | 0.944 | 0.903 |
| 水風呂夕 | 0.906 | 0.820 |

2組とも小数3桁でほぼ同じ値（同方式の再撮影差）。採用版の製品の画像は、候補として撮った画像と78枚で一致した（2段階超の画素0.00005%）。

静止画は変わる：8階調を超えて変わる画素は約1.2%（全距離では約2.5%）、見回し12ステップ後のL*勾配の比は0.94〜1.00（全距離は0.88〜0.98）。全距離では近〜中景の葉が粗いミップの大きな角ばった破片に見えたため、利用者の選択で遠景だけを採用した。遠景だけでも葉の形は少し大きく丸くなる。

## 範囲

標準画質・DPR1.5・昼夕・既定（比較用）視点の制御撮影で、知覚的なちらつきの合否、夜、高画質、水平の他の方位、実機は見ていない。描画費用は測っていない（テクスチャの読み出し回数は同じで、足跡の計算は `suiLeafCoverage` と同じ微分）。通常のブラウザ回帰（80件）は成功。

`product/comparison.json` が採用版、`candidate-all/comparison.json` が全距離の候補（当時は after の回に候補を差し込む一時的な仕組みで撮影）。PNGはローカルのみ。

## 再実行

```sh
bun run build
SHIMMER_CONTROL=leaf-alpha SHIMMER_ABBA=1 SHIMMER_FIXED=1 SHIMMER_CONTROLLED=1 SHIMMER_RATIOS=1.5 \
  SHIMMER_QUERY='&camera=review' \
  bunx playwright test --config playwright.visual.config.ts e2e/resolution-shimmer.visual.ts --reporter=json > /tmp/leaf-alpha.json
# 先頭のビルドログを除き、test-results/visual を別の場所へ複製してから
python3 scripts/summarize_temporal_variance.py /tmp/leaf-alpha.json <複製先> <出力先>
```
