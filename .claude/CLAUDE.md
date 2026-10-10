# CLAUDE.md

## 言語

- 利用者との会話、PRのタイトル・本文、GitHub上のコメントは日本語で書く

## コマンド

- パッケージマネージャは **bun**
- Vitest の設定は `vite.config.ts` の `test` に一本化している。`src/hooks/useAudioEngine.bench.test.ts` は名前に反して `describe`/`it` による通常のテストで、`bun run test` の対象に含まれる（`vitest bench` の対象ではない）
- ビルドの警告上限は遅延ロードする3Dチャンクに合わせてあり、2Dで必ず取得する入口チャンクだけは `vite.config.ts` のプラグインが 500kB で警告する

## アーキテクチャ

### ステージ遷移フロー

ステージは `start → sauna → water → totonou` の順に進み、`totonou` から `sauna` に戻るループ構造になっている。「今日はここまで」は `finishSession()` で環境音をフェードアウトし、同じ遷移タイマーで `start` の終了画面へ戻る。終了画面からは「トップに戻る」か、今の音の設定のまま「もう一度入室する」（`handleStart(!isMuted)`）。`sessionSummary` は終了操作時のセット数・入室からの実時間を保持し、次の入室時に記録とともにリセットする。

- セッション状態と各ステージ完了時の操作（`completeSauna` など。setterは公開しない）は `src/hooks/useSaunaSession.ts` が保持し、`SaunaProvider` / `useSaunaContext`（`src/context/SaunaContext.tsx`）経由で配布する。`App.tsx` はセッション値をcontextから読み、ロウリュ通知用の `EventTarget` だけを保持する
- ステージ遷移は `changeStage()` が単一の1秒タイマーで管理する。`pendingStage` を設定してUIと背景を暗転し、1秒後にステージ・環境音を同時に切り替えてフェードインする。遷移中の二重操作は拒否し、ステージUIには `inert` を付ける
- 2D背景は現在のステージの1枚のみ描画する（`public/sauna_bg.webp`, `water_bg.webp`, `totonou_bg.webp`）。背景専用タイマーは持たず、3Dレイヤー・UIと同じ `opacity` で遷移する

### オーディオ

`src/hooks/useAudioEngine.ts` にカプセル化されており、**外部音声ファイルは一切使用しない**。すべて Web Audio API でプロシージャル生成している（ノイズ生成は `src/hooks/audioWorker.ts` の Web Worker 側で行い、要求・重複排除・失敗処理は `src/hooks/noiseWorkerClient.ts`）。

`SoundControl` は音の設定から全体音量（0〜100%）とミュートを操作する。音量はセッションのステージ移動・ミュートをまたいで保持し、再読み込み時は100%に戻る。`audio.setVolume()` と `setMuted()` は同じmaster gainを更新し、追加のAudioContext／音源は作らない。ミュート中の音量操作では解除しない。設定ポップアップ共通の外側クリック・Escape処理は `useDismissibleDetails`。

`audio.init()` はユーザーインタラクション（スタートボタン）のタイミングで呼ぶ必要がある（ブラウザの autoplay 制限対応）。

## 規約・パターン

