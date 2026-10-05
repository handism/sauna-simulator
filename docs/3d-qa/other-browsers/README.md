# 他ブラウザとシェーダーの初回コンパイル（2026-10-05、確認）

残件「他ブラウザ」。PlaywrightのWebKit（26.6）・Chrome for Testing（153.0.8010.12、以下CfT）・インストール済みChrome（154.0.8037.97）で、3Dの読み込み・全ステージ・3画質を通した。
Firefox（Playwright 155.0）はこの環境では `Could not find profile folder.` で起動できず（プロファイル・HOMEを指定しても同じ）、未確認。
いずれもmacOS・Apple GPU（ANGLE Metal）・headless・1200×800・DPR 1.5・動作抑制・`?frameRate=full`。PlaywrightのWebKitはSafariではない。

**WebKitでも3Dは動き、画像もChromeとほぼ同じ。ただし、ブラウザを問わずMetalのシェーダーキャッシュがない初回は、入室時にメインスレッドが約6〜15秒止まる。** これまでの読み込み時間（約0.4秒）はすべてキャッシュが効いた状態の値だった。製品の動作は変えていない。

## 動作と画像

- WebKit：3画質とも準備完了・庭の読み込み・サウナ→水風呂→外気浴を通し、2Dへのフォールバックやエラーはなし。WebGL2、`EXT_color_buffer_float`・`KHR_parallel_shader_compile` あり（HDR出力・TAA・鏡像も有効）、`EXT_disjoint_timer_query_webgl2` はなし（GPU時間の計測はできない）。MAX_SAMPLES 4、テクスチャユニット16。
- 画像（各ステージで5秒後）：WebKitとChromeの差は平均ΔE 1.2〜2.3で、差はほぼUI（文字の描画・下部パネルの高さ）だけ。3Dの部分は目で見て同じ。CfTとChromeはサウナで平均ΔE 0.02。
- キャッシュが効いた状態のフレーム間隔の平均は各ステージ約16.7ms（60fps）。

## 初回のコンパイル

ANGLEのMetalバックエンドは、Metalのコンパイル済みシェーダーをOSのキャッシュ（`$(getconf DARWIN_USER_CACHE_DIR)/<アプリのID>/com.apple.metal/`）に置き、ブラウザを閉じても残る。
WebKit・CfTは検証専用のディレクトリを持つので、`SUI_COLD=1` で起動ごとに消して初回を再現した（Chromeのキャッシュは普段の閲覧と共用のため消していない）。
シェーダーに未使用のuniformを足して変える方法はキャッシュを確実には外せなかった。

| ブラウザ | 画質 | 初回 `data-load-ms` | うちWebGL呼び出しの同期待ち | 最長の停止 | 2回目 `data-load-ms` |
| --- | --- | ---: | ---: | ---: | ---: |
| CfT | 軽量 | 7049 | 5.8秒 | 5.8秒 | 472 |
| CfT | 標準 | 15669 | 14.7秒 | 14.5秒 | 643 |
| CfT | 高精細 | 15606 | 14.7秒 | 14.4秒 | 638 |
| WebKit | 軽量 | 6903 | 5.6秒 | 5.7秒 | 367 |
| WebKit | 標準 | 15801 | 14.9秒 | 14.6秒 | 428 |
| WebKit | 高精細 | 15858 | 14.9秒 | 14.7秒 | 426 |
| Chrome（キャッシュあり） | 3画質 | 353〜442 | 0.1秒未満 | 0.1秒前後 | 462〜527 |

「最長の停止」は10msのタイマーの間隔。どれも最初のリンクから約1.04秒後（読み込み時の待ちの上限1秒が切れた直後）に始まり、最初の描画の中でthreeが各プログラムの `getProgramInfoLog` を呼ぶたびに待たされる（1回0.3〜0.4秒が約40回、GPUプロセスに積まれた分をまとめて待つ1回が約5.5秒）。
重いのは特定の1材質ではなく、約16万字の材質シェーダーが約40通り（同じ材質の側面の像 `SUI_SIDE_IMAGE`・`SUI_SIDE_FLIPPED`・`SUI_SIDE_TESTED`、`SUI_HARD_SHADOW`、影マスクなどの組み合わせ）あること。
CfTの初回（高精細）は、水風呂で5秒以内に180フレームがそろわず、動的解像度が1まで下がった（2回目は1.25。ステージ変更で初めて描く物のコンパイルとみられるが切り分けていない）。

### 待ちの上限を延ばしても止まる

読み込み時の待ちの上限を60秒にした一時ビルドでも、WebKitの初回は約1.6秒後に14.3秒止まった（`data-load-ms` 16149、標準。[値](no-limit.json)、旧版のスクリプトで材質名なし）。
WebKit・CfTとも `COMPLETION_STATUS_KHR` は実際のコンパイルの前に真になる。合成の重いシェーダー（`diagnose_metal_pipeline.mjs`、[値](metal-pipeline.json)）で：

- 8プログラムをリンクして0／3／10秒待っても、完了の通知は0.5〜1.5秒で来るのに、最初の描画は待ち時間によらず1回約1.2秒かかる。待っている間に裏でMetalのコンパイルは進まない。
- 1×1のRGBA8に描いた後、800×600のRGBA16F・4倍MSAAに描くとまた約1.2秒、ブレンドを有効にするとさらに約1.1秒かかる（同じ1×1に描き直すと0ms）。描画先の形式・標本数・ブレンドの組み合わせごとにコンパイルし直す。

このため、`compile()` の待ちを延ばす・小さな画面外ターゲットに描いて温める方法では止まりは消えない。温めるなら本物の描画と同じ描画先・状態で描く必要がある。

## 判断

製品の動作は変えていない。初回の停止（約6〜15秒、DPRによらない）はmacOSのChrome・Safariの初めての訪問者に起きる見込みで、ブラウザやOSの更新でキャッシュが無効になったときにも再び起きうる。
対策の候補（未実施）：本物の描画を材質ごとに分けて複数フレームで温める（合計は変わらないが1回の停止を短くする。30秒の期限との関係を要検討）、側面の像などのプログラムの組み合わせを減らす（画像が変わり得る）。

範囲：macOS・Apple GPUのみ。実際のSafari、Windows（D3D11）・Android・iOS、遅い端末での初回の長さ（30秒の期限に届くか）は未確認。

## 再実行

```sh
bunx playwright install webkit chromium   # 初回のみ
bun run build && bun run preview -- --host 127.0.0.1 --port 4191 --strictPort &
SUI_COLD=1 node scripts/diagnose_other_browsers.mjs http://127.0.0.1:4191/sauna-simulator/ docs/3d-qa/other-browsers/cold.json /tmp/sui-shots cft,webkit
node scripts/diagnose_other_browsers.mjs http://127.0.0.1:4191/sauna-simulator/ docs/3d-qa/other-browsers/chrome.json /tmp/sui-shots chromium
node scripts/diagnose_metal_pipeline.mjs docs/3d-qa/other-browsers/metal-pipeline.json
```

`SUI_QUALITIES=standard` で画質を絞れる。画像（`/tmp/sui-shots`）はGit管理外。
