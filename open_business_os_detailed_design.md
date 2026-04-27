# Open Business OS 詳細設計書 v0.1

作成日: 2026-04-27  
対象: スマホ一台で事業構想から施策・実装・レビューまで進められる、低コストLLM対応のOSS事業OS

---

## 0. この設計書の前提

Open Business OSは、事業アイデアをAIとの段階的な対話によって、事業コンセプト、理想状態、指標、未検証仮説、施策、実装タスク、レビュー結果へ変換するOSSである。

この設計では、最初のプロダクト体験を「スマホ完結」に寄せる。PCで使っても快適だが、PC前提の管理画面や巨大フォームにはしない。ユーザーはスマホで一文入力から始め、AIの質問に段階的に答え、生成されたカードを承認・修正しながら、最終的に検証計画や実装Issueまで作れる。

LLMは、初期段階では低コストを最優先する。DeepSeek公式APIを第一対応にし、標準は `deepseek-v4-flash`、重要なレビューや高難度設計のみ `deepseek-v4-pro` を承認制で使う。将来的にはOpenRouter、LiteLLM、OpenAI互換API、ローカルLLMへ拡張する。ただし、アプリ本体は特定プロバイダを直接知らない。必ずLLM Gatewayを経由する。

---

## 1. 主要な懸念点と改善案

### 1.1 スコープ爆発

最も大きい懸念は、事業OS、AIエージェント、タスク管理、CRM、ドキュメント管理、開発支援、営業支援を全部作りたくなること。これをやるとMVPが完成しない。

対策として、最初のMVPは「一文入力から、事業マップ、主要仮説、2週間施策、実装タスクドラフトまで作る」に限定する。GitHub IssueやPlane連携は後段でもよい。CRM、BI、完全自律開発、デプロイ自動化はMVP外に置く。

### 1.2 スマホで入力が重くなる

事業OSは入力項目が多くなりがちだが、スマホで長いフォームを埋める体験は破綻しやすい。

対策として、入力は「1画面1テーマ」「1回の質問は1〜3個」「回答後にカード化」「カード単位で承認・修正・深掘り」という段階式にする。長文入力は任意で、標準は短文・音声入力・選択肢・テンプレート補完を組み合わせる。

### 1.3 AI出力の信頼性

AIはもっともらしい計画を作れるが、事実、仮説、推測、ユーザーの決定が混ざると危険である。

対策として、すべてのAI出力を構造化し、`fact`、`assumption`、`recommendation`、`decision_required` を分離する。施策や実装タスクは必ず、どの仮説・指標・意思決定に紐づくかを持たせる。AIの結論には `evidence_level` を持たせ、未検証なら未検証と明示する。

### 1.4 AIコストの予測不能性

AIプロダクトの失敗要因として、使われるほど赤字になる構造がある。OSSの場合、利用者もAPI課金に不安を持つ。

対策として、初期からコストメーター、月次上限、タスク別上限、モデル別使用量、キャッシュヒット率、承認制高額実行を入れる。AI機能は「節約」「標準」「高品質レビュー」のモードに分ける。初回設定で月間上限を必須にする。

### 1.5 特定LLMプロバイダへのロックイン

DeepSeekが安いとしても、価格・品質・利用規約・地域制約・障害は変わる。

対策として、LLM GatewayとProvider Adapterを最初から分ける。DeepSeek Direct、OpenRouter、LiteLLM、OpenAI Compatible、Local/Ollamaを同じ抽象インターフェースで扱う。モデル選択はUIではなく、タスクと予算モードで自動ルーティングする。

### 1.6 APIキー管理と機密データ

スマホでAPIキーを入力する場合、localStorage保存やフロントエンド露出は絶対に避ける必要がある。

対策として、APIキーはサーバー側で暗号化保存する。フロントエンドには一度も返さない。セルフホストでは `.env` またはサーバー管理画面で登録する。Hosted/BYOKではワークスペース単位で暗号化キーを持ち、監査ログを残す。

### 1.7 外部ツール実行の危険性

AIがGitHub Issue、Slack投稿、メール送信、デプロイ、ファイル削除などを勝手に行うと、事業上・セキュリティ上の事故につながる。

対策として、外部ツール書き込みは必ず `ToolAction` として下書き保存し、ユーザー承認後に実行する。AIは「提案」まで、ユーザーが「承認」して初めて書き込みを行う。実行後は結果と差分を監査ログに保存する。

### 1.8 OSSとしての継続性

個人が全部作り込むと、OSSコミュニティが参加しづらくなる。

対策として、最初からPlaybook Registry、Provider Registry、Connector RegistryをYAML/JSONで拡張可能にする。コントリビューション対象をコードだけに限定せず、プレイブック、業界テンプレート、質問セット、評価セット、翻訳にも広げる。

### 1.9 「完全自律開発」への過剰期待

ユーザーは最終的にAIで実装まで行いたいが、最初から完全自律開発を目標にすると品質・安全性・コストが破綻しやすい。

対策として、初期は「実装タスク化」「コード生成プロンプト作成」「GitHub Issue化」までにする。次に、Claude Code、OpenCode、OpenAI Codex系、GitHub Copilot Workspace、MCP対応IDEなどの外部開発エージェントに接続する。コード変更は必ずPRとして生成し、人間レビューを必須にする。

---

## 2. プロダクト原則

### 2.1 Progressive Clarity

最初から完全な事業計画を求めない。曖昧な一文から始め、AIとの対話で徐々に解像度を上げる。

### 2.2 Evidence over Confidence

AIの自信度より、証拠を重視する。顧客インタビュー、利用ログ、PoC結果、商談メモ、技術評価、コスト測定をEvidenceとして扱う。

### 2.3 Cheap by Default

標準実行は低コストモデルを使う。高コストモデルは、重要レビュー・複雑設計・セキュリティ判断などに限定し、ユーザー承認を要求する。

### 2.4 Human-approved Execution

外部ツールへの書き込み、顧客への送信、公開、契約、デプロイは人間承認を必須にする。

### 2.5 Traceability

すべての施策と実装タスクは、上位の仮説、指標、理想状態に接続される。なぜそのタスクをやるのかが必ず辿れる状態にする。

### 2.6 Mobile-first, not mobile-only

スマホで完結できるが、PCでの詳細編集や管理も可能にする。スマホでは段階入力と承認、PCでは俯瞰と編集を強くする。

---

## 3. MVPスコープ

MVPの目的は、事業アイデアを実行可能な2週間計画と実装タスクへ変換する最小ループを完成させること。

