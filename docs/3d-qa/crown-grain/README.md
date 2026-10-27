# 林の樹冠の内側の粒の切り分け（2026-10-27、製品の変更なし）

利用者の依頼（改善候補の1「見回し中の林の樹冠のちらつき」）。[2026-10-26の切り分け](../crown-shimmer-20261026/README.md)で、残りは樹冠の内側の1画素の粒と分かっていた。その粒が「カードごとの明るさの差」と「被覆の飛び」のどちらから来るかを、同じビルドで検証ブラウザ内だけシェーダーを書き換えて比べた（`e2e/crown-grain-controls.ts`）。

## 方法

`resolution-shimmer.visual.ts` の制御撮影（Chrome 155.0.8059.85、1200×800・標準DPR1.5・固定解像度・`camera=review`・動作抑制、3ステージ×昼夕×13枚、1 CSS pxずつ）。`SHIMMER_CONTROL=crown-grain:<候補>` は before の回に候補を当てるので、表の比は **製品÷候補**（1より大きいほど候補で減る）。面の残差（8 CSS px）、2組とも同じ値。

| 視点 | `tint`：全カードの色味・陰を一様（0.86）に | `bias`：ぼけたミップを1.5→3テクセルから |
|---|---|---|
| サウナ昼 | 1.000 | 1.000 |
| サウナ夕 | 1.000 | 1.010 |
| 水風呂昼 | 1.000〜1.003 | 1.016 |
| 水風呂夕 | 1.000 | 1.030 |
| 外気浴昼 | 1.002 | 1.012 |
| 外気浴夕 | 0.997 | 1.028 |

静止画の最大チャンネル差は `tint` 4〜31、`bias` 145〜195。

## 判断

- 木ごとの色味と樹冠の内側・下側の陰（`suiCrownTint`）を消しても残差は変わらない。粒はカードごとの明るさの差ではない。
- `bias` を手前へ広げても1〜3%しか減らず、静止画は大きく変わる（[leaf-alpha-bias](../leaf-alpha-bias/README.md) で近い葉が角ばった破片に見えて不採用にした方向）。採らない。
- これまでにTAA（制限幅・重み）、影、アルファのぼかし、カードの明るさを切り分けたが、どれも数％以下。残りはカードの形（葉が画素より小さい距離で、重なったカードの縁がMSAAの標本をまたぐこと）そのもので、減らすには中景の林を別の描き方（焼いた樹冠の板など）にする必要がある。

## 範囲

制御フレーム列のL*の比較で、知覚的なちらつきの合否ではない。標準・DPR1.5・昼夕・比較用視点のみ。`comparison.json` が各候補の集計、PNGはローカルのみ。

## 再実行

```sh
bun run build
SHIMMER_CONTROL=crown-grain:tint SHIMMER_ABBA=1 SHIMMER_FIXED=1 SHIMMER_CONTROLLED=1 SHIMMER_RATIOS=1.5 \
  SHIMMER_QUERY='&camera=review' \
  bunx playwright test --config playwright.visual.config.ts e2e/resolution-shimmer.visual.ts --reporter=json > /tmp/grain.json
# test-results/visual を別の場所へ複製してから
python3 scripts/summarize_temporal_variance.py /tmp/grain.json <複製先> <出力先>
```
