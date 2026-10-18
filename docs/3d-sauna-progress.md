# 3Dサウナ試験実装の進捗

2026-10-18更新。3ステージの3D表示は試験版として利用できるが、既定は2Dのまま。**計画（[3d-sauna-plan.md](3d-sauna-plan.md)）の各フェーズの完了条件を満たした状態ではない。** 日付ごとの作業・検証の記録は [作業記録](3d-sauna-log.md) に移した。

## 現在の状態

- **表示**：サウナ・水風呂・外気浴の3ステージを同じモデル・描画ループのまま視点だけ切り替える。季節（春夏秋冬）・時間帯（自動／昼／夕暮れ／夜）・天気（晴れ／雨／雪）を設定から選べる。庭の木々（別GLB）、低木・草花・せせらぎ・灯籠・蝶、遠景の林と山並みを含む。画質は標準で、動的解像度が画素比を下げる。入室時の視点はCyclesの比較用カメラから少し下へ向け、主役（ストーブ・水面）を操作パネルの上に出す（比較用は `?camera=review`）。描画・材質・照明の詳細は [src/components/3d/CLAUDE.md](../src/components/3d/CLAUDE.md)。
- **照明**：照度・反射プローブは夏の昼夕夜を焼き込み、他の季節はBlenderで測ったRGBエネルギー比を掛ける近似。日光・月の影はPCSS（夕夜の日光は4＋6標本）、影の半解像度マスク、深度プリパス、見回し中の時間方向の蓄積（TAA）を使う。
- **水風呂**：水面の平面反射、側面の全反射の鏡像、水底の部分反射（寝椅子灯のクリーム色の像はCyclesにもある）、疑似コースティクス、波の傾きによる水越しの像の揺らぎ。
- **失敗時**：モデル・チャンクの取得失敗、30秒の読み込み期限、WebGLコンテキスト喪失、シェーダーのリンク失敗では3Dを解放して2Dで続ける（[src/components/CLAUDE.md](../src/components/CLAUDE.md)）。
- **配信量**：本体GLB 2.39MB、庭GLB 5.98MB（meshopt圧縮・法線8bit）、プローブ等 約1.6MB。2D入口のJS 230.92kB（gzip 73.80kB）、遅延3Dチャンク 866.65kB（gzip 238.12kB、850kBの警告が出る）。
- **検証の仕組み**：通常回帰・継続利用・静止画・回線制限・GPUの各Playwright設定（[e2e/CLAUDE.md](../e2e/CLAUDE.md)）、Cyclesとの同視点比較、全周216枚の撮影と集計スクリプト。QA記録は [3d-qa/](3d-qa/)。

## 未完了事項

各回の作業記録で「未確認」として繰り返し残っているものをまとめた。

- **実環境**：モバイル実機（タッチ・発熱・性能）、Windows、遅い端末、非HDRの実機、実Safariでの継続的な確認。Firefoxは起動障害で未確認（[記録](3d-qa/firefox-launch-20261010/README.md)）。音の実聴（空間音響を含む）。
- **性能**：GPU単体時間・GPUの実確保量・実機のFPSは未計測（フレーム間隔の比での比較のみ）。2026-10-17の季節補正と水越しの揺らぎで、水風呂の見下ろしは約1.17倍、サウナ初期視点は約1.09〜1.17倍のフレーム間隔になり、負荷の削減が残る。
- **読み込み**：約4.7Mbps未満の回線では30秒の期限に間に合わず2Dに戻る。GLBの分割・段階的な読み込み・容量削減は未着手（[記録](3d-qa/network-loading/README.md)）。遅延3Dチャンクの850kB警告も継続。
- **初回のシェーダー準備**：分割温め（`?warmup=split`）は試験オプションのままで、既定は従来どおり。
- **画質**：季節ごとの方向性・遮蔽の再ベイクは未実施（夏のデータに比を掛ける近似）。奥の森の帯の平面感、葉・細い縁の見回し中のちらつき、室内のベンチ下の間接照明、水の反射像の形・部分遮蔽の差が残る。
- **回帰の範囲**：最近の作業では対象を絞ったブラウザ回帰のみを実行している。通常ブラウザ回帰の全件、高画質と他の季節・天気の全周、実時間の連続視聴をまとめて再実行する必要がある。

## 試す

```sh
bun install --frozen-lockfile
bun run dev
```

`/sauna-simulator/?view=3d` を開いて入室する。または右上の「設定」で「3Dを試す」を押す。初期選択は2D。選択は保存され、`?view=2d` で明示的に戻せる。背景をドラッグ／スワイプ、または背景にフォーカスして矢印キーで見回す。UI非表示中も右上の表示復帰・音・設定の操作は残る。計測用に `?quality=<low|standard|high>` で画質を指定できる。

## 書き出しを再実行する

元データは公開リポジトリに同梱しない。プロジェクト所有者からSUI元データ一式を受け取り、`blender/scene/SUI_Retreat.blend` と `blender/assets/textures/CREDITS.md` を配置する。正規ダウンロードURLは現時点でない。画像はblendへパック済みであることを前提とする。
入力の識別子は [export-report.json](3d-export/export-report.json) のファイル名・更新日時・SHA-256を照合する。異なるハッシュの入力は別バージョンとして扱う。

```sh
bun install
/Applications/Blender.app/Contents/MacOS/Blender \
  -b blender/scene/SUI_Retreat.blend \
  --python-exit-code 1 --python scripts/export_web_glb.py
cp blender/assets/textures/CREDITS.md public/models/CREDITS.md
bun run build
```

Blender 4.5.11 LTSで実行。別OSではBlender実行ファイルだけ置き換える。
スクリプトは自身の場所からリポジトリを解決する。元のblendを上書きしない。
比較用の別出力先は `SUI_WEB_EXPORT_DIR=/tmp/sui-web-export` のように指定できる（既定は `public/models/`。別出力先の指定時はレポートも同じ場所に出力する）。
配信物の `public/models/sauna.glb`・`sauna.scene.json` と、配信しない記録の `docs/3d-export/export-report.json`・`compression-report.json` を生成する。Node.jsもPATH上に必要。
座標はBlender `(x,y,z)` → glTF `(x,z,-y)`、単位メートル。
書き出し末尾で `scripts/compress_web_glb.mjs` を呼び、`KHR_meshopt_compression`（bitstream v1）で圧縮する。位置・法線・UVは許容誤差（0.1mm・0.1°・1/8192）内の最小ビット数のEXPONENTIALフィルター、インデックス・色・画像は復号一致を検査する（[記録](3d-qa/glb-filter/README.md)）。その後、本体法線を8bit octへ変換する（ローカル許容1.5°、[検証と採用記録](3d-qa/body-attributes/README.md)）。庭も8bit oct。Draco・位置やUVの整数化は未適用。
元シーン内に複数シーンがあるため `use_active_scene=True` は外さない。

材質はベイクしていない。木目／法線画像と簡略化PBRへ置換し、苔・シダ・石・デッキの色を明示補正した。地面の苔・シダの座標ノイズの色調ランプだけは設定を記録し、ブラウザで再現する（「庭の地面の模様」参照）。その他の色調ランプ、濡れ、体積蒸気、間接照明は再現していない。省略したオブジェクトと手直し対象のプロシージャルノード数も出力記録に含む。