### MVPで作るもの

- スマホPWA
- 一文入力による事業アイデア登録
- AIによる段階質問
- 事業マップ生成
- 理想状態・North Star Metric・OKRドラフト生成
- 未検証仮説の抽出
- エンジニアリング現状入力
- 2週間施策生成
- 実装WorkItem生成
- Markdownエクスポート
- DeepSeek Direct Adapter
- LLMコストメーター
- APIキー暗号化保存
- 監査ログ
- 管理者/メンバーの最小権限管理

### MVPで作らないもの

- 完全なCRM
- 完全なプロジェクト管理ツール
- 自律デプロイ
- 自動メール送信
- 決済
- 高度なBIダッシュボード
- 複雑なマルチエージェント基盤
- ネイティブスマホアプリ
- 業界別プレイブック大量実装

---

## 4. ユーザーロール

### Owner

ワークスペースの作成者。APIキー、予算、メンバー、外部連携、削除を管理できる。

### Admin

プロジェクト、メンバー、プレイブック、外部連携を管理できる。APIキーの閲覧はできない。

### Member

事業入力、カード編集、施策作成、レビュー入力、WorkItem作成ができる。

### Viewer

閲覧とコメントのみ可能。

### External Advisor

特定プロジェクトの閲覧・コメント・レビューのみ可能。機密設定やAPIキー、監査ログにはアクセス不可。

---

## 5. スマホUX詳細設計

### 5.1 初回オンボーディング

最初の画面では、説明を長くしない。

表示する文言は以下程度でよい。

「一文から始めて、AIと一緒に事業計画・施策・実装タスクまで作ります。」

初回入力は3つだけ。

1. ワークスペース名
2. 使い方: 個人 / チーム / OSSプロジェクト / 社内新規事業
3. AI API設定: DeepSeekキー登録 / あとで設定 / セルフホスト環境変数

APIキー登録が完了していなくても、サンプルモードでUIを試せるようにする。ただし実際のAI実行にはキーが必要。

### 5.2 事業アイデア入力

画面上部に入力欄を置く。

プレースホルダーは「何を作りたいですか？」。

入力例はカードとして出す。

- 建築図面から窓やドアを検出して見積作業を効率化するAI
- 飲食店向けにSNS投稿を自動生成するツール
- 社内問い合わせを自動化するAIエージェント

入力後、AIはすぐに完成計画を出さず、まず分類する。

分類結果は以下のカードで表示する。

- 事業タイプ
- 対象ユーザー候補
- 不確実性の種類
- 最初に聞くべき質問

### 5.3 段階質問UI

AIは最大3問ずつ質問する。

質問には `why` を短く添える。

例:

「最初に使う人は誰ですか？」
補足: 「対象ユーザーが曖昧だと、指標・UX・営業施策が決められないためです。」

回答方法は、短文入力、候補選択、音声入力の3種類を用意する。

### 5.4 構造化カード

AIの回答結果は、チャットログではなくカードとして保存する。

主要カードは以下。

- Concept Card
- Target User Card
- Pain Card
- Ideal State Card
- Metric Card
- Assumption Card
- Product Experience Card
- Engineering State Card
- Risk Card
- Initiative Card
- WorkItem Card
- Review Card

各カードには、承認、修正、深掘り、削除、関連付け、履歴の操作を用意する。

### 5.5 コストメーター

スマホ画面の下部または設定画面に、AIコストを常に確認できる導線を置く。

表示する内容は以下。

- 今回のAI実行予想コスト
- 今月の使用額
- 月間上限
- 現在のモデル
- 節約モード/標準モード/高品質レビュー
- 高コスト実行前の確認

### 5.6 レビュー画面

2週間施策が完了したら、ユーザーは結果を入力する。

AIは以下を整理する。

- 実行したこと
- 得られた証拠
- 強まった仮説
- 棄却された仮説
- 新たなリスク
- 次にやるべき施策
- 変更すべきWorkItem

---

## 6. 主要ワークフロー

### W01: Idea Intake

ユーザーが事業アイデアを一文で入力する。APIは `POST /projects` を呼び、Projectと初期Vision Draftを作成する。次に `POST /playbook-runs` で `idea_intake` プレイブックを実行する。

AI出力は以下のJSONで返す。

```json
{
  "business_type": "b2b_saas",
  "initial_concept": "...",
  "target_user_candidates": ["..."],
  "uncertainties": [
    {"type": "market", "description": "..."},
    {"type": "technical", "description": "..."}
  ],
  "next_questions": [
    {"question": "...", "reason": "...", "input_type": "short_text"}
  ]
}
```

### W02: Business Map Generation

段階質問への回答が一定量に達したら、AIがBusiness Mapを生成する。

Business Mapは、Concept、Target User、Pain、Value Proposition、Ideal State、North Star Metric、Assumptions、Risksに分かれる。

生成結果はすぐ確定させず、Draft状態で保存する。ユーザーが承認したら正式なProject Stateへ反映する。

### W03: Engineering State Intake

ユーザーまたはエンジニアが、処理精度、速度、コスト、UI/UX、セキュリティ、運用を入力する。

スマホでは各項目を短く入力できるようにする。

AIはそれを経営判断用のRiskとInitiativeに変換する。

例:

「精度が80%」ではなく、
「完全自動化として売るには危険だが、候補提示と確認UIならPoC価値がある」
という表現に変換する。

### W04: Initiative Generation

AIは主要仮説ごとに2週間施策を提案する。

施策には必ず以下を持たせる。

- 検証する仮説
- 動かしたい指標
- 実行内容
- 成功条件
- 期限
- 必要なWorkItem
- 想定コスト
- リスク

### W05: WorkItem Drafting

施策から実装WorkItemを生成する。

WorkItemはGitHub IssueやPlaneのIssueに変換可能な粒度にする。

WorkItemには、なぜやるのかを必ず保存する。

例:

「図面アップロード画面を作る」だけではなく、
「PoCで初回価値を10分以内に見せるため、ユーザーがPDFをアップロードし、処理開始できる導線を作る」
とする。

### W06: External Tool Approval

GitHub Issue作成やSlack投稿は、ToolActionとして下書き保存する。

ユーザーはスマホで差分を見て、承認する。

承認後にConnector Workerが外部APIを呼ぶ。

### W07: Review Loop

施策実行後、ユーザーは実行結果を入力する。

AIはAssumptionの状態を `unverified`、`supported`、`rejected`、`needs_more_evidence` のいずれかに更新提案する。

