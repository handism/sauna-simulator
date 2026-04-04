# template

個人的プロジェクトテンプレート

---

## 開発方法 — AI-Driven Development Lifecycle (AI-DLC)

このプロジェクトはAWSが提唱する **AI-DLC** に従って開発する。
AIが開発プロセスを主導し、人間は承認・意思決定・監視に集中する。

### AI-DLC の3フェーズ

```
Inception（要件定義）→ Construction（設計・実装）→ Operations（運用）
```

---

### フェーズ 1: Inception — Intent を定義する

**何をするか:** ビジネスゴール（Intent）を User Stories・NFR・Measurement Criteria・Units に分解する。
チームで実施する場合は **Mob Elaboration**（全員参加でAIと対話するリチュアル）を推奨。

**Claude Code で実行:**

```
/intent "実装したいビジネスゴールを自然言語で説明"
```

**例:**

```
/intent "投稿・フォロー・タイムライン機能を持つゆるいSNSを作る"
```

**生成される成果物（`aidlc-docs/` 以下に保存）:**

| ファイル                               | 内容                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `plans/intent_plan.md`                 | 実行プラン（チェックボックス付き）                                                |
| `requirements/intent.md`               | 明確化されたIntent                                                                |
| `requirements/prfaq.md`                | PRFAQ（オプション：複雑なIntentの場合にWorking Backwards形式で作成）              |
| `requirements/nfr.md`                  | 非機能要件                                                                        |
| `requirements/risks.md`                | リスク記述                                                                        |
| `requirements/measurement_criteria.md` | Measurement Criteria（ビジネス目標の測定指標、IntentとのトレーサビリティつきKPI） |
| `story-artifacts/user_stories.md`      | User Stories + Acceptance Criteria                                                |
| `story-artifacts/<unit-name>.md`       | Unit定義（機能ブロック単位）                                                      |

**人間がやること:**

- AIの質問に答えて Intent を明確化する
- User Stories の過不足を修正する
- Unit の境界（どこで分割するか）を承認する
- Measurement Criteria の指標・目標値を確認する
- Bolt 計画（実装順序）を確認する

---

### フェーズ 2: Construction — Unit を実装する

Construction は **2ステップ** に分かれる。
複数Unitを並列開発する場合は、各チームが `/domain` 完了後に **Mob Construction**（統合仕様の共有・Unit間依存合意のリチュアル）を実施してから `/bolt` を実行する。

#### ステップ 2a: Domain Model 設計

**何をするか:** UnitのビジネスロジックをDDD原則でモデル化する（コードは書かない）。

```
/domain aidlc-docs/story-artifacts/<unit-name>.md
```

**例:**

```
/domain aidlc-docs/story-artifacts/post-unit.md
```

**生成される成果物:**

| ファイル                                  | 内容                                             |
| ----------------------------------------- | ------------------------------------------------ |
| `plans/domain_model_plan.md`              | 実行プラン                                       |
| `design-artifacts/<unit>_domain_model.md` | コンポーネント・属性・振る舞い・ドメインイベント |

**人間がやること:**

- ビジネスロジックの漏れ・誤りを修正する
- 集約境界が適切かレビューする

#### ステップ 2b: Bolt（実装イテレーション）

**何をするか:** Domain Model を元に、Logical Design → コード → Deployment Unit → テスト → PR を一気通貫で実行する。

```
/bolt <unit名>
```

**例:**

```
/bolt post-unit
```

**生成される成果物:**

| ファイル                                    | 内容                                                            |
| ------------------------------------------- | --------------------------------------------------------------- |
| `plans/bolt_<unit>_plan.md`                 | 実行プラン                                                      |
| `design-artifacts/<unit>_logical_design.md` | 設計パターン・技術選定・マッピング・テスト実行コマンド          |
| `design-artifacts/adr-NNN-*.md`             | 重要な技術決定の記録（ADR）                                     |
| `design-artifacts/<unit>_deployment.md`     | Deployment Unit一覧（Dockerfile・Helm Chart・Terraform等）      |
| 実装コード                                  | 適切なディレクトリに配置                                        |
| テストコード                                | ユニット・統合・受け入れ・セキュリティ（SAST/DAST）・負荷テスト |
| GitHub Issue + PR                           | 自動作成                                                        |

**人間がやること:**

- Logical Design（設計パターン・技術選定）を承認する
- 重要な技術判断（ADR）を確認する
- 生成コードをレビューする
- テストシナリオ（セキュリティ・負荷テスト含む）の漏れを確認する
- Deployment Unit の設定をレビューする