### スタイリング
- 共通 UI は `.glass-panel` と `.primary-btn`。通常の操作は下部の `.stage-dock` にまとめ、心拍・体感温度・ととのい度はネイティブ `details` で開く。`ActionIcon` の線画アイコンと木・石・水を基調とする配色を使う。UI非表示は見出し・操作パネル・呼吸ガイドを隠し、音・表示復帰・設定の操作は残す（隠している間、表示復帰ボタンは「UI表示」の文字付きの札になる）。「表示設定」の「UIを隠しても呼吸ガイドを残す」で呼吸だけ維持できる（`sui-keep-breathing`）。見出しには局所的な暗色グラデーション、呼吸の文字にはぼかした影を付ける（面を敷くと押せる部品に見えるため）。外気浴で振り返り・スコアを開くと、呼吸ガイドは消さずに見出しの下へ小さく退き、パネルはその下までに収める。高さ620px以下かつ幅960px以上（および高さ480px以下の横長）では、見出し・呼吸ガイドを左、パネルを右に分けて中央の景色を空ける。ロウリュの曇り（`.steam-overlay`）はパネルより下に置き、景色だけを曇らせる。
- `StageDock` はコンパクト／詳細の切替を担当（`sui-dock`、パネル上端の取っ手。「詳しく表示」／「詳細を閉じる」を添える）。保存がなければ、幅600px以下か高さ480px以下ではコンパクトから始める（パネルが景色を覆いすぎないように）。コンパクト時も時間・主操作・表示復帰は残し、低い画面で中身がはみ出すときは主操作（`.dock-actions`）をパネル下端に固定する（`data-overflow`）。ロウリュの上昇幅は `.loyly-compact-delta` で出す。ステージ見出しの進み具合とセット数は `StageStep`。`FirstVisitGuide` はサウナの初回案内を担当し、説明するロウリュボタンの真上に置く（メーターを押し下げない。コンパクト表示でも出す）。「わかりました」か初回のロウリュで以後非表示（`sui-guide-dismissed`、表示の有無は `SaunaRoom` が持つ）。ストレージが使えなくても操作を継続する。
- 色・角丸は `index.css` の `:root` の変数（`--ink` 系の文字色、`--wood`・`--water`・`--moss`、`--radius-*` など）を使い、値を直接書かない。木の色の塗りは各場面の主操作（`Space` と同じ操作。入室画面は音ありの入室、終了画面は「トップに戻る」）と外気浴の終了ボタンに付け、2D/3Dの選択などには使わない。開閉の印はブラウザ標準の三角ではなく線のシェブロン（`.stage-details`/`.score-details` の `summary::before`）。ガラスパネルは2Dでは景色を透かし、3D表示中は描画負荷を避けるためブラーを外して不透明寄りにする
- 右上のアイコン操作（UI・音の設定・表示設定）は `.app-toolbar` に横並びで置く。入室後の全ステージで、アイコンの下に「景色」「音」「表示」を出す（`data-labeled` と `data-short-label`。読み上げには操作の名前を残し、アイコン間隔と見出し位置を調整する）。入室前は表示設定だけを出す。全画面は使用頻度が低いため表示設定メニューの先頭（`SceneMode` の `settingsExtra`、`FullscreenMenuButton`）に置き、入室前から使える。入室画面は景色の選択を入室ボタンより上に置き（各選択肢の説明はボタン内に小さく添える）、ヘッドホン推奨は「音あり」ボタンの補足文（`aria-describedby`）にするボタンの hover の浮き上がりは `(hover: hover)` の環境だけで、押下時は `:active` で沈む
- 外部フォントは読み込まない（OS標準の和文・欧文フォントスタック）。和文は `word-break: auto-phrase` と `text-wrap: pretty` で文節単位に折り返す
- ステージ固有の色や背景はコンポーネント内のインラインスタイルで上書きする。ただし状態で切り替わる見た目（外気浴の呼吸の吸う/吐く）は `data-*` 属性と `index.css` のセレクタで切り替える

