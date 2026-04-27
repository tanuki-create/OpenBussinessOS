# Open Business OS 実装詳細

更新日: 2026-04-28

## 1. 現在の実装範囲

このドキュメントは、現時点のリポジトリで実装済みのMVPを正とする。将来構想ではなく、いま起動・検証できる実装の詳細をまとめる。

実装済みの中核:

- スマホ向けPWA
- Node.js標準HTTPサーバによるJSON API
- ローカルJSON Store
- PostgreSQL runtime Store
- Workspace / Project / Business Map / Initiative / WorkItem / Review
- Playbook Runと承認後のProject State反映
- Memory GraphとProject Memory Summary
- 決定論的Sample LLM
- DeepSeek互換Live LLM経路
- Live LLM出力のJSON抽出、schema validation、repair prompt
- APIキー暗号化保存、redaction、月次コスト推定
- local / token auth、workspace membership enforcement
- ToolAction draft / approve / execute
- GitHub Issue dry-run / token実行
- Markdown export
- Unit / browserless mobile E2E / smoke / verify scripts

## 2. 起動と検証

標準起動:

```sh
npm install
npm run dev
```

URL:

```txt
http://localhost:3000
```

PostgreSQL mode:

```sh
docker compose up -d
OPEN_BUSINESS_OS_STORE=postgres npm run dev
```

`OPEN_BUSINESS_OS_INIT_DB=0` を指定しない限り、起動時に `packages/db/schema.sql` を適用する。

Live LLM mode:

```sh
OPEN_BUSINESS_OS_LIVE_LLM=1 DEEPSEEK_API_KEY=... npm run dev
```

標準検証:

```sh
npm run check
npm test
npm run test:e2e
npm run verify
```

起動済みサーバーに対するsmoke:

```sh
BASE_URL=http://localhost:3000 npm run test:smoke
```

直近の確認状況:

- `npm run verify`: pass
- JavaScript syntax check: pass
- `npm run test:smoke`: pass
- PostgreSQL smoke: Docker daemon未起動のため未実行

## 3. 実装構成

主要ファイル:

- `apps/api/src/server.js`: API、静的PWA配信、Playbook Run、ToolAction、Markdown export
- `apps/api/src/auth.js`: local / token auth、token抽出、membership解決
- `apps/api/src/security.js`: APIサーバ側のsecret処理
- `apps/api/src/store.js`: ローカルJSON Store
- `apps/api/src/repositories/json.js`: JSON Store repository境界
- `apps/api/src/repositories/postgres.js`: PostgreSQL Store runtime
- `apps/api/src/connectors/github.js`: GitHub Issue実行
- `apps/web/public/app.js`: dependency-free PWA
- `apps/web/public/styles.css`: mobile-first UI
- `packages/db/schema.sql`: PostgreSQL schema
- `packages/llm-gateway/src/*`: provider routing、sample output、DeepSeek、cost、structured output repair
- `packages/schemas/src/*`: structured output validation
- `packages/security/src/*`: encryption、redaction、RBAC、audit helper
- `tests/unit.mjs`: helperと認証境界
- `tests/e2e-mobile.mjs`: browserless PWA/API workflow contract
- `tests/smoke.mjs`: 起動済みAPIの主要workflow

## 4. API

API prefix:

```txt
/api/v1
```

主要endpoint:

