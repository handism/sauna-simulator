# Firefox起動障害（2026-10-10）

Playwright配布のFirefox Nightly 155.0 build 15526.9.2を使い、`playwright.firefox.config.ts` で既存5件のライフサイクル検査を実行した。全5件がページ作成前に `Could not find profile folder` で起動失敗。0件成功。アプリの互換性失敗でも成功でもない。

通常のOS一時プロファイル、`TMPDIR=/private/tmp`、固定 `/private/tmp/sauna-firefox-profile` の3方法で同じエラー。固定フォルダーは存在し所有者読み書き可能（0700）だが、ブラウザは起動しない。各起動は許可された実行環境で行った。製品コードやブラウザのセキュリティ設定を変えて起動を迂回していない。

検査設定を保存した。再開にはこのOSで起動可能なFirefox／Playwright環境が必要。Nightly結果を安定版Firefoxの承認とは扱わない。

```sh
TMPDIR=/private/tmp bun run test:browser --config playwright.firefox.config.ts --reporter=json > /private/tmp/sauna-firefox-lifecycle.json
```
