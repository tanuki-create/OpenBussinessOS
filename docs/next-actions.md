# Open Business OS 次のアクション考案

作成日: 2026-04-28

## 1. 現在地

現在のMVPは、ローカルで以下のループを動かせる。

1. Workspaceを作る
2. APIキーを暗号化保存する
3. 事業アイデアを一文入力する
4. Playbook RunでBusiness Mapを生成する
5. InitiativeとWorkItemを作る
6. Reviewを入力する
7. ToolActionをdraftからapprove/executeへ進める
8. Markdown exportする
9. Cost Summaryを見る
10. Playbook outputを承認してProject Stateへ適用する
11. Memory GraphでWorkItemから上位の施策・仮説・指標を辿る
12. Project Memory Summaryをgraph traversalから生成する
13. Repository境界でJSON Storeを隠し始める
14. スマホUIからPlaybook outputを承認する
15. スマホUIでMemory Graph / Summaryを見る
16. WorkItemからGitHub Issue draftを作る
17. RBACをAPI write系に適用する
18. ブラウザレスmobile E2EでPWA asset契約と主要API workflowを検証する
19. PostgreSQL runtime Storeで起動できる
20. token-based AuthでLocal User固定から脱却する入口がある
21. GitHub Issue ToolActionを承認後にdry-run / token実行できる
22. live LLMのJSON/schema不一致時にrepair promptを試す

次の開発では、MVPを「ローカル実用可能」から「外部公開できるセルフホストOSS」へ近づける。

## 1.1 実装済みになった中核

- Project State正規化の初期実装
- `memory_nodes` / `memory_edges` のJSON Store実装
- `GET /projects/:id/memory/graph`
- `GET /projects/:id/memory/summary`
- `POST /playbook-runs/:id/approve-output`
- Live LLM出力のtask別schema validation
- `high_quality` 実行の明示承認要求
- Live LLM実行前の月次budget check
- `apps/api/src/repositories/` のJSON Repository境界
- Memory / approve-output / BudgetのスマホUI接続
- WorkItem -> GitHub Issue draft connector
- API write系の最小RBAC enforcement
- Playbook RunのLLM requestへProject Memory Summaryを同梱
- `tests/e2e-mobile.mjs` によるブラウザレスmobile PWA/API workflow検証
- PostgreSQL runtime Store
- token based Auth / `/me`
- GitHub Issue ToolAction execute
- DeepSeek live出力のrepair prompt

次の作業は、OIDC/secure cookie、durable async queue、Provider fallback、Playwrightでの実viewport検証へ進めること。

## 2. 判断基準

次のアクションは以下の基準で優先する。

| 基準 | 意味 |
| --- | --- |
| 実利用価値 | ユーザーが自分の事業で使える度合いが上がるか |
| 安全性 | APIキー、AI出力、外部ツール実行の事故を減らすか |
| 追跡性 | VisionからWorkItemまで理由を辿れるか |
| コスト制御 | BYOK利用者の不安を減らすか |
| OSS拡張性 | Provider / Playbook / Connectorを外部貢献しやすくするか |
| 実装リスク | 今の設計を壊さず段階的に入れられるか |

## 3. 最優先の結論

次にやるべき順番は以下。

1. **OIDC / secure cookie Auth**
2. **Durable Queue / async Playbook Run**
3. **Playwright E2E / mobile visual regression**
4. **Provider fallback**
5. **pgvector補助検索**
6. **Backup / restore / migration tooling**

理由:

- PostgreSQL runtime、token Auth、GitHub executeの入口は入ったため、外部公開前にOIDC/secure cookieを固める。
- 同期Playbook Runはローカルでは十分だが、実運用ではretry/復旧/長時間実行に耐えない。
- ブラウザレスE2Eは入ったが、実viewportでの描画・スクリーンショット・重なり検査はまだないため、Playwrightで回帰検出を追加する。

## 4. 直近7日アクション

### A1. OIDC / secure cookie Auth

状態:

`local|token` modeはMVP最小実装済み。`token` modeではBearer/header/session cookie tokenからuserを解決し、workspace membershipでAPI権限を判定する。

目的:

token based Authから、外部公開可能な認証へ進める。

実装対象:

- `apps/api/src/auth.js`
- `apps/api/src/server.js`
- `packages/security/src/*`
- `apps/web/public/app.js`
- `tests/smoke.mjs`

やること:

- `OPEN_BUSINESS_OS_AUTH_MODE=local|token|oidc`
- secure cookie session
- CSRF対策
- OIDC callback / logout
- workspace invite

受け入れ条件:

- 未認証write不可
- viewerはreadのみ
- owner/admin/memberが実ユーザー単位で判定される
- cookie/session secret rotationの方針がある

