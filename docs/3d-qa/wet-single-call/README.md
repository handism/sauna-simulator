# 水越しのハイライトの呼び出しを1か所にまとめる（2026-10-02、不採用・記録）

[側面の像の深度パス](../side-image-depth/README.md)の残件「水越しのハイライト（`cut-wet`、約1.6ms）」を調べた。製品コードの変更はない。

[tilt-cost](../tilt-cost/README.md)では、側面の像の経路（`suiWetImage` のループ）を外すと1.15〜1.6ms減り、そのうち0.6〜1.1msは実行されなくてもコードの存在だけでかかる分だった。`waterBottom.ts` の `WET_AFTER` は、直接の2灯と、2灯×2軸の像で、`suiWetSpecular`（GGX）を最大6か所にインライン化している。コード量が費用なら、呼び出しを1か所にまとめれば軽くなると考えた。

V9と寝椅子灯は時間帯の補間中（`lighting.ts`、`dusk` が0〜1の間）に両方とも点くため、1灯に絞る案は取らなかった。

## 版

どちらも6本の経路（直接2本＋像4本）を1つのループにし、各回で灯りの色・向きを決めてから `suiWetSpecular` を1回だけ呼ぶ。

- **A（1か所）**：上限は定数6。展開するかどうかはコンパイラに任せる。
- **B（展開なし）**：上限を `6 + suiWetZero`（未設定で0のuniform）にして、展開できないようにする。

## 結果

条件：Chrome 154／ANGLE Metal（Apple M1 Max）、headless、`e2e/frame-cost.gpu.ts`、1200×800・動作抑制・標準画質・DPR 1.5、繰り返し2回のフレーム間隔（`intervalMs.mean`）。HEADのworktreeと3者を順序を変えて交互に4組（[cost.json](cost.json) の `comparisons`、`single` がA、`rolled` がB）。

| DPR 1.5 | HEAD（ms） | A | 比 | B | 比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| サウナ 昼 | 11.78〜11.81 | 11.81〜11.85 | 1.002 | 12.66〜12.71 | 1.075 |
| サウナ 夕暮れ | 14.86〜14.91 | 14.86〜14.91 | 1.000 | 15.74〜15.81 | 1.059 |
| サウナ 夜 | 15.67〜15.74 | 15.68〜15.74 | 1.002 | 16.53〜16.67 | 1.057 |
| 水風呂 昼 | 15.08〜15.20 | 15.37〜15.44 | **1.018** | 17.10〜17.17 | **1.134** |
| 水風呂 夕暮れ | 18.11〜18.20 | 18.36〜18.36 | 1.009 | 19.95〜20.12 | 1.104 |
| 水風呂 夜 | 18.71〜18.81 | 18.97〜19.07 | 1.014 | 20.66〜20.75 | 1.104 |
| 外気浴 | 8.58〜12.96 | 同じ | 1.000 | 8.74〜13.02 | 1.01〜1.02 |

（比は cost.json の `medianIntervalRatio`。GPUタイマーの比 `medianRatio` もほぼ同じ値。）

- **A**：水風呂で1.01〜1.02倍遅い（4組とも範囲が重ならない）。ループの各回で灯りの番号・色・向きを動的に選ぶ分が、インライン化が減った分を上回ったと考えられる。
- **B**：水風呂で1.10〜1.13倍、水底がほとんど見えないサウナでも1.06〜1.08倍遅い。PCSSの `rolled`（[light-shadow-cost](../light-shadow-cost/README.md)）と同じく、展開を止めると遅くなる。
- 画像は撮影していない（どちらも遅いため）。

## 判断

**不採用。** このMac／ANGLEでは、展開済みの複数の呼び出しのほうが速い。「コードの存在が費用」は、同じ処理を減らす（消す）ときには当てはまるが、同じ処理を動的なループに畳んでも速くはならない。水越しのハイライトを下げるには、像の経路そのものを減らす（画像が変わる）以外の見込みは小さい。

## 再実行

試作の差分はリポジトリに残していない（`WET_AFTER` を6本のループに書き換えたもの）。計測は、HEADのworktree・Aの作業ツリー・Bのコピーを、bashのスクリプトで順序を変えながら交互に：

```sh
FRAME_COST_DPR=1.5 FRAME_COST_REPEAT=2 FRAME_COST_VARIANTS=warmup,product \
  bunx playwright test --config playwright.gpu.config.ts e2e/frame-cost.gpu.ts -g "frame cost" --reporter=json > a-0.json
python3 scripts/summarize_frame_cost.py --out docs/3d-qa/wet-single-call/cost.json \
  --runs single before=base-0.json,...,base-3.json after=a-0.json,...,a-3.json \
  --runs rolled before=base-0.json,...,base-3.json after=roll-0.json,...,roll-3.json
```

## 検証

GPU計測（HEAD・A・Bの交互4組、すべてシェーダーのコンパイルエラーなし）。製品コードは変わらないため、単体テスト・ブラウザ回帰・撮影は再実行していない。
