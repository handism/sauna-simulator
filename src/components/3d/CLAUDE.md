# 3D描画（src/components/3d）

- `SaunaScene` のDOM `data-*` 属性に初回ロード時間、描画数、初期180フレームの間隔を記録する。Reactの毎フレーム更新は行わず、DOM属性も値が変わったときだけ書き込む。
- GLB読み込み後の材質拡張（葉・ノイズ色・画像ランプ・林のカード）と影・水形状の非表示は `modelMaterials.ts` の `prepareModel()`、解放は `disposeTree()`。
- 水は元GLBの閉じた水形状を非表示にし、`waterEffects.ts` の境界付き水面・波紋・注水に置き換える。動きを減らす設定では波紋・注水の時間更新を止める。最適化は未完了。
- 昼／夕暮れ／自動は `lighting.ts` で管理。元Cyclesに合わせて霧はなく、空は元画像の表示色の単色（昼 `#4f616c`・夕暮れ `#283d54`）、カメラの描画距離は250m（地面は原点から100m）。`sui-lighting-mode` に保存し、3Dモデルを再ロードせずに反映する。自動は各周回でサウナ=昼、水風呂=中間、外気浴=夕暮れ。ステージ変更時は暗転中に適用し、手動変更は補間する。動きを減らす設定では即時適用。
- トーンマッピングは元blendと同じAgX（look None）、露出はBlenderの昼0.15・ブルーアワー0.55段を `2^EV` で使う。半球光・日光・室内点光源の強さはCycles同視点との比較（`scripts/cycles_tone_stats.py`、CIELABの明暗分布と彩度）で選んだ値。照明を変えたら全周撮影の後にこのスクリプトで比較し、進捗記録へ値を残す。ブラウザで再現しないノイズ→ランプの基本色（漆喰・リネン・樹皮・砂利）は書き出し時にノイズ平均0.5のランプ色の単色にする（`procedural_flat_color`）。
- 3D画質は `quality.ts` の軽量／標準／高精細。`sui-quality` に保存し既定は標準。DPR上限は1／1.5／2、日光の影は無効／1024／2048px。モデルを保持したまま反映し、画質変更時は180フレームの計測をリセットする。
- 日光だけが影を描く。ガラス・水・蒸気は影を投射しない。日光方向を補間量0.01刻みにし、その方向・影解像度の変更時だけシャドウマップを更新。軽量切り替え・シーン解放時に影のGPUリソースを解放する。これはベイクではない。
- `SaunaScene` は描画数・三角形数・テクスチャ数・ジオメトリ数もDOM属性へ記録。描画数は最新フレームの値なので、照明補間中の影パスを含む値と、安定後の値を区別する。
- 蒸気の座標更新は `steam.ts`。動きを減らす設定では全軸を固定し、濃淡と6秒の表示時間は維持する。`scene-viewport.e2e.ts` は390×844の操作・キーボード見回し・844×390とのリサイズ・同一canvas保持を検証。Chromeの画面サイズとメディア設定のエミュレーションであり、モバイル実機の検証ではない。
- 見回しは `lookControls.ts`。終了は操作開始時のpointerIdに一致する場合だけ処理し、別の指の終了・キャンセル・キャプチャ喪失で中断しない。`scene-touch.e2e.ts` はChromeのCDPタッチ入力でスワイプ、2本目の指を離した後の操作継続、キャンセル後の再操作、タップでのUI復帰・ステージ一巡・2D復帰を検証する。モバイル実機やSafariの検証ではない。
- 林のカードは `leafCluster.ts`。20枚の菱形の葉のマスクを決定的に生成し（カードの半分を覆う）、アルファテストの被覆率を保つよう各ミップを自前で補正、`alphaToCoverage` で描く。マスクは枚数ごとに1枚を共有し、材質とともに解放する。`data-leaf-cluster-materials` に対象材質数を記録する。
- 葉の逆光対策は `foliage.ts`。名前が leaf／foliage／fern の `MeshStandardMaterial`（落ち葉 `leaves`・苔・樹皮は対象外）だけ `onBeforeCompile` で裏面からの直接光と反対側の半球光を拡散色の0.6倍で透過させる。Three.jsの `lights_fragment_begin`・`lights_physical_pars_fragment` に依存し、想定外のチャンクでは例外にする。Three.js更新時は `foliage.test.ts` と全周撮影で確認する。`data-foliage-materials` に対象材質数を記録する。
- 地面の苔・シダの色は `noiseColor.ts`。`export_web_glb.py` が元材質のワールド／オブジェクト座標fBmノイズ→線形カラーランプの設定を材質 `extras.suiNoiseColor` に記録し、BlenderのPerlin（Jenkinsハッシュ）とfBmのGLSL移植で画素ごとに評価する。画素より細かいオクターブは平均へフェード。バンプは省略。Three.jsの `common`・`project_vertex`・`color_fragment` チャンクに依存。移植は `noise-color.e2e.ts` がBlender基準値（`scripts/blender_noise_reference.py` → `e2e/fixtures/blender-noise.json`）と比較する。名前による苔・シダの単色上書きはBase Colorが接続された材質だけ。
- 石・布・木材の色は `imageRamp.ts`。`export_web_glb.py` の `base_color_image_ramp()` が「画像→RGBのBW化→線形ランプ × Object Info Randomのランプ（→一定色へ混合）」を材質 `extras.suiImageRamp` に記録し、結合前のオブジェクトごとの乱数を色属性 `SuiObjectRandom`→`COLOR_0` で渡す（名前seedの一様乱数でCyclesの値ではない）。濡れ跡のノイズは省略。輝度係数はBlenderのOCIO設定の `luma`。Three.jsの `common`・`map_fragment`・`color_fragment` チャンクに依存。`data-image-ramp-materials` に対象材質数を記録する。書き出しはUVの最下位ビットが実行ごとに揺らぐため、GLBのハッシュは再実行で変わる。
- `SaunaScene` 内で `meshoptimizer/decoder` をGLTFLoaderへ渡す。WASMは3Dの遅延JS内に含まれ、CDNや別のデコーダーURLへ依存しない。圧縮ストリームの破損時も2Dを継続し、手動再試行できることを `scene-lifecycle.e2e.ts` で検証する。圧縮は転送量を減らすもので、描画三角形数やGPUメモリは減らさない。