### A2. Durable Queue / async Playbook Run

目的:

同期実行から、retry/復旧可能な非同期実行へ移す。

実装対象:

- `apps/api/src/server.js`
- `apps/api/src/queue*.js`
- `tests/smoke.mjs`

やること:

- pending/running/completed/failedのdurable status
- retry policy
- stale running job recovery
- worker process分離
- UI polling

受け入れ条件:

- 長いLLM requestでHTTP接続を保持しない
- 失敗jobが再実行できる
- server restart後にpending/running jobを復旧できる

### A3. PostgreSQL smoke in CI / migration tooling

目的:

PostgreSQL runtimeをCIとローカルで再現可能にし、schema driftを検出する。

実装対象:

- `packages/db/schema.sql`
- `apps/api/src/repositories/postgres.js`
- `docker-compose.yml`
- `tests/smoke.mjs`

やること:

- CIでPostgres serviceを起動
- `OPEN_BUSINESS_OS_STORE=postgres` のsmokeを追加
- JSON -> Postgres migration script
- backup / restore command
- schema drift check

受け入れ条件:

- CIでPostgres smokeが通る
- migration再実行が安全
- backupから復元してsmokeが通る

### A4. Playwright E2E / mobile visual regression

目的:

スマホで「入力 -> Map -> 承認 -> Memory -> GitHub draft」まで壊れていないことを自動検証する。

実装対象:

- `apps/web/public/app.js`
- `apps/web/public/styles.css`
- `tests/e2e/*.mjs`

現状:

- `tests/e2e-mobile.mjs` でPWA asset契約とAPI workflow契約は検証済み
- ブラウザdownloadなしでCIに載せられる

やること:

- Playwright導入
- mobile viewport screenshot
- PWA navigation確認
- Memory view / approval button確認
- text overflow / overlap検査

受け入れ条件:

- iPhone幅で主要ボタンが見切れない
- Memory Graphが空白にならない
- 承認後にnodes/edgesが増える

### A5. Provider fallback

目的:

LLM provider障害、rate limit、モデル別失敗でユーザー作業が止まらないようにする。

実装対象:

- `apps/api/src/server.js`
- `packages/llm-gateway/src/*`
- `tests/smoke.mjs`

やること:

- Provider fallback順序
- rate limit時のsample/draft fallback
- error normalization

受け入れ条件:

- invalid JSONが直接Project Stateへ保存されない
- repair失敗時は人間レビュー待ちになる
- Cost Ledgerに失敗も記録される

## 5. 次の2週間アクション

### B1. OIDC / secure cookie Auth

目的:

token based Authから、セルフホスト本番向け認証へ進める。

実装対象:

- `apps/api/src/auth.js`
- `apps/api/src/server.js`
- `apps/web/public/app.js`
- `tests/smoke.mjs`

やること:

- OIDC provider設定
- secure cookie session
- CSRF token
- logout
- workspace invite

受け入れ条件:

- 未認証write不可
- viewerはreadのみ
- owner/admin/memberが実ユーザー単位で判定される

### B2. Durable async queue

目的:

Playbook Runを同期HTTPからdurable jobへ移す。

やること:

- queue backend選定
- pending/running/completed/failed状態
- retry
- restart recovery
- UI polling

受け入れ条件:

- 長時間LLM requestでHTTPを保持しない
- 失敗jobを再実行できる
- restart後にpending/runningを復旧できる

### B3. Backup / restore / migration

目的:

PostgreSQL runtimeを運用できる最低限の退避・復旧手順を持つ。

実装対象:

- `packages/db/schema.sql`
- `scripts/*`
- `tests/smoke.mjs`

やること:

- JSON -> Postgres migration
- Postgres backup
- restore
- schema drift check

受け入れ条件:

- backupから復元後にsmokeが通る
- migration再実行が安全

### B4. Playwright E2E

目的:

スマホ操作で主要ループが壊れていないことを継続確認する。

対象:

- setup
- idea intake
- business map
- approve-output
- Memory Graph
- GitHub Issue draft
- export

受け入れ条件:

- mobile viewportで主要テキストが重ならない
- Memory Graphが空白にならない
- approve-output後にnodes/edgesが更新される
- exportにMemory Graphが含まれる

## 6. 1か月アクション

### C1. PostgreSQL + Migration

目的:

設計書のDB schemaへ近づけ、複数ユーザー/複数workspaceに耐える。

やること:

- `packages/db/schema.sql` またはmigration導入
- users/workspaces/projects/assumptions/initiatives/work_items/reviews/playbook_runs/ai_runs/cost_ledger/tool_actions/audit_logs
- memory_nodes/memory_edges/project_memory_summaries
- JSON Storeからの移行script
- DB接続なしではJSON fallback

