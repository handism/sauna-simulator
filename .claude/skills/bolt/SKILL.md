---
name: bolt
description: AI-DLC Construction Phase（後半）。Domain Modelを受け取り、Logical Design → コード生成 → Deployment Unit → テスト生成・実行 → PRまでを1 Boltとして一気通貫で実行する。
argument-hint: <unit名> (例: "post-unit", "follow-unit")
---

# Construction Phase — Bolt 実行（AI-DLC）

対象Unit: `$ARGUMENTS`

## ステップ 1: プランファイルを作成する

`aidlc-docs/plans/bolt_<unit>_plan.md` を以下の形式で作成する：

```markdown
# Bolt Plan: <Unit名>

## ステップ
- [ ] 1. Domain ModelとUser Storiesの確認
- [ ] 2. Logical Design（NFR・設計パターンの適用）
- [ ] 3. ADRの作成（重要な技術判断がある場合）
- [ ] 4. コード生成
- [ ] 4b. Deployment Unit生成（インフラ成果物）
- [ ] 5. テスト生成（ユニット・統合・受け入れ・セキュリティ・負荷）
- [ ] 6. テスト実行・結果分析・修正提案
- [ ] 7. GitHub Issue作成 → PR作成
- [ ] 8. ユーザー承認・確定
```

プランを提示してユーザーの承認を得る。**承認前に次のステップへ進まない。**

---

## ステップ 2: インプットの確認

以下を読み込む：
- `aidlc-docs/design-artifacts/<unit>_domain_model.md`（Domain Model）
- `aidlc-docs/story-artifacts/<unit>.md`（User Stories・NFR）
- `aidlc-docs/requirements/measurement_criteria.md`（Measurement Criteria）

Logical Designで使用する技術スタックを確認する。`CLAUDE.md` の技術スタックセクションを参照し、未決定の場合はユーザーに確認する。

不明点があればユーザーに質問する。チェックボックスを完了にする。

---

## ステップ 3: Logical Design

`aidlc-docs/design-artifacts/<unit>_logical_design.md` に記録する：

```markdown
# Logical Design: <Unit名>

## NFR対応方針
| NFR | 適用パターン/技術 | 理由 |
|----|----------------|-----|
| スケーラビリティ | ... | ... |
| セキュリティ | ... | ... |

## アーキテクチャパターン
- 採用パターン: <パターン名>（例: CQRS、Event Sourcing、Repository）
- 理由: <なぜこのパターンか>

## コンポーネント→実装マッピング
| Domain Component | 実装クラス/モジュール | 技術 |
|----------------|-----------------|-----|
| <コンポーネント名> | <ファイル名> | <言語/フレームワーク> |

## テスト実行コマンド
- ユニットテスト: <コマンド>
- 統合テスト: <コマンド>
- セキュリティテスト: <ツール名・コマンド>
- 負荷テスト: <ツール名・コマンド>

## 却下した代替案
| 案 | 却下理由 |
|---|---------|
| ... | ... |
```

重要な技術判断（ライブラリ選定・DB・インフラ等）があれば「ステップ 3a: ADR作成」に分岐する。

ユーザーに確認・承認を求める。チェックボックスを完了にする。

---

## ステップ 3a: ADR作成（必要な場合）

`aidlc-docs/design-artifacts/adr-NNN-<title>.md` に以下の形式で保存する：

```markdown
# ADR-NNN: <決定タイトル>

**日付:** YYYY-MM-DD
**ステータス:** 採用

## 背景
<なぜこの決定が必要か>

## 決定
<採用した選択肢と理由>

## 代替案と却下理由
- **<案A>:** <却下理由>
- **<案B>:** <却下理由>

## 影響
- ポジティブ: ...
- トレードオフ: ...
```

---

## ステップ 4: コード生成

Logical Designに基づきコードを生成する。

- コードは適切なディレクトリ構造に配置する
- Well-architected principlesに従う
- 各ファイルの冒頭に責務コメントを記載する

生成したファイル一覧をユーザーに提示する。チェックボックスを完了にする。

---

## ステップ 4b: Deployment Unit 生成

Logical Designで選択したインフラ技術に基づき、デプロイ可能な成果物を生成する。

生成対象（技術スタックに応じて選択）：
- **コンテナ環境:** `Dockerfile`、`docker-compose.yml`
- **Kubernetes:** Helm Chart（`charts/<unit>/`）
- **サーバーレス:** AWS Lambda関数パッケージ設定（`serverless.yml` または SAM テンプレート）
- **IaC:** Terraform または CloudFormation スタック（`infra/<unit>/`）

`aidlc-docs/design-artifacts/<unit>_deployment.md` に生成物の一覧と用途を記録する：

```markdown
# Deployment Unit: <Unit名>

| 成果物 | パス | 用途 |
|--------|------|------|
| Dockerfile | <path> | コンテナイメージビルド |
| ... | ... | ... |
```

**技術スタック未定の場合:** このステップをスキップし、「技術スタック確定後に `/bolt <unit>` を再実行してDeployment Unitを生成する」とユーザーに案内する。

チェックボックスを完了にする。

---

## ステップ 5: テスト生成

以下の5種類のテストを自動生成する：

- **ユニットテスト:** 各コンポーネントの振る舞いを検証
- **統合テスト:** コンポーネント間の連携を検証（必要な場合）
- **受け入れテスト:** Acceptance Criteriaに基づくシナリオ（Gherkin形式推奨）
- **静的セキュリティテスト:** 認証・認可ロジック、入力バリデーション、機密情報のハードコードを検証するテストケース（使用ツールはLogical Designで決定した技術スタックに依存）
- **負荷テストシナリオ:** `aidlc-docs/requirements/measurement_criteria.md` のパフォーマンス目標値に対応した負荷シナリオ（使用ツールはLogical Designで決定）

テストシナリオをユーザーに確認し、漏れ・誤りを修正する。チェックボックスを完了にする。

---

## ステップ 6: テスト実行・分析・修正

Logical Design（ステップ3）で記録したテスト実行コマンドを使用してテストを実行する。技術スタックが未決定の場合はユーザーに実行コマンドを確認する。

実行結果を分析し：
- 失敗したテストの原因を特定する
- 修正案を提示してユーザーの承認を得る
- 承認後に修正を適用し再実行する

チェックボックスを完了にする。

---

## ステップ 7: GitHub Issue・PR作成

1. `gh issue create` でこのBoltに対応するIssueを作成する（User Storiesを本文に含める）

```sh
gh issue create \
  --title "<Unit名>: <Bolt内容の概要>" \
  --body "## User Stories\n<user_stories.md の内容>\n\n## Acceptance Criteria\n<acceptance criteria>"
```

2. フィーチャーブランチを作成してコードをコミットする

```sh
git checkout -b feat/<unit名>
git add <変更ファイル>
git commit -m "feat(<unit>): <変更内容の概要>"
git push -u origin feat/<unit名>
```

3. `gh pr create` でPRを作成する（Issueと紐付ける）

```sh
gh pr create \
  --title "feat(<unit>): <変更内容の概要>" \
  --body "## 概要\n<変更内容>\n\nCloses #<Issue番号>"
```

---

## 完了

全ステップ完了後：

1. `aidlc-docs/prompts.md` にこのセッションのプロンプトを追記する
2. 次のBoltまたはOperations Phaseへの案内を行う