```txt
GET  /health
GET  /me

GET  /workspaces
POST /workspaces
GET  /workspaces/:workspaceId
PATCH /workspaces/:workspaceId

GET  /projects
POST /projects
GET  /projects/:projectId
GET  /projects/:projectId/business-map
GET  /projects/:projectId/initiatives
POST /projects/:projectId/initiatives
GET  /projects/:projectId/work-items
POST /projects/:projectId/work-items
GET  /projects/:projectId/reviews
POST /projects/:projectId/reviews

GET  /projects/:projectId/memory/graph
GET  /projects/:projectId/memory/nodes
POST /projects/:projectId/memory/nodes
POST /projects/:projectId/memory/edges
GET  /projects/:projectId/memory/summary
POST /projects/:projectId/memory/refresh-summary

GET  /playbooks
POST /playbook-runs
GET  /playbook-runs/:runId
POST /playbook-runs/:runId/approve-output
POST /ai-runs
GET  /ai-runs/:aiRunId

POST /tool-actions
POST /work-items/:workItemId/github-issue-draft
GET  /projects/:projectId/tool-actions
POST /tool-actions/:actionId/approve
POST /tool-actions/:actionId/execute
POST /tool-actions/:actionId/cancel

GET  /projects/:projectId/export/markdown
```