受け入れ条件:

- PostgreSQL modeでsmoke testが通る
- JSON modeでも既存動作が残る
- migration再実行が安全

### C2. pgvector補助検索

目的:

Memory Graphの関係性をsource of truthにしたまま、類似ノード探索を高速化する。

やること:

- `pgvector` extensionを任意導入にする
- `memory_node_embeddings` 相当の保存形式を設計する
- 類似Assumption / Review / WorkItem候補を検索する
- relation edgeの作成候補として使う

受け入れ条件:

- pgvectorなしでもMemory Graphは動く
- pgvectorありならsimilar_to候補を作れる
- vector結果だけで因果関係を確定しない

### C3. AI Eval Scenario

目的:

AI出力品質を継続的に確認する。

やること:

- `packages/evals/scenarios`
- idea intake用fixture
- business map用fixture
- initiative generation用fixture
- schema validity
- traceability
- risk coverage
- cost mode adherence

受け入れ条件:

- sample outputとlive outputの両方を評価できる
- JSON schema不一致を検出できる
- WorkItemにWhy/Acceptance Criteriaがない場合に失敗する

## 7. 具体的なIssue案

### Issue 1: Add OIDC / secure cookie auth

内容:

token based Authから外部公開可能な認証へ進める。

完了条件:

- secure cookie session
- CSRF
- OIDC login/logout
- workspace invite

### Issue 2: Add durable async Playbook queue

内容:

Playbook Runを同期HTTPからdurable jobへ移す。

完了条件:

- pending/running/completed/failed
- retry
- restart recovery
- UI polling

### Issue 3: Add PostgreSQL backup / restore / migration

内容:

PostgreSQL runtimeを安全に運用するための退避・復旧を追加する。

完了条件:

- JSON -> Postgres migration
- backup command
- restore command
- restored DBでsmoke pass

### Issue 4: Add Playwright mobile E2E

内容:

スマホviewportで主要ループを自動検証する。

完了条件:

- setup -> map -> approve -> memory -> github draft -> exportが通る
- 主要テキストが重ならない
- Memory Graphが空白ではない

### Issue 5: Provider fallback

内容:

provider障害やrate limit時にfallbackする。

完了条件:

- rate limit時のfallback
- provider別error normalization
- 失敗AI runもCost Ledgerに残る

### Issue 6: Add pgvector-assisted similarity

内容:

Memory Graphをsource of truthにしたまま、類似ノード候補だけpgvectorで補助する。

完了条件:

- pgvectorなしでも動く
- pgvectorありでsimilar_to候補を出せる
- vector結果だけで因果edgeを確定しない

### Issue 7: Add AI eval scenarios

内容:

sample/live outputの品質を継続評価する。

完了条件:

- idea intake / business map / initiative fixture
- schema validity
- traceability
- cost mode adherence

## 8. 実装順の推奨

最も現実的な順番:

1. Issue 1: OIDC / secure cookie auth
2. Issue 2: durable async queue
3. Issue 3: PostgreSQL backup / restore / migration
4. Issue 4: Playwright mobile E2E
5. Issue 5: Provider fallback
6. Issue 6: pgvector-assisted similarity
7. Issue 7: AI eval scenarios

理由:

- token Authは入ったが、外部公開前にはOIDC/secure cookieが必要。
- 同期Playbook Runは長時間実行と復旧に弱いためQueueが必要。
- PostgreSQL runtimeは入ったため、次はbackup/restore/migrationの運用面を固める。
- UI回帰はここから増えるのでE2Eを早めに入れる。
- pgvectorは関係性の補助検索なので後段でよい。

## 9. やらない方がよいこと

直近では避ける:

- CRMやBI dashboardを先に作る
- 自動メール送信
- 本番deploy自動化
- 複雑なマルチエージェント基盤
- Providerを大量追加する
- UIを管理画面化する
- PostgreSQL移行前に巨大なORM設計を固める
- Markdownやvector検索を長期記憶のsource of truthにする

理由:

MVPの価値は「構想から検証可能な施策とWorkItemへ進むこと」であり、周辺機能を増やすほど検証速度が落ちる。

## 10. 次回開発セッションの開始コマンド

```sh
npm run check
npm test
npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

最初に確認する画面:

```txt
http://localhost:3000
```

最初に触るファイル:

- `apps/api/src/server.js`
- `apps/api/src/store.js`
- `packages/db/schema.sql`
- `packages/schemas/src/index.js`
- `packages/llm-gateway/src/index.js`
- `tests/smoke.mjs`