更新はAIだけでは確定せず、ユーザー承認が必要。

---

## 7. システムアーキテクチャ

### 7.1 全体構成

```txt
apps/web  ───────┐
                 │ HTTPS
apps/api  ───────┼── PostgreSQL + pgvector
                 │
                 ├── Redis / BullMQ
                 │
                 ├── S3-compatible object storage
                 │
                 ├── LLM Gateway
                 │      ├── DeepSeek Direct Adapter
                 │      ├── OpenRouter Adapter
                 │      ├── LiteLLM Adapter
                 │      ├── OpenAI-compatible Adapter
                 │      └── Local/Ollama Adapter
                 │
                 ├── Playbook Engine
                 │
                 ├── Connector Service
                 │      ├── GitHub
                 │      ├── Plane
                 │      ├── OpenProject
                 │      ├── Slack
                 │      └── Webhook
                 │
                 └── Observability
                        ├── OpenTelemetry
                        ├── AI run logs
                        └── Cost ledger
```

### 7.2 推奨技術スタック

MVPではTypeScriptモノレポを推奨する。

- Package manager: pnpm
- Monorepo: Turborepo
- Frontend: Next.js PWA
- API: Fastify or Hono on Node.js
- DB: PostgreSQL
- ORM: Drizzle ORM
- Vector: pgvector
- Queue: BullMQ + Redis
- Storage: S3互換ストレージ
- Validation: Zod
- Auth: Auth.js + PostgreSQL adapter、将来的にOIDC/Keycloak対応
- UI: Tailwind CSS + headless components
- Telemetry: OpenTelemetry
- Test: Vitest, Playwright, MSW

Next.jsのRoute HandlerだけでMVPを作ることもできるが、OSSとして将来APIを独立させるなら `apps/api` を分ける方がよい。

### 7.3 リポジトリ構成

```txt
open-business-os/
  apps/
    web/
      app/
      components/
      features/
      public/
      pwa/
    api/
      src/
        routes/
        services/
        workers/
        middleware/
  packages/
    core/
      src/entities/
      src/usecases/
      src/events/
    db/
      migrations/
      schema.ts
      seed.ts
    schemas/
      src/business-map.ts
      src/playbook.ts
      src/llm.ts
    llm-gateway/
      src/providers/
      src/routing/
      src/cost/
    playbooks/
      registry/
      schemas/
    connectors/
      github/
      plane/
      openproject/
      slack/
    security/
      src/secrets.ts
      src/rbac.ts
      src/audit.ts
    evals/
      scenarios/
      prompts/
      fixtures/
    config/
      provider-registry.yaml
      llm-policy.yaml
  docs/
    architecture/
    playbook-authoring/
    security/
    self-hosting/
  examples/
    b2b-ai-saas/
    ai-drawing-takeoff/
  docker-compose.yml
  README.md
```

---

## 8. データモデル詳細

### 8.1 設計方針

データモデルはフレームワーク名ではなく、事業プリミティブで作る。

中心になるのは以下。

- Project
- Vision
- Metric
- Assumption
- Evidence
- Decision
- Initiative
- WorkItem
- Review
- PlaybookRun
- AIRun
- ToolAction
- AuditLog

各オブジェクトはDraft/Approved/Archivedの状態を持てるようにする。AIが生成したものはDraftとして保存し、人間が承認して正式化する。

### 8.2 主要テーブル

#### users

ユーザー本体。

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### workspaces

チームまたは個人の作業空間。

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  owner_user_id uuid not null references users(id),
  default_budget_mode text not null default 'cheap',
  monthly_budget_usd numeric(12,4) not null default 5.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### workspace_memberships

権限管理。

```sql
create table workspace_memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer','external_advisor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
```

#### projects

事業・プロダクト単位。

```sql
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  one_liner text,
  business_type text,
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### visions

理想状態・コンセプト。

```sql
create table visions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  concept text not null,
  target_market text,
  target_users jsonb not null default '[]',
  ideal_state text,
  success_horizon text,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  source text not null default 'ai' check (source in ('user','ai','imported')),
  created_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### metrics

North Star Metric、OKR、KPI、技術指標、運用指標。

