---
name: domain
description: AI-DLC Construction Phase（前半）。指定UnitのDomain Model（コンポーネント・属性・振る舞い・関係）を設計する。コードは生成しない。
argument-hint: <unit-fileのパス> (例: "aidlc-docs/story-artifacts/post-unit.md")
---

# Construction Phase — Domain Model 設計（AI-DLC）

対象Unit: `$ARGUMENTS`

## ステップ 1: プランファイルを作成する

`aidlc-docs/plans/domain_model_plan.md` を以下の形式で作成する：

```markdown
# Domain Model Plan: <Unit名>

## ステップ
- [ ] 1. Unitのuser storiesを読み込み・整理
- [ ] 2. コンポーネント（エンティティ・値オブジェクト・集約）の特定
- [ ] 3. コンポーネント間の関係・責務の定義
- [ ] 4. 主要ユースケースの動的モデル（シーケンス）
- [ ] 5. ドメインイベントの特定
- [ ] 6. ユーザー承認・確定
```

プランを提示してユーザーの承認を得る。**承認前に次のステップへ進まない。**

---

## ステップ 2: User Stories の読み込み

`$ARGUMENTS` ファイルを読み込み、実装すべきUser Storiesと Acceptance Criteria を把握する。

不明点があればユーザーに質問する。チェックボックスを完了にする。

---

## ステップ 3: コンポーネントの特定

DDD原則（Entity・Value Object・Aggregate・Repository・Factory）に基づき、コンポーネントを特定する。

`aidlc-docs/design-artifacts/<unit-name>_domain_model.md` に記録する：

```markdown
# Domain Model: <Unit名>

## コンポーネント一覧

### <コンポーネント名>（Entity / Value Object / Aggregate Root）
- **責務:** <何をするか>
- **属性:**
  - `<field>`: <型> — <説明>
- **振る舞い（メソッド）:**
  - `<method>(<args>)`: <説明>
- **不変条件（invariants）:**
  - <守るべきビジネスルール>
```

ユーザーに確認を求め、ビジネスロジックの漏れ・誤りを修正する。チェックボックスを完了にする。

---

## ステップ 4: コンポーネント間の関係

```markdown
## コンポーネント関係図

<コンポーネントA> ──(関係の種類)──> <コンポーネントB>
  説明: <なぜこの関係か>

## 集約境界
- 集約ルート: <コンポーネント名>
  - 内包するエンティティ: <リスト>
  - 整合性境界: <説明>
```

チェックボックスを完了にする。

---

## ステップ 5: 動的モデル（主要ユースケース）

User Storiesの中で最も複雑なユースケース2〜3つについて、コンポーネントの相互作用をシーケンスとして記述する：

```markdown
## ユースケース: <名前>

1. <コンポーネントA>.method() が呼ばれる
2. <コンポーネントA> が <コンポーネントB> に <操作> を依頼する
3. <イベント名> ドメインイベントが発行される
4. ...
```

チェックボックスを完了にする。

---

## ステップ 6: ドメインイベントの特定

```markdown
## ドメインイベント

| イベント名 | トリガー | 購読者 |
|-----------|---------|-------|
| <EventName> | <何が起きたとき> | <誰が受け取るか> |
```

---

## 完了

全ステップ完了後：

1. `aidlc-docs/prompts.md` にこのセッションのプロンプトを追記する
2. 「`/bolt <unit名>` でLogical Design・コード生成・テストに進めます」と案内する
