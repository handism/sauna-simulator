# CLAUDE.md

## 言語

- 利用者との会話、PRのタイトル・本文、GitHub上のコメントは日本語で書く

## コマンド

- パッケージマネージャは **bun**
- Vitest の設定は `vite.config.ts` の `test` に一本化している。`src/hooks/useAudioEngine.bench.test.ts` は名前に反して `describe`/`it` による通常のテストで、`bun run test` の対象に含まれる（`vitest bench` の対象ではない）
- 整形は Prettier（`bun run format` / `bun run format:check`、CIで検査）。Markdown・JSON・`docs/`・`public/` は対象外
- ビルドの警告上限は遅延ロードする3Dチャンクに合わせてあり、2Dで必ず取得する入口チャンクだけは `vite.config.ts` のプラグインが 500kB で警告する

## アーキテクチャ

### ステージ遷移フロー

ステージは `start → sauna → water → totonou` の順に進み、`totonou` から `sauna` に戻るループ構造になっている。「今日はここまで」は `finishSession()` で環境音をフェードアウトし、同じ遷移タイマーで `start` の終了画面へ戻る。`sessionSummary` は終了操作時のセット数・入室からの実時間を保持し、次の入室時に記録とともにリセットする。

- セッション状態と各ステージ完了時の操作（`completeSauna` など。setterは公開しない）は `src/hooks/useSaunaSession.ts` が保持し、`SaunaProvider` / `useSaunaContext`（`src/context/SaunaContext.tsx`）経由で配布する。`App.tsx` はセッション値をcontextから読み、ロウリュ通知用の `EventTarget` だけを保持する
- ステージ遷移は `changeStage()` が単一の1秒タイマーで管理する。`pendingStage` を設定してUIと背景を暗転し、1秒後にステージ・環境音を同時に切り替えてフェードインする。遷移中の二重操作は拒否し、ステージUIには `inert` を付ける
- 2D背景は現在のステージの1枚のみ描画する（`public/sauna_bg.webp`, `water_bg.webp`, `totonou_bg.webp`）。背景専用タイマーは持たず、3Dレイヤー・UIと同じ `opacity` で遷移する

### オーディオ

`src/hooks/useAudioEngine.ts` にカプセル化されており、**外部音声ファイルは一切使用しない**。すべて Web Audio API でプロシージャル生成している（ノイズ生成は `src/hooks/audioWorker.ts` の Web Worker 側で行い、要求・重複排除・失敗処理は `src/hooks/noiseWorkerClient.ts`）。

`SoundControl` は音の設定から全体音量（0〜100%）とミュートを操作する。音量はセッションのステージ移動・ミュートをまたいで保持し、再読み込み時は100%に戻る。`audio.setVolume()` と `setMuted()` は同じmaster gainを更新し、追加のAudioContext／音源は作らない。ミュート中の音量操作では解除しない。設定ポップアップ共通の外側クリック・Escape処理は `useDismissibleDetails`。

`audio.init()` はユーザーインタラクション（スタートボタン）のタイミングで呼ぶ必要がある（ブラウザの autoplay 制限対応）。

## 規約・パターン

### スタイリング
- 共通 UI は `.glass-panel` と `.primary-btn`。通常の操作は下部の `.stage-dock` にまとめ、心拍・体感温度・ととのい度はネイティブ `details` で開く。`ActionIcon` の線画アイコンと木・石・水を基調とする配色を使う。UI非表示は見出し・操作パネル・呼吸ガイドを隠し、音・表示復帰・設定の操作は残す。「表示設定」の「UIを隠しても呼吸ガイドを残す」で呼吸だけ維持できる（`sui-keep-breathing`）。見出しには局所的な暗色グラデーション、呼吸の文字には暗色の面を敷く。
- `StageDock` はコンパクト／詳細の切替を担当（`sui-dock`、パネル上端の取っ手）。コンパクト時も時間・主操作・表示復帰は残し、ロウリュの上昇幅は `.loyly-compact-delta` で出す。ステージ見出しの進み具合とセット数は `StageStep`。`FirstVisitGuide` はサウナの初回案内を担当し、明示的な「わかりました」で以後非表示（`sui-guide-dismissed`）。ストレージが使えなくても操作を継続する。
- 色・角丸は `index.css` の `:root` の変数（`--ink` 系の文字色、`--wood`・`--water`・`--moss`、`--radius-*` など）を使い、値を直接書かない。木の色の塗りは各場面の主操作（`Space` と同じ操作）に付ける。ガラスパネルは2Dでは景色を透かし、3D表示中は描画負荷を避けるためブラーを外して不透明寄りにする
- 右上のアイコン操作（全画面・UI・音の設定・表示設定）は `.app-toolbar` に横並びで置く。入室前は表示設定だけを出す。ボタンの hover の浮き上がりは `(hover: hover)` の環境だけで、押下時は `:active` で沈む
- 外部フォントは読み込まない（OS標準の和文・欧文フォントスタック）
- ステージ固有の色や背景はコンポーネント内のインラインスタイルで上書きする。ただし状態で切り替わる見た目（外気浴の呼吸の吸う/吐く）は `data-*` 属性と `index.css` のセレクタで切り替える