### コンポーネント設計
- 各ステージコンポーネント（`SaunaRoom`, `CoolingBath`, `TotonouSpace`）は `onNext` コールバックを受け取り、次ステージへの遷移をトリガーする。記録は名前付きのオブジェクト（`useSaunaSession.ts` の `SaunaResult` / `WaterResult`）で渡す。セットごとのととのい度（`scoreHistory`）は水風呂を出る遷移が受け付けられたときに `useSaunaSession` が確定し、入室ごとにリセットする。ととのい度の段階（`TOTONOU_TIERS`）はフィードバック文・段階名（`totonouTierLabel`、数値より大きく出す）と表示色（`src/utils/scoreColor.ts`、色は棒にだけ付ける）で共有する。セットごとの推移は `ScoreHistory` で外気浴と終了画面に出す（`sessionSummary.scores`）。サウナ・水風呂の滞在時間表示（`StayTimer`）の目安は、ととのい度が満点になる `STAY_TARGET_SECONDS` と共有し、経過時間の横に `目安 50秒` の形で並べる。水風呂は心拍を開かずに見える位置に出す（コンパクト時は隠す）。外気浴の振り返りはセット数・サウナ／水風呂の滞在時間の details と、スコアの details を横に並べ、展開時は全幅に広げる。同じ `name` で片方だけ開く（パネルが伸びて操作が画面外に出ないように）。メーターはスコアを初めて開いたときに上がり始め、フィードバック文は数値より先に、開いた時点で出す。外気浴の呼吸ガイドは縁のリング（`.breathing-ring`）が吸う／吐く1回（4秒）で一周する。円の内側は塗らず、中心だけ淡く暗くする（景色を円盤で塞がない）。サウナのロウリュの蒸気は2D背景のストーブ位置（`SAUNA_CONFIG.STOVE_X/Y`、正方形画像の cover を画面の長辺で換算）から上げる。縦長の画面ではサウナ背景を `--sauna-bg-shift` だけ右へずらしてストーブを画面に入れ（蒸気も同じ量ずらす）、横長では `--sauna-bg-lift` だけ上へずらして壁の温度計を見出しより上へ逃がし（高さ480px以下は0）、ストーブが隠れる操作パネルの上端から蒸気を上げる（`--steam-floor`）。外気浴の開閉ラベルは「振り返り」「スコア」と短くし、説明は展開先に置く。終了画面でもスコアは任意で展開する
- `audio` と各種セッション値は `App.tsx` が `useSaunaContext()` から取得し、props で各コンポーネントに渡す。コンポーネント側は context を直接参照しない

### キーボードショートカット・全画面
- 単キーのショートカットは `src/hooks/useKeyboardShortcut.ts`。`M`（ミュート）・`U`（UI表示）は入室後、`F`（全画面、`src/hooks/useFullscreen.ts`）は常時 `App.tsx` が登録する。`Space` は各ステージが自分の主操作（サウナはロウリュ、水風呂・外気浴は次へ）に `scope` 付きで登録し、遷移中の `inert` なステージでは無視する
- 修飾キー付き・リピート・IME変換中・フォーム部品への入力は奪わない。キーボードでフォーカスしたボタン上の `Space` はブラウザ標準の押下に任せ、クリックでフォーカスが残ったボタンではフォーカスを外してショートカットを優先する（Chromeではキー入力後に `:focus-visible` で判別できないため、ポインタ由来のフォーカスを記録する）
- Fullscreen API 非対応環境（iPhone Safari）では全画面ボタンと案内を出さない

## 3Dサウナ試験版

