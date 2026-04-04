---
name: intent
description: AI-DLC Inception Phase。高レベルのIntentを受け取り、User Stories・NFR・リスク・Measurement Criteria・Unitsへ分解する。Mob Elaboration リチュアルに相当。
argument-hint: <Intentの説明> (例: "投稿・フォロー・タイムライン機能を持つSNSを作る")
---

# Inception Phase — Intent → Units（AI-DLC）

Intent: `$ARGUMENTS`

## ステップ 1: プランファイルを作成する

`aidlc-docs/plans/intent_plan.md` を以下の形式で作成する：

```markdown
# Intent Plan: <Intentのタイトル>

## ステップ
- [ ] 1. Intent の明確化（AIからの質問）
- [ ] 1b. PRFAQ の作成（オプション：複雑なIntentの場合）
- [ ] 2. User Stories の生成
- [ ] 3. NFR（非機能要件）の定義
- [ ] 4. リスク記述
- [ ] 5. Measurement Criteria の定義
- [ ] 6. Units への分解
- [ ] 7. Bolts の提案
- [ ] 8. ユーザー承認・確定
```

プランを提示してユーザーの承認を得る。**承認前に次のステップへ進まない。**

---

## ステップ 2: Intent の明確化

以下の質問をユーザーに投げかけ、Intent の曖昧さを取り除く：

- 主なユーザーは誰か？
- このIntentで達成すべきビジネスアウトカムは何か？
- MVP（最小限の範囲）と将来拡張の境界はどこか？
- 既存システムとの統合制約はあるか？

回答をもとに Intent を再定義し、`aidlc-docs/requirements/intent.md` に保存する。

チェックボックスを完了にする。

---

## ステップ 2b: PRFAQ の作成（オプション）

Intentが複雑・大規模な場合、Working Backwards形式でPRFAQを作成するとIntent の明確化が促進される。

`aidlc-docs/requirements/prfaq.md` に以下の形式で保存する：

```markdown
# PRFAQ: <サービス/機能名>

## Press Release（プレスリリース）
<完成後のユーザー向けプレスリリースを想定して記述する>

## FAQ — 顧客向け
**Q: <想定される顧客からの質問>**
A: <回答>

## FAQ — 社内向け
**Q: <技術・運用上の懸念事項>**
A: <回答>
```

シンプルなIntentの場合はこのステップをスキップしてよい。チェックボックスを完了（またはスキップ）にする。

---

## ステップ 3: User Stories の生成

`aidlc-docs/story-artifacts/user_stories.md` に以下を生成する：

```markdown
# User Stories — <Intent名>

## <Story ID>: <タイトル>
**As a** <ユーザータイプ>,
**I want to** <達成したいこと>,
**So that** <得られる価値>.

### Acceptance Criteria
```gherkin
Scenario: <シナリオ名>
  Given <前提条件>
  When  <操作>
  Then  <期待される結果>
```
```

ユーザーに確認を求め、under/over-engineered な部分を修正する。チェックボックスを完了にする。

---

## ステップ 4: NFR（非機能要件）の定義

`aidlc-docs/requirements/nfr.md` に記録する：

| カテゴリ | 要件 | 測定基準 |
|---------|------|---------|
| パフォーマンス | ... | ... |
| スケーラビリティ | ... | ... |
| セキュリティ | ... | ... |
| 可用性 | ... | ... |

ユーザーに確認してチェックボックスを完了にする。

---

## ステップ 5: リスク記述

`aidlc-docs/requirements/risks.md` に記録する：

| リスクID | 説明 | 影響度 | 対策 |
|---------|------|-------|-----|
| R-001 | ... | 高/中/低 | ... |

---

## ステップ 6: Measurement Criteria の定義

ビジネスIntentの達成を測定する指標セットを定義する。
NFR（システム特性）との違い：NFRは「システムがどう動くか」、Measurement Criteriaは「ビジネス目標が達成されたかどうか」を測る。

`aidlc-docs/requirements/measurement_criteria.md` に記録する：

```markdown
# Measurement Criteria — <Intent名>

| Story ID | 指標 | 測定方法 | 目標値 | Intentとの紐付け |
|---------|------|---------|-------|----------------|
| US-001 | <何を測るか> | <どう測るか> | <目標値> | <どのビジネスゴールに対応するか> |
```

**例:**
| Story ID | 指標 | 測定方法 | 目標値 | Intentとの紐付け |
|---------|------|---------|-------|----------------|
| US-001 | 投稿作成成功率 | APIレスポンスコード監視 | 99.9%以上 | ユーザーがゆるく繋がれるSNSを使えること |
| US-003 | タイムライン表示速度 | フロントエンドメトリクス | P95 < 1秒 | 快適な閲覧体験の提供 |

ユーザーに確認してチェックボックスを完了にする。

---

## ステップ 7: Units への分解

DDD の高凝集・疎結合の原則に基づき User Stories を Units に分類する。

各Unitは `aidlc-docs/story-artifacts/<unit-name>.md` として個別ファイルに保存する：

```markdown
# Unit: <Unit名>

## 概要
<このUnitが実現する価値>

## 含まれるUser Stories
- <Story ID>: <タイトル>
- <Story ID>: <タイトル>

## 他Unitとの依存関係
- 依存先: <Unit名>（理由）
- 依存元: <Unit名>（理由）
```

ユーザーに提示し、Unit の境界が適切か確認する。チェックボックスを完了にする。

---

## ステップ 8: Bolts の提案

各Unitを実装するための Bolt 計画を提案する。

```markdown
# Bolt 計画

| Unit | Bolt | 内容 | 並列/直列 |
|------|------|------|---------|
| <Unit名> | Bolt-1 | <実装スコープ> | 並列可 |
| <Unit名> | Bolt-2 | <実装スコープ> | Bolt-1の後 |
```

複数Unitを並列開発する場合は **Mob Construction** を推奨する（各チームが `/domain` 完了後に統合仕様を交換し、依存関係を合意してから `/bolt` を実行する）。

---

## 完了

全ステップ完了後：

1. `aidlc-docs/prompts.md` にこのセッションのプロンプトを追記する
2. 「`/domain <unit-file>` でConstruction Phaseを開始できます」と案内する
