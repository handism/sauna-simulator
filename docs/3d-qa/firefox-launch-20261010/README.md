# Firefox起動障害（2026-10-10）

Playwright配布のFirefox Nightly 155.0 build 15526.9.2を使い、`playwright.firefox.config.ts` で既存5件のライフサイクル検査を実行した。全5件がページ作成前に `Could not find profile folder` で起動失敗。0件成功。アプリの互換性失敗でも成功でもない。

通常のOS一時プロファイル、`TMPDIR=/private/tmp`、固定 `/private/tmp/sauna-firefox-profile` の3方法で同じエラー。固定フォルダーは存在し所有者読み書き可能（0700）だが、ブラウザは起動しない。各起動は許可された実行環境で行った。製品コードやブラウザのセキュリティ設定を変えて起動を迂回していない。

検査設定を保存した。再開にはこのOSで起動可能なFirefox／Playwright環境が必要。Nightly結果を安定版Firefoxの承認とは扱わない。

```sh
TMPDIR=/private/tmp bun run test:browser --config playwright.firefox.config.ts --reporter=json > /private/tmp/sauna-firefox-lifecycle.json
```

## 起動だけの切り分けと上流調査（2026-10-10）

Playwright 1.63.0・macOS 27.0.1・arm64で、サーバーも製品ページも使わない `firefox.launch()` を再実行した。15秒の起動期限より前に `Could not find profile folder` で終了し、ページは作られなかった。[記録](preflight.json) にロックファイル・診断スクリプト・生ログのSHA-256を保存した。終了コード1は診断の実行失敗ではなく、ブラウザ起動の不成功を表す。ログは同じ出力名の `.log`（Git管理外）に保存する。

```sh
node scripts/diagnose_firefox_launch.mjs docs/3d-qa/firefox-launch-20261010/preflight.json
```

[Playwright #42768](https://github.com/microsoft/playwright/issues/42768) は、macOS 27で一時 `-profile` と別にFirefox共通データ領域へアクセスし、OSの保護によって起動が失敗する問題を報告している。同じ1.63.0／Firefox 155.0のエラーが記載され、9月30日のメンテナーコメントではFirefox 158で上流修正、10月10日の確認時点でissueはopen・ラベルv1.65だった。[Mozilla #2060476](https://bugzilla.mozilla.org/show_bug.cgi?id=2060476) でも直接実行時のデータアクセス制限が報告されている。今回の観測はこの問題と整合するが、OSの拒否ログを採取していないため、このマシンでの原因を確定したとは扱わない。

再開条件は、修正を含むPlaywright配布ブラウザまたは起動可能な別環境で、この最小診断が成功すること。その後に上のライフサイクル5件を実行する。最小診断の成功だけではWebGL・3D・2D復帰の互換性を承認しない。依存更新は修正版の配布を確認してから別の変更として検証する。OS権限、共通Firefoxデータ、ブラウザ署名・ブランド、セキュリティ設定は今回変更していない。

## macOSアクセス拒否ログの照合（2026-10-10）

最小起動をサンドボックス内と許可された外側で再実行し、両方でページ作成前に同じprofile folderエラーを確認した。[照合記録](os-access-validation.json) に起動時刻・PID・入力ハッシュと必要なOSログだけを保存した。

17:32:08の起動PID 98232に対するTCC要求には `kTCCServiceSystemPolicyAppDataDetailed` と対象 `org.mozilla.firefox` があり、同じ時刻にapp bundleとの関連付けを要求するCode 9とTCC拒否が記録された。OS側のデータアクセス拒否を実際に観測できた。一方、このPIDはサンドボックス内の起動であり、17:32:52のサンドボックス外PID 98436には今回の検索条件で対応する拒否ログが返らなかった。両起動の原因が同一であることや、OS拒否が唯一の原因であることは断定しない。

ログ取得は読み取りのみ。権限付与・Firefox共通データ・依存・製品コードは変更していない。Firefoxの製品検証成功は引き続き0件。修正版または起動可能な環境で最小診断を通す再開条件を維持する。