- `?view=3d` または「表示設定」内の「3Dを試す」で有効化。時間帯・画質・素材クレジットも同じメニューにまとめる。メニューは Escape・外側のポインタ操作・ステージ変更で閉じる。`?view=2d` は保存済みの選択を上書きする。選択は `sui-view-mode` に保存し、未選択時は2D。
- `SceneMode` は表示設定・ロード状態を管理し、セッションを作り直さない。render propで同じモード状態・切替操作と表示設定メニューを渡し、入室画面の2D／3Dの切り替えと `.app-toolbar` で使う（render propなしでは自分でメニューを描画する）。選択だけでは3Dを取得せず、入室後に読み込む。サウナ・水風呂・外気浴の3ステージに対応し、ステージ変更時はモデルと描画ループを保持して視点だけを更新する。
- Three.js 0.186.0を直接ラップした `src/components/3d/SaunaScene.tsx` は `React.lazy` で遅延ロードする。3D専用チャンクは通常の2D利用時に取得しない。庭の木々は別GLB（`public/models/sauna-garden.glb`）で、本体で準備完了にした後に読み込む。通信・解析に失敗しても3Dは続ける。材質のシェーダーリンク失敗は不完全な描画を続けず2Dへ戻る。
- `App` が所有する `EventTarget` に `SaunaRoom.onLoyly` から押下を通知。音は従来の `audio.playLoyly()` で一度だけ再生。3Dはロード完了後の通知だけを消費し、過去の通知は保存しない。
- 見回しはPointer Events／矢印キー。3DはUI外で入力を受け、UI復帰・モード切り替えは常に残す。モデル失敗・30秒タイムアウト・WebGLコンテキスト喪失・シェーダーリンク失敗時は3Dを解放し2D表示を継続。
- Blender元データは `blender/` に置くがGit管理外。元blendは加工済みで、上書き保存するスクリプトがある（実行前に複製する。各加工と加工前の版は `scripts/CLAUDE.md`）。追跡する書き出し処理は `scripts/export_web_glb.py`、配信物は `public/models/`、書き出しレポート（配信しない）は `docs/3d-export/`。QA記録 `docs/3d-qa/` はREADME・JSONのみGit管理し、画像（jpg/png）はローカルに置く（履歴の肥大を避けるため）。入力を保存しない。再実行方法・未完了事項は `docs/3d-sauna-progress.md`。
- `bunx tsc -b` / `bun run test` / `bun run lint` / `bun run format:check` / `bun run build` を検証する。ESLintはTS/TSXも対象（react-hooks・react-refreshルールを含む）。既存テストの段階的移行のため `no-explicit-any` は無効。
- 3Dの詳細は作業対象ディレクトリの CLAUDE.md にある：描画・材質・照明は `src/components/3d/CLAUDE.md`、GLB書き出し・シーン定義は `scripts/CLAUDE.md`、実ブラウザ検証（`bun run test:browser` / `:soak` / `:visual` / `:network`）は `e2e/CLAUDE.md`。3D表示の失敗・読み込み期限・外気浴背景の契約は `src/components/CLAUDE.md`。

- 空間音響は `src/hooks/spatialAudio.ts`。既存AudioContextの2本の固定バスでストーブ（サウナ環境音・ロウリュ）と注水口（水風呂音）をHRTF定位する。風・バイノーラル音は従来の経路を維持。
- `App → SceneMode → SaunaScene` に同一 `audio` を渡す。シーン定義の座標とカメラの位置・前方・上方向を `audio.setSpatialPose()` で反映し、アンマウント時は `null` で2D音へクロスフェード。モデル再読込・新たなAudioContextや音源の作成は行わない。AudioListenerの位置パラメータ非対応時は従来音へフォールバック。

## UIの補足

- 表示設定の「体験を終える」はサウナ・水風呂・外気浴のすべてから終了画面へ進む。遷移中は無効。未完了セットはスコアに追加せず、終了画面では「完了したセット」と実滞在時間を表示する。
- 温度・湿度・体感温度とロウリュの上昇幅は整数で表示する。
- 滞在時間は「目安 50秒」のように明示し「好きなタイミングで次へ」を添える。入室前の景色選択には選択中の2D／3Dの説明を添える。
- 2Dの暗幕は景色の質感を残す濃さに抑え、見出し・呼吸文字の局所的な影で可読性を確保する。
- `prefers-reduced-motion: reduce` では呼吸リングと伸縮を消し、4秒ごとの文字案内を残す。スコアは即時確定値を表示し、表示中に動作抑制を有効にした場合もアニメーションを終了する。

- 入室前に「1セットは約1〜2分から」と自由な移動の案内を出す。初回のロウリュ案内には「景色だけ見る」で操作を隠せることも添える。外気浴は継続と終了を同じ強さのボタンで示す。

- 心拍数には「（演出）」を添え、実測値との区別を示す。入室前のキーボード案内は「操作方法」の details にまとめ、タッチ専用端末では隠す。
