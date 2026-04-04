# template

個人的プロジェクトテンプレート。
このプロジェクトはAWS提唱の **AI-Driven Development Lifecycle (AI-DLC)** に従って開発する。

---

## AI-DLC 基本ルール

### 1. 必ずプランを先に作る（Plan-First）

**作業を始める前に必ずプランファイルを作成し、承認を得てから実行する。**

- プランは `aidlc-docs/plans/<plan-name>.md` にチェックボックス付きで保存する
- 各ステップで判断が必要な場合はユーザーに確認を求め、独断で決定しない
- 承認後、1ステップずつ実行し、完了したらチェックボックスを更新する

### 2. AIが会話を主導する（AI-Initiated）

AIがワークフローを分解・提案し、人間は承認・修正・意思決定を担う。
人間からの指示に対して、まずAIが「次のステップ」を提案する形で進める。

### 3. すべての成果物を `aidlc-docs/` に保存する

```
aidlc-docs/
├── plans/            # プランファイル（チェックボックス付き .md）
├── requirements/     # 要件・PRFAQ・NFR・リスク・Measurement Criteria
├── story-artifacts/  # User Stories・Acceptance Criteria・Units
├── design-artifacts/ # Domain Model・Logical Design・ADR・Deployment Unit
└── prompts.md        # セッション内で使用したプロンプトの記録
```

---

## AI-DLC 用語・成果物

| 用語                     | 説明                                                                                                        | 対応する旧概念           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| **Intent**               | 達成すべき高レベルの目的・ビジネスゴール                                                                    | Epic / Feature Request   |
| **PRFAQ**                | Working Backwards形式でIntentを具体化する文書（Press Release + FAQ）。複雑なIntentで推奨                    | Vision Document          |
| **Measurement Criteria** | ビジネスIntentの達成を測定する指標セット。NFR（システム特性）とは異なり「ビジネス目標が達成されたか」を測る | KPI / Success Metrics    |
| **Unit**                 | IntentをDDD観点で分解した自己完結した作業単位                                                               | Subdomain / Epic         |
| **Bolt**                 | 1つのUnitを実装する最小イテレーション（時間〜日単位）                                                       | Sprint（週単位より短い） |
| **Domain Design**        | Unitのビジネスロジックをインフラ非依存でモデル化                                                            | ドメインモデル           |
| **Logical Design**       | Domain DesignにNFRと設計パターンを適用した論理設計                                                          | アーキテクチャ設計       |
| **Deployment Unit**      | テスト済みの実行可能な成果物（コンテナ、Lambda等）とその設定（Helm Chart、Terraform等）                     | リリース成果物           |

---

## フェーズとスキル対応

### Inception Phase（インセプション）

Intent → PRFAQ → User Stories → NFR → Risks → Measurement Criteria → Units の定義

| スキル           | 内容                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `/intent <説明>` | Intentを受け取り、User Stories・NFR・Measurement Criteria・Unitsへ分解する |

### Construction Phase（コンストラクション）

Units → Domain Design → Logical Design → Code → Deployment Unit → Tests

| スキル                | 内容                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `/domain <unit-file>` | 指定UnitのDomain Model（コンポーネント・関係）を設計する                                  |
| `/bolt <unit>`        | Boltを開始し、Logical Design・コード生成・Deployment Unit・テスト・PRを一気通貫で実行する |

### Operations Phase（オペレーション）

Deployment Unit のデプロイ・監視・インシデント対応・次Boltへのフィードバック

AIの役割（技術スタック非依存）：

- **テレメトリ分析:** メトリクス・ログ・トレースを分析し、パターン検出・異常検知・SLA違反の予兆を検出する
- **インシデントRunbook統合:** 検知したパターンと事前定義のRunbookを照合し、対応策を提案する
- **フィードバックループ:** Operations Phaseで検知した問題を次のBoltのNFRやMeasurement Criteriaに反映する

※監視ツール固有の設定は技術スタック確定後に追記する。

---

## リチュアル（Mob実践）

### Mob Elaboration（Inception Phaseリチュアル）

`/intent` を実行する際に推奨するチーム実践。

- Product Owner・開発者・QA 等の関係者が全員参加してAIと対話する
- AIの質問（主なユーザーは誰か？ MVP の境界は？）に全員で回答する
- User StoriesのUnder/Over-engineering をチームで議論・修正する
- Unit境界（どこで分割するか）をチームで合意する
- 数時間で数週間分の要件整理を完了させることが目標

### Mob Construction（Construction Phaseリチュアル）

複数UnitをチームでBolt並列実行する際に推奨する実践。

- 各チームが `/domain` を完了した後、全員で統合仕様（ドメインイベント・API境界）を共有する
- Unit間の依存関係を合意してから、各チームが独立して `/bolt` を実行する
- 統合ポイントでのインタフェース仕様はDomain Modelで明文化する

---

## 推奨フロー

### Green-field（新規開発）

```
/intent "ビジネス目標の説明"
    ↓ User Stories・NFR・Measurement Criteria・Unitsが生成される（承認・修正）
/domain aidlc-docs/story-artifacts/<unit>.md
    ↓ Domain Model生成（承認・修正）
    ↓ ※複数Unit並列開発の場合 → Mob Constructionで統合仕様を合意
/bolt <unit名>
    ↓ Logical Design → コード生成 → Deployment Unit → テスト → PR
```

### Brown-field（既存システムへの追加・変更）

```
/intent "追加・変更するビジネス目標の説明"
    ↓ User Stories・Units を生成（既存Unitへの追加 or 新Unit追加を判断）
/domain aidlc-docs/story-artifacts/<unit>.md
    ↓ 既存Domain Modelとの差分を分析し、変更・追加コンポーネントを特定する
    ↓ 既存Unitの集約境界を侵さないよう整合性を検証する
/bolt <unit名>
    ↓ 既存コードへの影響範囲を確認してから実装・テスト・PR
```

---

## 開発ルール

- **言語:** 回答・ドキュメント・コメントは日本語。コードは英語。
- **コミット:** Conventional Commits形式（`feat:`, `fix:`, `docs:` 等）
- **PR:** 必ず関連Issueを紐付ける（`Closes #NNN`）
- **意思決定:** 重要な技術判断はADRとして `aidlc-docs/design-artifacts/adr-NNN-*.md` に記録する

---

## 技術スタック

※未定。決定後にここを更新すること。

```
フロントエンド: TBD
バックエンド:   TBD
データベース:   TBD
インフラ:       TBD
テスト:         TBD
```
