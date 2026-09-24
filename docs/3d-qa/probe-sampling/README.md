# 拡散プローブ参照位置の診断（2026-09-24）

参照位置を面へ戻す候補は不採用。製品の描画コード・配信データは変更していない。

- `comparison.jpg`：Cycles／変更前／拡散の法線オフセット0。反射の参照位置は変更していない。
- `baseline/`・`no-offset/`：同視点画像とブラウザ・撮影条件・アセットハッシュ。
- `*-tone-stats.txt`：Cyclesに対するCIELAB統計。
- `sample-locations.jpg`：測定点の番号（surface-points.jsonの配列順、1始まり）。
- `surface-points.json`：以前のCycles Position/Normalパスから選んだ面位置・単位法線。元パスはGit管理外。暗部4点は対象の上向き不透明面の入射拡散輝度5パーセンタイルから選択。
- `surface-sampling.json`：今回のBlender 4.5.11による生の測定結果。
- `surface-ratios.json`：Rec.709輝度によるグリッド／余弦積分、L2／余弦積分、5cm／2cmの比。
- `validation.json`：採否・ハッシュ・検証範囲。

## 再実行

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b blender/scene/SUI_Retreat.blend --python-exit-code 1 --python scripts/bake_irradiance_probes.py -- --surface-samples docs/3d-qa/probe-sampling/surface-points.json --out /tmp/sauna-surface-check
python3 -m unittest discover -s scripts -p 'test_probe_sampling.py'
```

診断は照度ベイクと同じ光源可視性で実施。面から2cm／5cmのパノラマをそれぞれ128×64・128サンプルで描き、余弦と立体角で積分する。同じパノラマのL2への切り詰めと、離れたグリッドからの補間を分けて比較できる。小さな光源の画素積分・サンプルノイズ・オフセットによる誤差は残る。14点は画面全体の代表値ではない。裏面を多く見る草の測定と、2cm／5cmで17%変わる点は特に慎重に扱う。

不採用候補の再現は、`src/components/3d/irradiance.ts` の `suiIrradiance()` 内の `suiProbes(..., P, N, N, ...)` だけを `suiProbes(..., P, vec3(0.0), N, ...)` に一時変更する。反射側は変更しない。撮影後は必ず戻す。製品への採用はしていない。
