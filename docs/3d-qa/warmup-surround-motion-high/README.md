# Chrome高画質・実時間全周見回し（2026-10-09）

3ステージ×昼夕／夕夜の6条件を各195秒記録。水平360度、俯仰約±23度の入力を150秒で行った。高画質・split・1280×800・自動解像度（全標本pixelRatio=1）・full・動作抑制なし。Chrome 154.0.8037.98、6/6成功、失敗・skip・flaky・再試行・ページ／コンソールエラーなし。計1217.15秒。

全WebM／MP4をデコードし、抽出72枚を目視。室内の裏壁・ベンチ・窓、水風呂周囲、外気浴の椅子・壁・屋根・庭に大きな欠落・黒抜けなし。水面のクリーム色の像も見える。これは既存の水底部分反射による寝椅子灯の像として[調査済み](../auto-lighting/README.md#追記水面のクリーム色の斑の正体2026-09-29)。圧縮動画の部分抽出で短時間のちらつき不存在は承認しない。入力経路の途中欠落・上下入力不足を集計が拒否する5単体テストに成功。

**この記録はシェーダー失敗時の2D復帰修正より前の入力ハッシュによるもの。** `summary.json` と各標本に入力ハッシュを保存。修正後の検証と混在させない。動画符号化fpsは描画fpsではなく、資源数はGPU総メモリやリーク不存在の証拠ではない。

再実行（新規出力先を使う）：

```sh
MOTION_SCOPE=all MOTION_LOOK=surround MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-surround-chrome.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-surround-chrome.json docs/3d-qa/warmup-surround-motion-high --warmup split --browser chromium --quality high --scope all --look surround
python3 scripts/test_surround_validation.py
```

画像・動画はローカルのみ。これは実Safari／Windows／モバイル／非HDR実機・全俯仰・性能・音の実聴の承認ではない。