```sql
create table metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text,
  metric_type text not null check (metric_type in ('north_star','okr_objective','okr_key_result','kpi','engineering','ux','sales','marketing','operations','cost')),
  unit text,
  target_value numeric,
  current_value numeric,
  target_date date,
  parent_metric_id uuid references metrics(id),
  status text not null default 'active' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### assumptions

未検証仮説。

```sql
create table assumptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  statement text not null,
  assumption_type text not null check (assumption_type in ('customer','problem','solution','market','pricing','technical','gtm','security','operations')),
  evidence_level text not null default 'none' check (evidence_level in ('none','weak','medium','strong')),
  status text not null default 'unverified' check (status in ('unverified','supported','rejected','needs_more_evidence','archived')),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  related_metric_id uuid references metrics(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### evidence

仮説や意思決定を支える証拠。

```sql
create table evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  evidence_type text not null check (evidence_type in ('customer_interview','usage_log','sales_note','poc_result','technical_eval','cost_measurement','security_review','user_test','document','manual_note')),
  summary text,
  body text,
  source_url text,
  file_id uuid,
  strength text not null default 'weak' check (strength in ('weak','medium','strong')),
  captured_at timestamptz default now(),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
```

#### assumption_evidence

仮説と証拠の中間テーブル。

```sql
create table assumption_evidence (
  assumption_id uuid not null references assumptions(id) on delete cascade,
  evidence_id uuid not null references evidence(id) on delete cascade,
  relation text not null check (relation in ('supports','contradicts','context')),
  created_at timestamptz not null default now(),
  primary key (assumption_id, evidence_id)
);
```

#### decisions

意思決定ログ。

```sql
create table decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  decision text not null,
  rationale text,
  alternatives jsonb not null default '[]',
  decided_by uuid references users(id),
  decided_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('draft','active','superseded','archived')),
  created_at timestamptz not null default now()
);
```

#### initiatives

施策。

```sql
create table initiatives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  initiative_type text not null check (initiative_type in ('product','engineering','marketing','sales','security','operations','research','customer_success')),
  hypothesis text,
  success_criteria text,
  start_date date,
  due_date date,
  status text not null default 'draft' check (status in ('draft','planned','in_progress','done','cancelled','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  related_metric_id uuid references metrics(id),
  related_assumption_id uuid references assumptions(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### work_items

実装・作業タスク。

```sql
create table work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  initiative_id uuid references initiatives(id) on delete set null,
  title text not null,
  description text,
  acceptance_criteria jsonb not null default '[]',
  work_type text not null check (work_type in ('issue','task','bug','research','design','security','ops','sales','marketing')),
  status text not null default 'draft' check (status in ('draft','todo','in_progress','blocked','done','cancelled','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  assignee_user_id uuid references users(id),
  external_provider text,
  external_id text,
  external_url text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### reviews

振り返り。

```sql
create table reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  review_type text not null check (review_type in ('weekly','biweekly','monthly','poc','incident','initiative')),
  period_start date,
  period_end date,
  summary text,
  learnings jsonb not null default '[]',
  next_actions jsonb not null default '[]',
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
```

#### playbook_runs

プレイブック実行履歴。

```sql
create table playbook_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  playbook_id text not null,
  input jsonb not null default '{}',
  output jsonb,
  status text not null default 'pending' check (status in ('pending','running','completed','failed','cancelled')),
  created_by uuid references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
```

#### ai_runs

AI実行ログ。

```sql
create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  playbook_run_id uuid references playbook_runs(id) on delete set null,
  task text not null,
  provider text not null,
  model text not null,
  budget_mode text not null,
  prompt_hash text,
  input_tokens integer,
  output_tokens integer,
  cache_hit_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  status text not null check (status in ('success','failed','cancelled')),
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
```

#### api_keys

暗号化されたプロバイダAPIキー。

```sql
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  encrypted_key bytea not null,
  key_hint text,
  status text not null default 'active' check (status in ('active','disabled','revoked')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);
```

#### budgets

予算設定。

```sql
create table budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scope text not null check (scope in ('workspace','project','user','task','provider','model')),
  scope_id text,
  limit_usd numeric(12,4) not null,
  period text not null check (period in ('daily','weekly','monthly')),
  hard_limit boolean not null default true,
  created_at timestamptz not null default now()
);
```

#### cost_ledger

実コスト/推定コストの台帳。

```sql
create table cost_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  ai_run_id uuid references ai_runs(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_hit_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
```

#### tool_actions

外部ツール書き込みの下書き・承認・実行。

```sql
create table tool_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  tool_provider text not null,
  action_type text not null,
  payload jsonb not null,
  preview text,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','executing','completed','failed','cancelled')),
  requested_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);
```

#### audit_logs

監査ログ。

```sql
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}',
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
```

---

## 9. API設計

### 9.1 基本方針

APIはRESTを基本にする。AI実行や外部ツール実行は非同期ジョブとして扱えるようにする。

モバイル体験では、待ち時間を短く感じさせるために、AI生成はstreamまたはjob pollingを使う。

### 9.2 主要エンドポイント

#### Auth / Workspace

```txt
GET    /api/v1/me
POST   /api/v1/workspaces
GET    /api/v1/workspaces/:workspaceId
PATCH  /api/v1/workspaces/:workspaceId
GET    /api/v1/workspaces/:workspaceId/members
POST   /api/v1/workspaces/:workspaceId/members
```

#### API Keys / Budgets

```txt
POST   /api/v1/workspaces/:workspaceId/api-keys
GET    /api/v1/workspaces/:workspaceId/api-keys
DELETE /api/v1/workspaces/:workspaceId/api-keys/:keyId
POST   /api/v1/workspaces/:workspaceId/api-keys/:keyId/test
GET    /api/v1/workspaces/:workspaceId/budgets
POST   /api/v1/workspaces/:workspaceId/budgets
GET    /api/v1/workspaces/:workspaceId/costs/summary
```

#### Projects

```txt
POST   /api/v1/projects
GET    /api/v1/projects
GET    /api/v1/projects/:projectId
PATCH  /api/v1/projects/:projectId
DELETE /api/v1/projects/:projectId
```

#### Business Primitives

```txt
GET    /api/v1/projects/:projectId/visions
POST   /api/v1/projects/:projectId/visions
PATCH  /api/v1/visions/:visionId
POST   /api/v1/visions/:visionId/approve

GET    /api/v1/projects/:projectId/metrics
POST   /api/v1/projects/:projectId/metrics
PATCH  /api/v1/metrics/:metricId

GET    /api/v1/projects/:projectId/assumptions
POST   /api/v1/projects/:projectId/assumptions
PATCH  /api/v1/assumptions/:assumptionId

GET    /api/v1/projects/:projectId/evidence
POST   /api/v1/projects/:projectId/evidence

GET    /api/v1/projects/:projectId/initiatives
POST   /api/v1/projects/:projectId/initiatives
PATCH  /api/v1/initiatives/:initiativeId

GET    /api/v1/projects/:projectId/work-items
POST   /api/v1/projects/:projectId/work-items
PATCH  /api/v1/work-items/:workItemId
```

#### Playbooks / AI Runs

```txt
GET    /api/v1/playbooks
GET    /api/v1/playbooks/:playbookId
POST   /api/v1/playbook-runs
GET    /api/v1/playbook-runs/:runId
POST   /api/v1/playbook-runs/:runId/approve-output

POST   /api/v1/ai-runs
GET    /api/v1/ai-runs/:aiRunId
```

#### Tool Actions

```txt
POST   /api/v1/tool-actions
GET    /api/v1/projects/:projectId/tool-actions
POST   /api/v1/tool-actions/:actionId/approve
POST   /api/v1/tool-actions/:actionId/execute
POST   /api/v1/tool-actions/:actionId/cancel
```

#### Reviews

```txt
GET    /api/v1/projects/:projectId/reviews
POST   /api/v1/projects/:projectId/reviews
POST   /api/v1/reviews/:reviewId/apply-recommendations
```

### 9.3 エラー設計

APIエラーは以下形式に統一する。

```json
{
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "Monthly AI budget exceeded.",
    "details": {
      "limitUsd": 5,
      "currentUsd": 5.12
    }
  }
}
```

主要エラーコード:

- `UNAUTHORIZED`
- `FORBIDDEN`
- `VALIDATION_ERROR`
- `BUDGET_EXCEEDED`
- `LLM_PROVIDER_ERROR`
- `LLM_RATE_LIMITED`
- `SCHEMA_VALIDATION_FAILED`
- `TOOL_ACTION_REQUIRES_APPROVAL`
- `CONNECTOR_AUTH_FAILED`
- `CONNECTOR_EXECUTION_FAILED`

---

## 10. LLM Gateway詳細設計

### 10.1 Gatewayの責務

LLM Gatewayは、アプリ本体と各LLMプロバイダの間に入る。

責務は以下。

- タスクに応じたモデル選択
- 予算モードに応じたルーティング
- プロバイダAPIキーの取得と復号
- 入出力token推定
- コスト推定
- 月次/日次予算チェック
- キャッシュ戦略
- JSON出力の検証
- リトライ/フォールバック
- AI実行ログ保存
- エラー正規化

### 10.2 LLM Run Request

```ts
export type LlmTask =
  | "idea_intake"
  | "business_map_generation"
  | "metric_design"
  | "assumption_extraction"
  | "engineering_state_analysis"
  | "initiative_generation"
  | "implementation_breakdown"
  | "critical_strategy_review"
  | "security_review"
  | "weekly_review";

export type BudgetMode = "ultra_cheap" | "cheap" | "balanced" | "high_quality";

export type LlmCapability =
  | "json_output"
  | "tool_calling"
  | "reasoning"
  | "vision"
  | "long_context";

export interface LlmRunRequest {
  workspaceId: string;
  projectId?: string;
  userId: string;
  task: LlmTask;
  budgetMode: BudgetMode;
  requiredCapabilities?: LlmCapability[];
  system: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  responseFormat: "text" | "json";
  outputSchemaName?: string;
  maxOutputTokens?: number;
  requireApprovalForHighCost?: boolean;
}
```

### 10.3 LLM Run Response

```ts
export interface LlmRunResponse<T = unknown> {
  aiRunId: string;
  provider: string;
  model: string;
  content: string;
  structured?: T;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens?: number;
    estimatedCostUsd: number;
    latencyMs: number;
  };
  warnings: string[];
}
```

### 10.4 Provider Adapter Interface

```ts
export interface LlmProviderAdapter {
  id: string;
  supports(capabilities: LlmCapability[]): boolean;
  listModels(): Promise<LlmModelInfo[]>;
  chat(request: ProviderChatRequest): Promise<ProviderChatResponse>;
  estimateCost(input: CostEstimateInput): Promise<CostEstimateResult>;
  testConnection(apiKey: string): Promise<{ ok: boolean; error?: string }>;
}
```

### 10.5 Provider Registry YAML

```yaml
providers:
  - id: deepseek_direct
    name: DeepSeek Direct
    type: openai_compatible
    base_url: https://api.deepseek.com
    auth: bearer
    models:
      - id: deepseek-v4-flash
        label: DeepSeek V4 Flash
        capabilities: [json_output, tool_calling, reasoning, long_context]
        cost_profile: ultra_cheap
        default_for:
          - idea_intake
          - business_map_generation
          - metric_design
          - assumption_extraction
          - engineering_state_analysis
          - initiative_generation
          - implementation_breakdown
          - weekly_review
      - id: deepseek-v4-pro
        label: DeepSeek V4 Pro
        capabilities: [json_output, tool_calling, reasoning, long_context]
        cost_profile: premium
        requires_confirmation: true
        default_for:
          - critical_strategy_review
          - security_review

  - id: openrouter
    name: OpenRouter
    type: openai_compatible
    base_url: https://openrouter.ai/api/v1
    auth: bearer
    dynamic_models: true

  - id: litellm_proxy
    name: LiteLLM Proxy
    type: openai_compatible
    base_url_env: LITELLM_PROXY_BASE_URL
    auth: bearer
    dynamic_models: true
```

### 10.6 LLM Policy YAML

```yaml
default_budget_mode: cheap

approval:
  require_for_cost_over_usd: 0.05
  require_for_budget_mode: high_quality
  require_for_tasks:
    - security_review
    - critical_strategy_review

routing:
  idea_intake:
    budget_modes:
      ultra_cheap:
        - provider: deepseek_direct
          model: deepseek-v4-flash
      cheap:
        - provider: deepseek_direct
          model: deepseek-v4-flash
      balanced:
        - provider: deepseek_direct
          model: deepseek-v4-flash
      high_quality:
        - provider: deepseek_direct
          model: deepseek-v4-pro

  critical_strategy_review:
    budget_modes:
      cheap:
        - provider: deepseek_direct
          model: deepseek-v4-flash
      balanced:
        - provider: deepseek_direct
          model: deepseek-v4-pro
      high_quality:
        - provider: openrouter
          model: configurable_high_quality

limits:
  max_output_tokens:
    idea_intake: 1200
    business_map_generation: 2000
    implementation_breakdown: 2500
    critical_strategy_review: 4000

fallback:
  enabled: true
  max_attempts: 2
  on:
    - rate_limit
    - provider_down
    - timeout
```

### 10.7 コスト削減戦略

コスト削減は実装の中心に置く。

1. 事業状態は毎回全文投入せず、Project Memory Summaryとして圧縮する。
2. 共通システムプロンプト、プレイブック定義、出力schemaは順序を固定し、プロンプトキャッシュが効きやすくする。
3. AI実行前に推定tokenと推定コストを計算する。
4. 重要レビュー以外は低コストモデルを使う。
5. JSON出力に失敗した場合、全文再生成ではなくrepair promptを使う。
6. ユーザーが同じカードを再生成する場合、差分だけをモデルに渡す。
7. 大量のEvidenceは検索・要約してから渡す。

### 10.8 DeepSeek Direct Adapter

DeepSeek AdapterはOpenAI互換形式で実装する。

環境変数:

```txt
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

重要な実装要件:

- `deepseek-v4-flash` を標準にする。
- `deepseek-v4-pro` は承認制にする。
- `deepseek-chat` と `deepseek-reasoner` は将来廃止予定のため、初期実装では使わない。
- thinking設定はタスクごとに制御する。
- usage情報からCost Ledgerを記録する。

### 10.9 OpenRouter Adapter

OpenRouterは将来のマルチモデル対応・フォールバック・モデル比較に使う。

重要な実装要件:

- モデル一覧APIから価格、context length、対応パラメータを同期する。
- 低価格モデル候補を自動抽出する。
- fallback model chainを設定可能にする。
- Providerごとのデータ保持ポリシーやログ設定をユーザーが選べるようにする。

### 10.10 LiteLLM Adapter

LiteLLMは企業・セルフホスト向けのLLM Gatewayとして対応する。

重要な実装要件:

- OpenAI互換base URLとして扱う。
- LiteLLM Proxy側のvirtual keyを使う。
- spend trackingやbudget機能がある場合は、Open Business OS側のCost Ledgerと突合する。

---

## 11. Playbook Engine詳細設計

### 11.1 Playbookの役割

Playbookは、AIとの対話を構造化するための定義ファイルである。

1つのPlaybookは、目的、入力、質問、出力schema、使用LLMタスク、承認要否を持つ。

### 11.2 Playbook YAML例

```yaml
id: b2b_ai_saas_mvp_planning
name: B2B AI SaaS MVP Planning
version: 0.1.0
stage: mvp_planning
llm_task: initiative_generation
budget_mode: cheap

inputs:
  required:
    - project.one_liner
    - vision.concept
    - assumptions
  optional:
    - metrics
    - engineering_state

questions:
  - id: target_customer
    text: 最初に使う顧客は誰ですか？
    reason: 対象顧客が曖昧だと、PoC条件と営業導線が決まらないためです。
    input_type: short_text
  - id: success_condition
    text: 2週間後に何が分かれば前進と判断しますか？
    reason: 施策を作業ではなく検証にするためです。
    input_type: short_text

outputs:
  schema: InitiativeGenerationOutput

approval:
  required: true
  reason: 生成された施策は実行計画に反映されるため
```

### 11.3 Playbook Runのライフサイクル

1. `pending`
2. `running`
3. `completed`
4. `user_reviewing`
5. `approved`
6. `applied`

AI出力が完了しても、すぐにProject Stateへ反映しない。ユーザー承認後に反映する。

---

## 12. AI出力Schema

### 12.1 BusinessMapOutput

```ts
import { z } from "zod";

export const BusinessMapOutputSchema = z.object({
  concept: z.object({
    title: z.string(),
    oneLiner: z.string(),
    description: z.string(),
    businessType: z.string()
  }),
  targetUsers: z.array(z.object({
    name: z.string(),
    description: z.string(),
    painPoints: z.array(z.string()),
    currentAlternatives: z.array(z.string())
  })),
  idealState: z.object({
    description: z.string(),
    horizon: z.string(),
    observableOutcomes: z.array(z.string())
  }),
  northStarMetric: z.object({
    name: z.string(),
    definition: z.string(),
    whyItMatters: z.string(),
    caveats: z.array(z.string())
  }),
  assumptions: z.array(z.object({
    statement: z.string(),
    type: z.enum(["customer","problem","solution","market","pricing","technical","gtm","security","operations"]),
    riskLevel: z.enum(["low","medium","high","critical"]),
    evidenceLevel: z.enum(["none","weak","medium","strong"]),
    validationMethod: z.string()
  })),
  risks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    severity: z.enum(["low","medium","high","critical"]),
    mitigation: z.string()
  })),
  nextQuestions: z.array(z.object({
    question: z.string(),
    reason: z.string(),
    inputType: z.enum(["short_text","long_text","single_select","multi_select"])
  }))
});
```

### 12.2 InitiativeGenerationOutput

```ts
export const InitiativeGenerationOutputSchema = z.object({
  initiatives: z.array(z.object({
    title: z.string(),
    description: z.string(),
    initiativeType: z.enum(["product","engineering","marketing","sales","security","operations","research","customer_success"]),
    relatedAssumption: z.string(),
    relatedMetric: z.string().optional(),
    hypothesis: z.string(),
    successCriteria: z.string(),
    timeboxDays: z.number().int().min(1).max(30),
    priority: z.enum(["low","medium","high","critical"]),
    workItems: z.array(z.object({
      title: z.string(),
      description: z.string(),
      workType: z.enum(["issue","task","bug","research","design","security","ops","sales","marketing"]),
      acceptanceCriteria: z.array(z.string()),
      priority: z.enum(["low","medium","high","critical"])
    }))
  }))
});
```

### 12.3 EngineeringStateAnalysisOutput

```ts
export const EngineeringStateAnalysisOutputSchema = z.object({
  summary: z.string(),
  currentCapabilities: z.array(z.string()),
  limitations: z.array(z.object({
    area: z.enum(["accuracy","speed","cost","ui_ux","security","operations"]),
    description: z.string(),
    businessImpact: z.string(),
    severity: z.enum(["low","medium","high","critical"])
  })),
  recommendedPositioning: z.object({
    shouldPromise: z.array(z.string()),
    shouldNotPromise: z.array(z.string()),
    suggestedWording: z.string()
  }),
  nextEngineeringPriorities: z.array(z.object({
    title: z.string(),
    rationale: z.string(),
    expectedImpact: z.string(),
    effort: z.enum(["low","medium","high"])
  }))
});
```

---

## 13. セキュリティ設計

### 13.1 セキュリティ基準

WebアプリケーションとしてはOWASP ASVSを参照する。LLMアプリとしてはOWASP Top 10 for LLM Applicationsを参照する。MVPではASVSの全項目準拠を目指すのではなく、認証、セッション、アクセス制御、入力検証、機密情報管理、ログ、APIキー保護を優先する。

### 13.2 APIキー保護

APIキーはフロントエンドに返さない。サーバー側で暗号化保存する。

推奨方式:

- Master Keyは環境変数またはKMSで保持
- WorkspaceごとにData Encryption Keyを作る
- APIキーはAES-256-GCMで暗号化
- `key_hint` には末尾4桁だけ保存
- 復号はLLM Gateway実行時のみ
- 復号結果はメモリ上でのみ扱い、ログに出さない

### 13.3 RBAC

権限チェックはすべてAPI側で行う。

Ownerのみ可能:

- ワークスペース削除
- APIキー登録/削除
- 月次予算変更
- メンバー権限変更

Admin以上:

- 外部連携設定
- プレイブック設定
- プロジェクト削除

Member以上:

- 事業カード作成/編集
- AI実行
- WorkItem作成
- Review作成

Viewer:

- 閲覧のみ

### 13.4 LLM固有リスク

LLMでは以下を必ず対策する。

- Prompt Injection
- Insecure Output Handling
- Model Denial of Service
- Supply Chain Vulnerabilities
- Sensitive Information Disclosure
- Excessive Agency

対策:

1. 外部データとシステム指示を分離する。
2. AI出力をそのまま実行しない。
3. Structured OutputをZodで検証する。
4. ToolActionは承認制にする。
5. 高コスト実行は予算チェックする。
6. 機密情報はプロンプト投入前にマスキングできるようにする。
7. AI実行ログは必要最小限にし、APIキーや個人情報を保存しない。

### 13.5 外部ツール実行安全性

GitHub Issue作成などはToolActionとして保存する。

ToolAction実行前に以下を表示する。

- 実行先
- 実行内容
- 作成/変更されるリソース
- AI生成理由
- 関連するInitiative/Assumption
- キャンセルボタン
- 承認ボタン

危険度の高いActionはMVPでは実装しない。

MVPで許可:

- GitHub Issue作成ドラフト
- Markdownエクスポート
- Webhook送信ドラフト

MVPで禁止:

- メール自動送信
- 本番デプロイ
- Git push
- ファイル削除
- 顧客データの外部送信

---

## 14. Connector設計

### 14.1 Connector Interface

```ts
export interface ConnectorAdapter {
  id: string;
  name: string;
  testConnection(config: unknown): Promise<{ ok: boolean; error?: string }>;
  preview(action: ToolActionPayload): Promise<ToolActionPreview>;
  execute(action: ToolActionPayload): Promise<ToolActionResult>;
}
```

### 14.2 GitHub Connector MVP

MVPではGitHub Issue作成のみ。

必要な設定:

- GitHub tokenまたはGitHub App installation
- owner
- repo
- default labels

Issue payload:

```json
{
  "title": "図面アップロード画面を作る",
  "body": "## Why\nPoCで初回価値を10分以内に見せるため...\n\n## Acceptance Criteria\n- PDFをアップロードできる\n- 処理開始ボタンがある\n- 失敗時エラーが表示される",
  "labels": ["open-business-os", "mvp", "engineering"]
}
```

### 14.3 Markdown Export

MVPでは外部連携なしでも価値が出るように、Markdownエクスポートを優先する。

出力対象:

- Business Map
- 2週間施策
- WorkItem一覧
- Review Summary
- Decision Log

---

## 15. Project Memory設計

### 15.1 目的

LLMに毎回すべての履歴を渡すと高コストになる。Project Memoryは、事業状態を圧縮し、LLMに渡す最小コンテキストを作るための仕組みである。

### 15.2 Memory構成

- Core Summary: 事業コンセプト、対象ユーザー、理想状態
- Metrics Summary: North Star Metric、主要KPI
- Assumption Summary: 重要仮説と状態
- Evidence Summary: 主要証拠
- Decision Summary: 重要意思決定
- Recent Activity: 直近の施策とレビュー

### 15.3 更新タイミング

以下のタイミングでMemoryを再生成する。

- Vision承認時
- Assumption更新時
- Initiative完了時
- Review完了時
- Decision追加時

Memory自体もバージョン管理する。

---

## 16. フロントエンド詳細設計

### 16.1 画面一覧

- `/` ランディング
- `/setup` 初回設定
- `/w/:workspaceSlug` ワークスペースホーム
- `/w/:workspaceSlug/projects` プロジェクト一覧
- `/w/:workspaceSlug/projects/new` 一文入力
- `/w/:workspaceSlug/projects/:projectId` プロジェクトホーム
- `/w/:workspaceSlug/projects/:projectId/intake` 段階質問
- `/w/:workspaceSlug/projects/:projectId/map` 事業マップ
- `/w/:workspaceSlug/projects/:projectId/initiatives` 施策
- `/w/:workspaceSlug/projects/:projectId/work-items` WorkItem
- `/w/:workspaceSlug/projects/:projectId/reviews` Review
- `/w/:workspaceSlug/settings/ai` AI API・予算設定
- `/w/:workspaceSlug/settings/connectors` 外部連携

### 16.2 モバイルUIコンポーネント

- BottomNav
- StepQuestionCard
- BusinessPrimitiveCard
- CostMeter
- ApprovalSheet
- ToolActionPreview
- EvidenceBadge
- AssumptionStatusBadge
- WorkItemCard
- ReviewTimeline

### 16.3 オフライン/下書き

スマホでは接続が不安定な可能性がある。

- 入力途中の回答はIndexedDBに一時保存する。
- APIキーはIndexedDBに保存しない。
- 再接続時にDraftを同期する。
- 同期競合が発生したら、サーバー版とローカル版を表示して選べるようにする。

---

## 17. バックエンド詳細設計

### 17.1 Service構成

- AuthService
- WorkspaceService
- ProjectService
- BusinessPrimitiveService
- PlaybookService
- LlmGatewayService
- CostService
- SecretService
- ConnectorService
- ToolActionService
- ReviewService
- AuditService

### 17.2 非同期ジョブ

BullMQで以下のジョブを扱う。

- `playbook.run`
- `llm.run`
- `tool_action.execute`
- `memory.refresh`
- `cost.reconcile`
- `connector.sync`

AI生成は時間がかかるため、APIはジョブIDを返し、フロントエンドはpollingまたはSSEで進捗を受け取る。

### 17.3 将来のTemporal対応

長時間ワークフロー、複数外部API、承認待ち、リトライ、補償処理が増えたらTemporalを導入する。MVPではBullMQで十分。ただし、Activityは最初から冪等に設計する。

---

## 18. Observability設計

### 18.1 監視対象

- API latency
- AI latency
- Provider error rate
- Token usage
- Estimated cost
- Budget exceeded count
- Prompt schema validation failure
- ToolAction approval/execution count
- Connector error rate
- DB query latency
- Queue backlog

### 18.2 OpenTelemetry属性

AI実行のspanには以下を入れる。

```txt
llm.provider
llm.model
llm.task
llm.budget_mode
llm.input_tokens
llm.output_tokens
llm.estimated_cost_usd
llm.cache_hit_tokens
project.id
workspace.id
```

ただし、プロンプト本文やAPIキーはtraceに入れない。

---

## 19. テスト戦略

### 19.1 Unit Test

- データモデル変換
- Zod schema validation
- LLM cost estimation
- RBAC
- Secret encryption/decryption
- Playbook parser

### 19.2 Integration Test

- DeepSeek Adapter mock
- OpenRouter Adapter mock
- GitHub Connector mock
- Budget enforcement
- ToolAction approval flow

### 19.3 E2E Test

Playwrightで以下をテストする。

1. ユーザー登録
2. ワークスペース作成
3. DeepSeek APIキー登録のmock
4. 事業アイデア入力
5. AI質問生成
6. Business Map作成
7. Initiative作成
8. WorkItem作成
9. Markdownエクスポート

### 19.4 AI Evals

AI出力は通常のunit testだけでは足りない。

評価観点:

- JSON schemaに従うか
- 事実と仮説を分離できるか
- 施策が検証可能か
- WorkItemが実装可能な粒度か
- 重要なリスクを見落としていないか
- 高コストモデルを不必要に使っていないか

テストケースは `packages/evals/scenarios` に保存する。

---

## 20. ライセンスとOSS運営

### 20.1 ライセンス候補

普及重視ならApache-2.0。SaaSとして丸ごとクローンされることを抑えたいならAGPL-3.0。事業化とOSS保護を両立するならAGPL-3.0 + commercial license。

このプロダクトはSaaS化されやすい業務アプリなので、初期はAGPL-3.0 + 商用ライセンスが現実的。ただし、企業導入を最大化したい場合はApache-2.0にする。

### 20.2 コントリビューション対象

- コード
- Provider Adapter
- Connector
- Playbook
- 業界テンプレート
- AI Evalシナリオ
- 翻訳
- ドキュメント
- セキュリティチェックリスト

### 20.3 Governance

- Maintainers
- Code of Conduct
- Contribution Guide
- Security Policy
- Release Policy
- Playbook Review Policy

---

## 21. 実装ロードマップ

### Phase 0: 設計固定

成果物:

- DB schema v0.1
- API spec v0.1
- LLM Gateway interface
- Playbook schema
- UI wireframe
- Security policy

Definition of Done:

- 主要Entityが定義済み
- MVPスコープが固定済み
- 非目標が明文化済み

### Phase 1: Core + Auth + Workspace

実装:

- モノレポ作成
- DB migration
- Auth
- Workspace
- RBAC
- AuditLog
- PWA shell

Definition of Done:

- スマホでログインできる
- ワークスペースを作れる
- 権限チェックが動く

### Phase 2: LLM Gateway + DeepSeek

実装:

- LLM Gateway
- DeepSeek Adapter
- APIキー暗号化保存
- コスト推定
- Cost Ledger
- Budget enforcement
- AI Run log

Definition of Done:

- `deepseek-v4-flash` でAI実行できる
- 実行ログと推定コストが保存される
- 月次予算を超えると止まる

### Phase 3: Idea Intake + Business Map

実装:

- Project作成
- Idea Intake Playbook
- 段階質問UI
- BusinessMap生成
- Card承認UI

Definition of Done:

- 一文入力から事業マップを生成できる
- 生成結果をカードとして承認/修正できる

### Phase 4: Assumption + Initiative + WorkItem

実装:

- Assumption CRUD
- Metric CRUD
- Initiative generation
- WorkItem generation
- Markdown export

Definition of Done:

- 2週間施策と実装タスクを生成できる
- Markdownでエクスポートできる

### Phase 5: Review Loop

実装:

- Review作成
- Evidence登録
- Assumption status更新提案
- Project Memory更新

Definition of Done:

- 実行結果から次の施策を提案できる
- 仮説の状態更新を承認制で反映できる

### Phase 6: Connectors

実装:

- ToolAction
- GitHub Connector
- 承認フロー
- Connector監査ログ

Definition of Done:

- WorkItemをGitHub Issue化できる
- 実行前にスマホで承認できる

### Phase 7: Provider Expansion

実装:

- OpenRouter Adapter
- LiteLLM Adapter
- Provider Registry UI
- Model comparison
- Fallback routing

Definition of Done:

- OpenRouter経由でモデルを切り替えられる
- LiteLLM Proxy経由で呼べる
- Provider fallbackが動く

---

## 22. 初期README骨子

```md
# Open Business OS