### コンポーネント設計
- 各ステージコンポーネント（`SaunaRoom`, `CoolingBath`, `TotonouSpace`）は `onNext` コールバックを受け取り、次ステージへの遷移をトリガーする。記録は名前付きのオブジェクト（`useSaunaSession.ts` の `SaunaResult` / `WaterResult`）で渡す。セットごとのととのい度（`scoreHistory`）は水風呂を出る遷移が受け付けられたときに `useSaunaSession` が確定し、入室ごとにリセットする。ととのい度の段階（`TOTONOU_TIERS`）はフィードバック文と表示色（`src/utils/scoreColor.ts`、色は棒にだけ付ける）で共有する。セットごとの推移は `ScoreHistory` で外気浴と終了画面に出す（`sessionSummary.scores`）。サウナ・水風呂の滞在時間表示（`StayTimer`）の目安は、ととのい度が満点になる `STAY_TARGET_SECONDS` と共有する。外気浴の振り返りはセット数・サウナ／水風呂の滞在時間を先に表示し、スコアは入れ子のdetailsに置く。メーターはスコアを初めて開いたときに上がり始める。終了画面でもスコアは任意で展開する
- `audio` と各種セッション値は `App.tsx` が `useSaunaContext()` から取得し、props で各コンポーネントに渡す。コンポーネント側は context を直接参照しない

### キーボードショートカット・全画面
- 単キーのショートカットは `src/hooks/useKeyboardShortcut.ts`。`M`（ミュート）・`U`（UI表示）は入室後、`F`（全画面、`src/hooks/useFullscreen.ts`）は常時 `App.tsx` が登録する。`Space` は各ステージが自分の主操作（サウナはロウリュ、水風呂・外気浴は次へ）に `scope` 付きで登録し、遷移中の `inert` なステージでは無視する
- 修飾キー付き・リピート・IME変換中・フォーム部品への入力は奪わない。キーボードでフォーカスしたボタン上の `Space` はブラウザ標準の押下に任せ、クリックでフォーカスが残ったボタンではフォーカスを外してショートカットを優先する（Chromeではキー入力後に `:focus-visible` で判別できないため、ポインタ由来のフォーカスを記録する）
- Fullscreen API 非対応環境（iPhone Safari）では全画面ボタンと案内を出さない

## 3Dサウナ試験版

- `?view=3d` または「表示設定」内の「3Dを試す」で有効化。時間帯・画質・素材クレジットも同じメニューにまとめる。メニューは Escape・外側のポインタ操作・ステージ変更で閉じる。`?view=2d` は保存済みの選択を上書きする。選択は `sui-view-mode` に保存し、未選択時は2D。
- `SceneMode` は表示設定・ロード状態を管理し、セッションを作り直さない。render propで同じモード状態・切替操作と表示設定メニューを渡し、入室画面の2D／3Dの切り替えと `.app-toolbar` で使う（render propなしでは自分でメニューを描画する）。選択だけでは3Dを取得せず、入室後に読み込む。サウナ・水風呂・外気浴の3ステージに対応し、ステージ変更時はモデルと描画ループを保持して視点だけを更新する。
- Three.js 0.186.0を直接ラップした `src/components/3d/SaunaScene.tsx` は `React.lazy` で遅延ロードする。3D専用チャンクは通常の2D利用時に取得しない。庭の木々は別GLB（`public/models/sauna-garden.glb`）で、本体で準備完了にした後に読み込む。失敗しても3Dは続ける。
- `App` が所有する `EventTarget` に `SaunaRoom.onLoyly` から押下を通知。音は従来の `audio.playLoyly()` で一度だけ再生。3Dはロード完了後の通知だけを消費し、過去の通知は保存しない。
- 見回しはPointer Events／矢印キー。3DはUI外で入力を受け、UI復帰・モード切り替えは常に残す。モデル失敗・30秒タイムアウト・WebGLコンテキスト喪失時は3Dを解放し2D表示を継続。
- Blender元データは `blender/` に置くがGit管理外。元blendは水の側面・底をフラット化済み（`scripts/flatten_water_sides.py`、修正前は `SUI_Retreat_v11.blend`）で、Worldには拡散反射を経ない経路にだけ見える空（雲・日光の円盤・星）を入れてある（`scripts/build_sky_world.py`、入れる前は `SUI_Retreat_v12.blend`。照明は変わらない）。月夜のシーン `SUI • Night` を追加してある（`scripts/build_night_scene.py` と `build_sky_world.py --keys night`、追加前は `SUI_Retreat_v13.blend`。昼・ブルーアワーは不変）。追跡する書き出し処理は `scripts/export_web_glb.py`、配信物は `public/models/`、書き出しレポート（配信しない）は `docs/3d-export/`。QA記録 `docs/3d-qa/` はREADME・JSONのみGit管理し、画像（jpg/png）はローカルに置く（履歴の肥大を避けるため）。入力を保存しない。再実行方法・未完了事項は `docs/3d-sauna-progress.md`。
- `bunx tsc -b` / `bun run test` / `bun run lint` / `bun run format:check` / `bun run build` を検証する。ESLintはTS/TSXも対象（react-hooks・react-refreshルールを含む）。既存テストの段階的移行のため `no-explicit-any` は無効。
- 3Dの詳細は作業対象ディレクトリの CLAUDE.md にある：描画・材質・照明は `src/components/3d/CLAUDE.md`、GLB書き出し・シーン定義は `scripts/CLAUDE.md`、実ブラウザ検証（`bun run test:browser` / `:soak` / `:visual` / `:network`）は `e2e/CLAUDE.md`。3D表示の失敗・読み込み期限・外気浴背景の契約は `src/components/CLAUDE.md`。

- 空間音響は `src/hooks/spatialAudio.ts`。既存AudioContextの2本の固定バスでストーブ（サウナ環境音・ロウリュ）と注水口（水風呂音）をHRTF定位する。風・バイノーラル音は従来の経路を維持。
- `App → SceneMode → SaunaScene` に同一 `audio` を渡す。シーン定義の座標とカメラの位置・前方・上方向を `audio.setSpatialPose()` で反映し、アンマウント時は `null` で2D音へクロスフェード。モデル再読込・新たなAudioContextや音源の作成は行わない。AudioListenerの位置パラメータ非対応時は従来音へフォールバック。