エラー形式:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "oneLiner is required.",
    "details": {}
  }
}
```

## 5. 認証と権限

認証モードは `OPEN_BUSINESS_OS_AUTH_MODE` で切り替える。

- `local`: default。組み込みLocal Userとして認証する。ローカル開発とtest用に `x-open-business-os-role` を許可する。
- `token`: Bearer token、`x-open-business-os-token`、`x-api-token`、`obos_session` cookieからtokenを読む。

token modeの設定例:

```sh
OPEN_BUSINESS_OS_AUTH_MODE=token OPEN_BUSINESS_OS_API_TOKEN=change-me npm run dev
```

複数tokenを使う場合:

```txt
OPEN_BUSINESS_OS_AUTH_TOKENS={"owner-token":{"userId":"usr_xxx"}}
```

権限はAPI側で強制する。UI表示だけには依存しない。

- owner: API key、workspace設定、全write
- admin: connector / ToolAction作成など
- member: Project / WorkItem / Review / Playbook Run作成
- viewer: readのみ
- external_advisor: 制限付き閲覧

`GET /api/v1/me` は認証済みuserとworkspace membershipを返す。token modeでは、workspace read/writeはmembership roleで判定する。

## 6. 永続化

defaultはJSON Store:

```txt
data/open-business-os.json
```

PostgreSQL modeは `OPEN_BUSINESS_OS_STORE=postgres` と `DATABASE_URL` を使う。`pg` を直接使い、schemaは `packages/db/schema.sql` をsourceにする。

主要collection / table:

- users
- workspaces
- workspace_memberships
- projects
- visions
- metrics
- assumptions
- evidence
- decisions
- initiatives
- work_items
- reviews
- playbook_runs
- ai_runs
- api_keys
- budgets
- cost_ledger
- tool_actions
- audit_logs
- business_maps
- memory_nodes
- memory_edges
- project_memory_summaries

JSON Storeはローカル開発とゼロ設定起動用に残す。実運用のsource of truthはPostgreSQLへ寄せる。

## 7. Memory Graph

長期記憶の方針:

```txt
Rules: Markdown
Source of truth: PostgreSQL
Relations: memory_edges
Search: pgvector later
LLM Context: graph traversal + summary
Export: Markdown
```

Markdownは固定ルール、設計原則、共有、レビュー、export用に使う。変化する状態、却下理由、置換関係、意思決定、根拠はDBのMemory Graphで管理する。

代表的なnode type:

- vision
- metric
- assumption
- evidence
- decision
- initiative
- work_item
- review
- risk
- constraint
- preference
- lesson
- tool_action
- ai_run

代表的なrelation type:

- supports
- supported_by
- contradicts
- caused_by
- derived_from
- replaced_by
- blocks
- implements
- implemented_by
- validated_by
- rejected_because
- depends_on
- measured_by
- similar_to
- mentions
- updates

重要なクエリ例:

- 「このWorkItemはなぜ必要か」: WorkItem -> Initiative -> Assumption -> Metricを辿る。
- 「3週間前に否決した案は何か」: rejected / superseded nodeと `rejected_because` / `replaced_by` edgeを辿る。
- 「前回同じ問題をどう解いたか」: lesson / review / decision / work_itemと `similar_to` 候補を辿る。

pgvectorは将来の補助検索に使う。因果関係や却下理由のsource of truthにはしない。

## 8. LLM Gateway

defaultはSample LLM。外部APIなしで動き、テストが安定する。

Live LLM実行条件:

- `OPEN_BUSINESS_OS_LIVE_LLM=1`
- workspace API key、または `DEEPSEEK_API_KEY` がある

Live LLM経路では、task別にschema validationを行う。

- `business_map_generation`: BusinessMapOutput
- `initiative_generation`: InitiativeGenerationOutput
- `implementation_breakdown`: InitiativeGenerationOutput
- `engineering_state_analysis`: EngineeringStateAnalysisOutput

JSON parseまたはschema validationに失敗した場合、元の出力をProject Stateへ保存しない。1回だけrepair promptを実行し、repair後も失敗した場合はfailed `playbook_run` / `ai_run` とreviewable errorを残す。

`budgetMode = high_quality` は明示承認なしでは拒否する。Live LLM実行前には月次予算と推定コストを照合する。

## 9. ToolAction / GitHub

外部ツールへの書き込みは必ずToolActionを経由する。

状態遷移:

```txt
draft -> approved -> completed
draft -> cancelled
approved -> failed
```

GitHub Issue flow:

1. WorkItemからGitHub Issue draftを作成する。
2. ユーザーがToolActionをapproveする。
3. `execute` で実行する。
4. token未設定ならdry-run resultで完了する。
5. tokenとrepository設定があればGitHub Issues APIへ作成する。
6. 成功時はWorkItemに `external_provider` / `external_id` / `external_url` を保存する。

設定例:

```sh
OPEN_BUSINESS_OS_GITHUB_TOKEN=github_pat_here \
OPEN_BUSINESS_OS_GITHUB_REPOSITORY=owner/repo \
npm run dev
```

`OPEN_BUSINESS_OS_GITHUB_OWNER` と `OPEN_BUSINESS_OS_GITHUB_REPO` でも設定できる。

## 10. PWA

PWAは `apps/web/public` にあるdependency-free SPA。

主なview:

- idea
- intake
- map
- work
- review
- memory
- export
- settings

UI状態は `localStorage` の `open-business-os-mvp` に保存する。ただし、secret相当の値は永続化しない。

除外対象:

- apiKey
- api_key
- secret
- token

browserless E2Eでは、manifest、service worker、320px最小幅、44px tap target、safe-area、主要workflow API contractを確認する。実ブラウザviewport、screenshot、overlap検出はPlaywright導入後に追加する。

## 11. Markdown Export

`GET /api/v1/projects/:projectId/export/markdown` は共有用Markdownを返す。

含める内容:

- Project title
- Business Map
- Target Users
- Assumptions
- Risks
- Initiatives
- WorkItems
- Reviews
- Decision Log
- Memory Graph

API key、encrypted key、token、secretは含めない。

## 12. 既知の制約

- OIDC / secure cookie session / CSRFは未実装。
- Durable Queueは未実装。Playbook Runは現在同期実行。
- PostgreSQL runtimeは実装済みだが、Docker daemonがない環境ではPostgres smokeを実行できない。
- JSON -> PostgreSQL migration、backup、restore、schema drift checkは未実装。
- Provider fallbackの実呼び出しは未実装。
- pgvector補助検索は未実装。
- Playwrightによる実viewport visual regressionは未実装。
- Slack / Webhook connectorは未実装。
- AI eval scenarioは未実装。

## 13. 次に触る場所

優先順:

1. `apps/api/src/auth.js`: OIDC / secure cookie / CSRF
2. `apps/api/src/server.js`: async Playbook Run、worker分離、polling API
3. `apps/api/src/repositories/postgres.js`: migration、backup/restore検証
4. `tests/e2e-mobile.mjs` と新規Playwright suite: 実スマホviewport検証
5. `packages/llm-gateway/src/*`: provider fallback
6. `packages/db/schema.sql`: pgvector補助検索