Open Business OS is an open-source, mobile-first system that helps founders, operators, product teams, and engineers turn vague business ideas into structured strategy, measurable goals, validated assumptions, actionable initiatives, implementation tasks, and review loops.

It is not a project management clone.
It is not just an AI chatbot.
It is a strategy-to-execution operating system.

## Core Principles

- Progressive clarity
- Evidence over confidence
- Cheap by default
- Human-approved execution
- Traceability from vision to work item

## MVP

- Mobile PWA
- Idea intake
- AI-guided questions
- Business map
- Assumptions
- 2-week initiatives
- Work items
- Markdown export
- DeepSeek low-cost LLM support
- LLM cost meter
```

---

## 23. 最初の実装タスクリスト

### Repository

- Create pnpm workspace
- Add Turborepo
- Add apps/web
- Add apps/api
- Add packages/core
- Add packages/db
- Add packages/schemas
- Add packages/llm-gateway
- Add packages/playbooks
- Add packages/security

### Database

- Add PostgreSQL docker-compose
- Add Drizzle schema
- Add migrations
- Add seed data
- Add RBAC helpers

### Web

- Add PWA manifest
- Add mobile layout
- Add setup flow
- Add workspace home
- Add project creation
- Add card components

### API

- Add auth middleware
- Add workspace routes
- Add project routes
- Add playbook routes
- Add ai-run routes
- Add budget routes

### LLM

- Add provider registry
- Add LLM policy loader
- Add DeepSeek adapter
- Add cost estimator
- Add schema validation
- Add retry and timeout

### AI Playbooks

- Add idea_intake playbook
- Add business_map_generation playbook
- Add initiative_generation playbook
- Add implementation_breakdown playbook

### Security

- Add encrypted API key storage
- Add audit logs
- Add rate limiting
- Add secret redaction
- Add ToolAction approval model

### Export

- Add Markdown exporter
- Add Business Map template
- Add WorkItem template

---

## 24. 最終的な完成像

Open Business OSの完成像は、以下のループがスマホで回ること。

1. 一文で事業アイデアを入力する。
2. AIが段階質問で理想状態を明確にする。
3. 事業マップ、指標、仮説、リスクをカード化する。
4. エンジニアリング現状を入力し、事業リスクに翻訳する。
5. AIが2週間施策と実装タスクを作る。
6. ユーザーが承認し、MarkdownやGitHub Issueに出力する。
7. 実行後のEvidenceを入力する。
8. AIが仮説・施策・意思決定ログを更新提案する。
9. 次の2週間計画へ進む。

このループが回れば、Open Business OSは単なるAI事業計画ツールではなく、経営、プロダクト、エンジニアリング、マーケティング、営業を接続する実行OSになる。

---

## 25. 参考資料

- DeepSeek API Docs: https://api-docs.deepseek.com/
- DeepSeek Models & Pricing: https://api-docs.deepseek.com/quick_start/pricing
- OpenRouter API Docs: https://openrouter.ai/docs/api/reference/overview
- OpenRouter Model Fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- LiteLLM Docs: https://docs.litellm.ai/
- MCP Docs: https://modelcontextprotocol.io/docs/getting-started/intro
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Top 10 for LLM Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OpenTelemetry Docs: https://opentelemetry.io/docs/