---

### フェーズ 3: Operations — 運用・監視

**何をするか:** Deployment Unit をデプロイし、AIがテレメトリを分析して運用を支援する。

AIの役割：

- メトリクス・ログ・トレースを分析し、パターン検出・異常検知・SLA違反の予兆を検出する
- インシデントRunbookと照合し、対応策（スケーリング・チューニング等）を提案する
- 検知した問題を次のBoltのNFRやMeasurement Criteriaにフィードバックする

**人間がやること:**

- AIの提案する対応策を承認・却下する
- SLA・コンプライアンスへの準拠を確認する
- Operations Phaseで得た知見を次のBolt計画に反映する

---

### 推奨フロー（全体像）

#### Green-field（新規開発）

```
1. /intent "..."
        ↓ User Stories・NFR・Measurement Criteria・Units が確定したら
2. /domain aidlc-docs/story-artifacts/<unit>.md
        ↓ Domain Model が承認されたら
        ↓ ※複数Unit並列の場合 → Mob Constructionで統合仕様・依存関係を合意
3. /bolt <unit名>
        ↓ PR が作成されたらレビュー・マージ後、次のUnitへ
   /domain / /bolt を繰り返す
```

#### Brown-field（既存システムへの追加・変更）

```
1. /intent "追加・変更内容の説明"
        ↓ 既存Unit追加 or 新Unit作成かを判断
2. /domain aidlc-docs/story-artifacts/<unit>.md
        ↓ 既存Domain Modelとの差分・整合性を検証
3. /bolt <unit名>
        ↓ 既存コードへの影響範囲を確認してから実装
```

---

### ディレクトリ構造

```
yuru-sns/
├── aidlc-docs/              # AI-DLC 成果物（すべてここに保存）
│   ├── plans/               # 実行プラン（チェックボックス付き .md）
│   ├── requirements/        # Intent・PRFAQ・NFR・リスク・Measurement Criteria
│   ├── story-artifacts/     # User Stories・Units
│   ├── design-artifacts/    # Domain Model・Logical Design・ADR・Deployment Unit
│   └── prompts.md           # セッションで使ったプロンプト記録
├── .claude/
│   ├── CLAUDE.md            # Claude Code へのプロジェクト指示
│   └── skills/              # カスタムスキル定義
│       ├── intent/          # /intent スキル
│       ├── domain/          # /domain スキル
│       └── bolt/            # /bolt スキル
└── ...                      # 実装コード（技術スタック確定後）
```

---

### AI-DLC 用語集

| 用語                     | 意味                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| **Intent**               | 達成すべき高レベルのビジネスゴール                                                         |
| **PRFAQ**                | Working Backwards形式でIntentを具体化する文書（Press Release + FAQ）。複雑なIntentで推奨   |
| **Measurement Criteria** | ビジネスIntentの達成を測定する指標セット（NFRとは別）。IntentとのKPIトレーサビリティを担保 |
| **Unit**                 | Intent を分解した自己完結した機能ブロック（DDD の Subdomain に相当）                       |
| **Bolt**                 | Unit を実装する最小イテレーション（Sprint より短く、時間〜日単位）                         |
| **Domain Model**         | Unit のビジネスロジックをインフラ非依存でモデル化したもの                                  |
| **Logical Design**       | Domain Model に NFR・設計パターンを適用した論理設計                                        |
| **Deployment Unit**      | テスト済みの実行可能な成果物（コンテナ・Lambda等）とIaC設定（Helm・Terraform等）           |
| **ADR**                  | アーキテクチャ決定レコード。重要な技術判断の背景・理由を記録                               |
| **Mob Elaboration**      | Inception Phaseの協働リチュアル。全員参加でAIと対話しUser Stories・Unitsを合意             |
| **Mob Construction**     | Construction Phaseの協働リチュアル。複数Unit並列開発時に統合仕様・依存関係を合意           |

---

### 重要なルール

1. **プランを必ず承認してから実行する** — AIは作業前に `aidlc-docs/plans/` にプランを作成し、承認を求める。承認前に実装は始まらない。
2. **AIが会話を主導する** — AIが次のステップを提案し、人間は承認・修正・意思決定を担う。
3. **独断しない** — AIは重要な判断を自分で決めず、必ずユーザーに確認を求める。
4. **成果物はすべて `aidlc-docs/` に保存** — トレーサビリティのために全成果物を保持する。
