# WebKit高画質・実時間全周見回し（2026-10-10）

シェーダー失敗時の2D復帰修正後のソースで、3ステージ×昼夕／夕夜の6条件を各195秒記録。水平360度、俯仰約±23度の入力を150秒で行った。WebKit 26.6・高画質・split・1280×800・自動解像度（全標本pixelRatio=1）・TAA on・full・動作抑制なし。6/6成功、計1217.12秒。失敗・skip・flaky・再試行・ページ／コンソールエラーなし。

サウナ184／186、水風呂187／187、外気浴188／184標本。全標本で庭ready、本体／庭の未描画グループ0。同一canvas・照明終点・2D復帰はテスト内で確認。照明値は昼夕0→1、夕夜1→2に到達し、時間に対する最大差は0.008284未満、最大標本間隔は1.155秒。入力途中の欠落・不正な移動量・上下不足を集計で拒否し、境界5単体テストも成功。

全6 WebMと6 MP4をデコードし、抽出72枚を目視。室内の裏壁・ベンチ・窓、水風呂周囲、外気浴の椅子・壁・屋根・庭に大きな欠落・黒抜けなし。水面のクリーム色の像は既存の水底部分反射による寝椅子灯の像として[調査済み](../auto-lighting/README.md#追記水面のクリーム色の斑の正体2026-09-29)。圧縮動画の部分抽出で短時間のちらつき不存在は承認しない。

`summary.json` と各標本に入力ハッシュ・動画ハッシュを保存。SaunaScene.tsxのSHA-256は `c8e9aa1959895bc867f3fb21c759f2fadd40c2569a431df3f39d1ee29695ed51`。Chrome全周記録は修正前なので、今回の結果との同一ソース比較には使わない。動画符号化fpsは描画fpsではなく、資源数はGPU総メモリやリーク不存在の証拠ではない。WebKitはネイティブSafariとは別の環境。

再実行（新規出力先を使う）：

```sh
MOTION_BROWSER=webkit MOTION_SCOPE=all MOTION_LOOK=surround MOTION_QUALITY=high MOTION_WARMUP=split bun run test:browser:motion --reporter=json > /private/tmp/sauna-surround-webkit.json
python3 scripts/summarize_auto_motion.py /private/tmp/sauna-surround-webkit.json docs/3d-qa/warmup-surround-motion-webkit-high --warmup split --browser webkit --quality high --scope all --look surround
python3 scripts/test_surround_validation.py
```

画像・動画はローカルのみ。全俯仰・実Windows／モバイル／非HDR実機・遅い端末・GPU実確保量・音の実聴は未確認。既定2Dと明示3D、splitの試験オプションを維持。
