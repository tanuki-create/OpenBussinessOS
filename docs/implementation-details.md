# Open Business OS MVP 実装詳細

作成日: 2026-04-28

## 1. 位置づけ

このドキュメントは、現在のリポジトリに実装済みの依存追加なしMVPの実装詳細をまとめる。

元の詳細設計書は将来のTypeScriptモノレポ、PostgreSQL、Drizzle、Queue、Provider/Connector Registryを想定している。一方、現在のMVPはまず最小ループをローカルで動かすため、Node.js標準機能だけで以下を実装している。

- スマホ向けPWA UI
- JSON API
- JSONファイル永続化
- 決定論的AIサンプル生成
- 任意のDeepSeek互換ライブLLM経路
- APIキー暗号化保存
- コスト台帳
- Playbook Run
- Business Map / Initiative / WorkItem / Review
- Markdown export
- ToolAction draft / approval / execution stub
- Repository境界
- Memory Graph / Project Memory Summary UI
- GitHub Issue draft生成
- Unit / Smoke test

## 2. 起動と確認

### 起動

```sh
npm run dev
```

起動後:

```txt
http://localhost:3000
```

### テスト

```sh
npm run check
npm test
npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

### Live LLMを使う場合

デフォルトは決定論的サンプル生成で動く。外部APIに依存せずテストを安定させるためである。

DeepSeek互換APIを使う場合:

```sh
OPEN_BUSINESS_OS_LIVE_LLM=1 DEEPSEEK_API_KEY=... npm run dev
```

または、PWAの設定画面からworkspace APIキーを保存する。保存されたAPIキーはサーバー側で暗号化され、フロントエンドには返らない。

## 3. 実装構成

```txt
.
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── server.js
│   │       ├── store.js
│   │       ├── security.js
│   │       └── repositories/
│   └── web/
│       └── public/
│           ├── index.html
│           ├── app.js
│           ├── styles.css
│           ├── manifest.webmanifest
│           └── service-worker.js
├── packages/
│   ├── core/
│   ├── db/
│   ├── schemas/
│   ├── llm-gateway/
│   ├── playbooks/
│   └── security/
├── config/
│   ├── provider-registry.json
│   └── llm-policy.json
├── tests/
│   ├── unit.mjs
│   └── smoke.mjs
└── docs/
```

PostgreSQL移行のための初期schemaは `packages/db/schema.sql` に置く。現在のAPIはJSON Storeで動くが、DBのsource of truthはPostgreSQLへ移す前提で設計する。

## 4. APIサーバ

主ファイル:

- `apps/api/src/server.js`
- `apps/api/src/store.js`
- `apps/api/src/security.js`

### 4.1 HTTPサーバ

`server.js` はNode.js標準の `node:http` で動く。外部フレームワークは使っていない。

責務:

- `/api/v1/*` のJSON API処理
- `apps/web/public` の静的配信
- SPA fallback
- APIエラー形式の統一
- Playbook Run実行
- ToolAction承認ゲート
- Markdown export

APIエラー形式:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "oneLiner is required.",
    "details": {}
  }
}
```

主要エラーコードとHTTPステータスは `statusForErrorCode()` に集約している。

### 4.2 永続化

`store.js` の `JsonStore` が `data/open-business-os.json` に保存する。

特徴:

- 初回起動時にLocal User / Local Workspaceを作成
- `transaction()` で変更と保存を直列化
- 失敗時は変更前snapshotへ戻す
- 失敗したtransaction後も後続queueが詰まらない
- `data/` は `.gitignore` 対象

現在の主要collection:

- `users`
- `workspaces`
- `workspace_memberships`
- `projects`
- `visions`
- `metrics`
- `assumptions`
- `evidence`
- `decisions`
- `initiatives`
- `work_items`
- `reviews`
- `playbook_runs`
- `ai_runs`
- `api_keys`
- `budgets`
- `cost_ledger`
- `tool_actions`
- `audit_logs`
- `business_maps`

### 4.3 主なAPI

Health / Me:

```txt
GET /api/v1/health
GET /api/v1/me
```

Workspace:

```txt
GET   /api/v1/workspaces
POST  /api/v1/workspaces
GET   /api/v1/workspaces/:workspaceId
PATCH /api/v1/workspaces/:workspaceId
```

API Keys / Cost:

```txt
GET  /api/v1/workspaces/:workspaceId/api-keys
POST /api/v1/workspaces/:workspaceId/api-keys
POST /api/v1/workspaces/:workspaceId/api-keys/test
POST /api/v1/workspaces/:workspaceId/api-keys/:keyId/test
GET  /api/v1/workspaces/:workspaceId/costs/summary
```

Project:

```txt
GET  /api/v1/projects
POST /api/v1/projects
GET  /api/v1/projects/:projectId
GET  /api/v1/projects/:projectId/business-map
GET  /api/v1/projects/:projectId/initiatives
POST /api/v1/projects/:projectId/initiatives
GET  /api/v1/projects/:projectId/work-items
POST /api/v1/projects/:projectId/work-items
GET  /api/v1/projects/:projectId/reviews
POST /api/v1/projects/:projectId/reviews
GET  /api/v1/projects/:projectId/memory/graph
GET  /api/v1/projects/:projectId/memory/nodes
POST /api/v1/projects/:projectId/memory/nodes
POST /api/v1/projects/:projectId/memory/edges
GET  /api/v1/projects/:projectId/memory/summary
POST /api/v1/projects/:projectId/memory/refresh-summary
GET  /api/v1/projects/:projectId/export/markdown
```

Playbook / AI:

```txt
GET  /api/v1/playbooks
POST /api/v1/playbook-runs
GET  /api/v1/playbook-runs/:runId
POST /api/v1/playbook-runs/:runId/approve-output
POST /api/v1/ai-runs
GET  /api/v1/ai-runs/:aiRunId
```

ToolAction:

```txt
POST /api/v1/tool-actions
POST /api/v1/work-items/:workItemId/github-issue-draft
GET  /api/v1/projects/:projectId/tool-actions
POST /api/v1/tool-actions/:actionId/approve
POST /api/v1/tool-actions/:actionId/execute
POST /api/v1/tool-actions/:actionId/cancel
```

`execute` は `approved` 状態でない場合、`TOOL_ACTION_REQUIRES_APPROVAL` を返す。

## 5. Web/PWA

主ファイル:

- `apps/web/public/index.html`
- `apps/web/public/app.js`
- `apps/web/public/styles.css`
- `apps/web/public/manifest.webmanifest`
- `apps/web/public/service-worker.js`

### 5.1 UI構成

`app.js` は依存なしのSPAで、以下のviewを持つ。

- `idea`: 事業アイデア一文入力
- `intake`: 段階質問
- `map`: Business Mapカード
- `work`: Initiative / WorkItem
- `review`: Review入力
- `memory`: Playbook output承認、Memory Graph、Project Memory Summary
- `export`: Markdown export
- `settings`: Workspace / AI / 予算

下部ナビから主要viewへ移動できる。スマホの片手操作を優先し、主要操作はカード単位にしている。

### 5.2 状態管理

フロントエンド状態は `localStorage` の `open-business-os-mvp` に保存する。

ただし、APIキーやsecret相当の値は保存対象から除外する。

- `apiKey`
- `api_key`
- `secret`
- `token`

APIが使えない場合は `sampleMode` に切り替わり、ローカルサンプル生成で操作を継続する。

### 5.3 API接続

`apiRequest()` が `/api/v1` へfetchする。失敗時は `syncWithFallback()` がfallback関数を呼び、UIを止めない。

APIレスポンスは `unwrapApi()` で以下を吸収する。

- `workspace`
- `project`
- `businessMap`
- `business_map`
- `playbookRun.output`
- `run.output`
- `output`
- `result`

Memory viewでは以下を扱う。

- `POST /playbook-runs/:id/approve-output`
- `GET /projects/:id/memory/graph`
- `GET /projects/:id/memory/summary`
- WorkItem単位の簡易Trace
- WorkItemからGitHub Issue draft作成

Cost dockでは月次使用額、残額、予算超過状態を表示する。APIからCost Summaryが取得できない場合はローカル推定で継続する。

## 6. Core

主ファイル:

- `packages/core/src/entities.js`
- `packages/core/src/index.js`

責務:

- Workspace / Project生成
- Card生成と承認/アーカイブ
- Assumption状態更新
- Initiative生成
- WorkItem生成
- Review生成
- ToolAction状態更新

現時点ではAPIサーバ側にもsnake_caseでの生成処理がある。次フェーズでは、API実装を `packages/core` のhelperへ寄せて重複を減らす。

## 7. Schema

主ファイル:

- `packages/schemas/src/validation.js`
- `packages/schemas/src/business-map.js`
- `packages/schemas/src/initiative-generation.js`
- `packages/schemas/src/engineering-state-analysis.js`
- `packages/schemas/src/api-error.js`
- `packages/schemas/src/index.js`

Zodなどの外部依存は使わず、手書きvalidatorで以下を検証する。

- `BusinessMapOutput`
- `InitiativeGenerationOutput`
- `EngineeringStateAnalysisOutput`
- API Error shape

テストでは、enum不正値やtimebox範囲外が拒否されることを確認している。

## 8. LLM Gateway

主ファイル:

- `packages/llm-gateway/src/provider-registry.js`
- `packages/llm-gateway/src/policy-routing.js`
- `packages/llm-gateway/src/cost-estimator.js`
- `packages/llm-gateway/src/sample-output.js`
- `packages/llm-gateway/src/deepseek.js`
- `packages/llm-gateway/src/index.js`
- `config/provider-registry.json`
- `config/llm-policy.json`

### 8.1 Routing

`provider-registry.json` にProviderとModelを定義する。

現在のProvider:

- `deepseek_direct`
- `openrouter`
- `litellm_proxy`

`llm-policy.json` にtask別routing、approval条件、max output tokens、fallback方針を定義する。

### 8.2 Sample Output

`sample-output.js` と `samples.js` が決定論的なサンプル出力を返す。

サンプル生成は以下の理由でデフォルトになっている。

- 外部ネットワークなしで動く
- テストが安定する
- BYOK設定前でもUIを試せる
- コストが発生しない

### 8.3 DeepSeek互換経路

`deepseek.js` はOpenAI互換のchat requestを組み立てる。

`server.js` の `generatePlaybookOutput()` は、以下の条件でライブLLMを呼ぶ。

- `OPEN_BUSINESS_OS_LIVE_LLM=1`
- workspace APIキーまたは `DEEPSEEK_API_KEY` が存在する

条件を満たさない場合はサンプル生成に戻る。

### 8.4 Cost

`cost-estimator.js` と `cost.js` がtoken数とモデル価格から推定コストを計算する。

API実行時には `ai_runs` と `cost_ledger` に以下を保存する。

- provider
- model
- task
- input tokens
- output tokens
- cache hit tokens
- estimated cost USD
- status

## 9. Security

主ファイル:

- `packages/security/src/secrets.js`
- `packages/security/src/redaction.js`
- `packages/security/src/rbac.js`
- `packages/security/src/audit.js`
- `apps/api/src/security.js`

### 9.1 APIキー暗号化

APIキーはAES-256-GCMで暗号化する。

暗号鍵の材料:

1. `OPEN_BUSINESS_OS_ENCRYPTION_KEY`
2. `OPEN_BUSINESS_OS_SECRET`
3. local dev fallback

保存時:

- `encrypted_key` に暗号文
- `key_hint` に識別用の短いhint
- raw keyはレスポンスに含めない

### 9.2 Redaction

`redaction.js` は以下をマスクする。

- `apiKey`
- `token`
- `secret`
- `password`
- `Bearer ...`
- `sk-...`

### 9.3 RBAC

`rbac.js` はrole rankとaction別最小roleを持つ。

現在のrole:

- `owner`
- `admin`
- `member`
- `viewer`
- `external_advisor`

MVPでは本格認証は未実装のため、APIはLocal User前提で動く。ただし、workspace write系の主要APIではRBAC helperを使って権限を強制する。

現在APIで確認している例:

- OwnerのみAPIキー作成
- Member以上のみProject / WorkItem / Review / AI run作成
- Admin以上のみConnector / ToolAction作成

ローカル検証では `x-open-business-os-role` headerでroleを切り替えられる。

### 9.4 ToolAction安全性

ToolActionは外部書き込みの下書きモデルである。

現在の実装:

1. `POST /tool-actions` で `draft`
2. `POST /work-items/:id/github-issue-draft` でGitHub Issue作成draft
3. `POST /tool-actions/:id/approve` で `approved`
4. `POST /tool-actions/:id/execute` で `completed`

`approved` 前のexecuteは拒否する。実際のGitHub API呼び出しはまだ実装していない。

## 10. Playbook

定義ファイル:

- `packages/playbooks/registry/idea_intake.json`
- `packages/playbooks/registry/business_map_generation.json`
- `packages/playbooks/registry/initiative_generation.json`
- `packages/playbooks/registry/implementation_breakdown.json`
- `packages/playbooks/registry/weekly_review.json`

APIでは `POST /api/v1/playbook-runs` がplaybookIdを受け取り、対応するtaskの出力を作る。

現在は同期実行で即 `completed` になる。将来はQueue/BullMQ/Temporalで非同期化する。

## 11. Markdown Export

`GET /api/v1/projects/:projectId/export/markdown` はtext/markdownを返す。

含めるセクション:

- Project title
- Business Map
- Target Users
- Assumptions
- Risks
- Initiative / 施策
- WorkItem / タスク
- Review / レビュー
- Decision Log
- Memory Graph

APIキーなどのsecretは含めない。

## 12. Test

### Unit

`tests/unit.mjs`

検証内容:

- APIキー暗号化/復号
- 暗号化payloadにplaintextが含まれない
- redaction
- BusinessMap schema
- Initiative schema
- LLM cost estimator
- RBAC
- JSON Repository境界

### Smoke

`tests/smoke.mjs`

起動済みAPIに対して、MVPの主要ループを直列に検証する。

検証内容:

- health endpoint
- PWA index配信
- manifest配信
- workspace作成
- APIキー保存とsecret非返却
- viewer roleのAPIキー作成拒否
- project作成
- playbook run
- high_qualityの明示承認要求
- Playbook output承認適用
- Memory Graph / Summary
- business map取得
- initiative作成
- work item作成
- WorkItemからGitHub Issue draft作成
- review作成
- ToolAction draft/approve/execute
- Markdown export
- Cost summary

## 13. 既知の制約

- 認証/セッションは未実装
- DB runtimeはPostgreSQLではなくJSONファイル
- PostgreSQLはschemaと接続境界まで
- Queueは未実装
- Budget enforcementはPlaybook live LLM実行前に適用。Provider実使用量との精算は未実装
- AI出力のrepair promptは未実装
- Provider fallbackの実呼び出しは未実装
- GitHub/Slack/Webhook connectorの実通信は未実装
- フロントのカード編集は主にローカル状態中心
- 本番運用向けのrate limit / CSRF / secure cookie / OIDCは未実装

## 14. DB / Memory方針

DBの本命はPostgreSQLにする。現在のJSON Storeはローカル開発用fallbackとして残す。

採用方針:

```txt
Rules: Markdown
Source of truth: PostgreSQL
Relations: memory_edges
Search: pgvector later
LLM Context: graph traversal + summary
Export: Markdown
```

固定ルールや設計原則はMarkdownで管理する。一方、仮説、証拠、意思決定、却下理由、置換関係、WorkItemの理由はDBのMemory Graphで管理する。

追加済みのDB設計:

- `packages/db/schema.sql`
- `memory_nodes`
- `memory_edges`
- `project_memory_summaries`
- `docker-compose.yml`
- `.env.example`

Memory Graphの詳細は `docs/memory-architecture.md` を参照。

現在のJSON Store実装にも、PostgreSQL schemaと同じ考え方で以下を追加済み。

- `memory_nodes`
- `memory_edges`
- `project_memory_summaries`

APIサーバには `apps/api/src/repositories/` を追加し、JSON StoreをRepository境界越しに扱い始めている。`OPEN_BUSINESS_OS_STORE=postgres` の入口とschema初期化helperは用意したが、依存なしMVPを維持するためPostgreSQL runtime repositoryはまだ有効化していない。

Business Map生成結果は `metrics` と `assumptions` に正規化される。Initiative生成結果は関連するAssumption / Metricを推定して `related_assumption_id` / `related_metric_id` を持つ。WorkItemは `initiative_id` を持ち、Memory Graph上では `implements` edgeで接続される。

Playbook Runのoutputは `POST /api/v1/playbook-runs/:runId/approve-output` でProject Stateへ適用できる。Business Map outputは承認後に `business_maps.status = approved` となり、Project StateとMemory Graphへ反映される。

Live LLM経路では、taskに応じて以下のschema validationを保存前に実行する。

- `business_map_generation`: `BusinessMapOutput`
- `initiative_generation`: `InitiativeGenerationOutput`
- `implementation_breakdown`: `InitiativeGenerationOutput`
- `engineering_state_analysis`: `EngineeringStateAnalysisOutput`

`budgetMode = high_quality` は明示承認なしでは `TOOL_ACTION_REQUIRES_APPROVAL` で拒否する。Live LLM実行時は推定コストを月次予算と照合し、超過時は `BUDGET_EXCEEDED` を返す。

## 15. 次に触るべき場所

優先度が高い順:

1. PostgreSQL runtime repositoryを実装する
2. API生成処理を `packages/core` helperへ寄せる
3. 認証/セッションを導入し、workspace membershipを実ユーザーに接続する
4. ToolAction executeでGitHub APIをdry-run/real-runに分ける
5. Provider fallbackとrepair promptを実装する
6. E2EをPlaywright化し、スマホviewportでMemory/承認UIを検証する
