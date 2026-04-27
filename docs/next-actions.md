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

次の開発では、MVPを「見せられるデモ」から「実利用に耐えるセルフホストOSS」へ近づける。

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

次の作業は、PostgreSQL runtime repository、本格Auth、外部Connectorの実実行、E2E検証へ進めること。

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

1. **PostgreSQL runtime repository**
2. **Auth / Workspace membership**
3. **GitHub Issue execute connector**
4. **Playwright E2E / mobile visual regression**
5. **Provider fallback / repair prompt**
6. **pgvector補助検索**
7. **Queue / async Playbook Run**

理由:

- Repository境界とJSON fallbackは入ったため、次はPostgreSQLを実際のruntime source of truthにする。
- UIからMemoryと承認は扱えるようになったため、外部公開前にAuthを先に固める。
- GitHub Issue draftはできたため、次は承認後executeをdry-run/real-runで分ける。
- 手元スマホで使えるが、E2Eとviewport検証がないため、回帰検出を追加する。

## 4. 直近7日アクション

### A1. PostgreSQL runtime repository

目的:

`OPEN_BUSINESS_OS_STORE=postgres` でPostgreSQLをsource of truthとして起動できるようにする。

実装対象:

- `apps/api/src/repositories/*.js`
- `apps/api/src/store.js`
- `packages/db/schema.sql`
- `tests/unit.mjs`
- `tests/smoke.mjs`

やること:

- `pg` 依存追加またはnode-postgres互換adapterの導入
- transaction境界をPostgreSQLへ移す
- Workspace / Project / Memory / PlaybookRun / Cost / ToolActionのPostgres実装
- JSON fallback維持
- APIキー暗号文をPostgresへ保存
- schema init済みDBでsmoke test

受け入れ条件:

- `docker compose up -d` 後にPostgres modeで起動できる
- Postgres modeでsmoke testが通る
- `DATABASE_URL` がない場合はJSON modeで動く
- raw API keyがDBにもレスポンスにも残らない

### A2. Auth / Workspace membership

目的:

Local User前提をやめ、実ユーザーとworkspace membershipで権限を決める。

実装対象:

- `apps/api/src/server.js`
- `packages/security/src/*`
- `apps/web/public/app.js`
- `tests/smoke.mjs`

やること:

- session token / local dev tokenの最小実装
- `GET /me` を実ユーザー化
- workspace membership inviteの下地
- `x-open-business-os-role` 依存をtest/dev限定にする
- owner/admin/member/viewerのAPI smokeを追加

受け入れ条件:

- APIキー作成はownerだけ
- Connector executeはadmin以上だけ
- viewerはreadのみ
- 未認証requestはwriteできない

### A3. GitHub Issue execute connector

目的:

GitHub Issue draftを人間承認後に実際のGitHub Issueへ変換できるようにする。

実装対象:

- `apps/api/src/server.js`
- `apps/api/src/connectors/github*.js`
- `apps/web/public/app.js`
- `tests/smoke.mjs`

やること:

- GitHub tokenのサーバー保存
- ToolAction payload validation
- dry-run execute
- real execute
- external_url / external_idをWorkItemへ反映

受け入れ条件:

- tokenなしではdry-run
- tokenありではIssue作成
- raw tokenはレスポンス/Markdown/logに出ない
- execute前approve必須

### A4. Playwright E2E / mobile visual regression

目的:

スマホで「入力 -> Map -> 承認 -> Memory -> GitHub draft」まで壊れていないことを自動検証する。

実装対象:

- `apps/web/public/app.js`
- `apps/web/public/styles.css`
- `tests/e2e/*.mjs`

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

### A5. Provider fallback / repair prompt

目的:

LLMの失敗、schema不一致、rate limitでユーザー作業が止まらないようにする。

実装対象:

- `apps/api/src/server.js`
- `packages/llm-gateway/src/*`
- `tests/smoke.mjs`

やること:

- Provider fallback順序
- schema validation失敗時のrepair prompt
- rate limit時のsample/draft fallback
- error normalization

受け入れ条件:

- invalid JSONが直接Project Stateへ保存されない
- repair失敗時は人間レビュー待ちになる
- Cost Ledgerに失敗も記録される

## 5. 次の2週間アクション

### B1. PostgreSQL runtime repository

目的:

JSON fallbackを残しつつ、PostgreSQLを実際の保存先として使えるようにする。

実装対象:

- `apps/api/src/repositories/*.js`
- `apps/api/src/store.js`
- `packages/db/schema.sql`
- `tests/unit.mjs`
- `tests/smoke.mjs`

やること:

- Workspace / Project / Memory / PlaybookRun / Cost / ToolActionのPostgres実装
- transactionをDB commit/rollbackへ対応
- `DATABASE_URL` と `OPEN_BUSINESS_OS_STORE=postgres` の起動確認
- JSONからPostgresへの最小移行script

受け入れ条件:

- Postgres modeでsmoke testが通る
- JSON modeでも既存smoke testが通る
- APIキー暗号文、Memory Graph、Cost LedgerがPostgresへ保存される

### B2. Auth / Workspace membership

目的:

Local User固定から、セルフホストで使える最低限の認証へ進める。

やること:

- `OPEN_BUSINESS_OS_AUTH_MODE=local|oidc` を設計
- session token / dev token
- `GET /me` を実ユーザー化
- workspace membership CRUDの下地
- write系APIのrole smoke testを追加

受け入れ条件:

- ownerのみAPIキー作成
- admin以上のみConnector execute
- viewerはreadのみ
- 未認証writeが拒否される

### B3. GitHub Issue execute connector

目的:

GitHub Issue draftを、人間承認後にdry-runまたは実Issue作成へ進める。

実装対象:

- `packages/connectors/github` または `packages/connectors/src/github.js`
- `apps/api/src/server.js`
- `tests/smoke.mjs`

やること:

- approve前executeは禁止
- executeは環境変数tokenがある場合のみGitHub APIを呼ぶ
- tokenなしではdry-run resultを返す
- 作成後にWorkItemへexternal_id / external_urlを反映

受け入れ条件:

- approve後のみexecuteできる
- GitHub tokenがない場合もdry-runでテストできる
- GitHub tokenがある場合はIssue URLを保存する

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

### Issue 1: Enable PostgreSQL runtime repository

内容:

`OPEN_BUSINESS_OS_STORE=postgres` でPostgreSQLをsource of truthにする。

完了条件:

- Postgres modeでsmoke test pass
- JSON fallbackでsmoke test pass
- APIキー暗号文、Memory Graph、Cost LedgerがPostgresへ保存される

### Issue 2: Add Auth and workspace membership

内容:

Local User固定をやめ、実ユーザーとworkspace roleでAPI権限を決める。

完了条件:

- ownerのみAPIキー作成
- viewerはwrite禁止
- 未認証write拒否
- `GET /me` が実ユーザーを返す

### Issue 3: Execute GitHub Issue ToolAction

内容:

GitHub Issue draftを承認後にdry-runまたは実Issue作成へ進める。

完了条件:

- approve前execute拒否
- tokenなしdry-run
- tokenありIssue作成
- WorkItemにexternal_url反映

### Issue 4: Add Playwright mobile E2E

内容:

スマホviewportで主要ループを自動検証する。

完了条件:

- setup -> map -> approve -> memory -> github draft -> exportが通る
- 主要テキストが重ならない
- Memory Graphが空白ではない

### Issue 5: Provider fallback and repair prompt

内容:

LLM失敗やschema不一致時にrepair/fallbackする。

完了条件:

- invalid JSONをProject Stateへ保存しない
- repair失敗時は人間レビュー待ち
- 失敗AI runもCost Ledgerに残る

### Issue 6: Add pgvector-assisted similarity

内容:

Memory Graphをsource of truthにしたまま、類似ノード候補だけpgvectorで補助する。

完了条件:

- pgvectorなしでも動く
- pgvectorありでsimilar_to候補を出せる
- vector結果だけで因果edgeを確定しない

### Issue 7: Queue async Playbook Run

内容:

Playbook Runを同期実行から非同期実行へ移す。

完了条件:

- pending/running/completed status
- polling API
- 失敗時retry
- UIで同期中状態を維持

## 8. 実装順の推奨

最も現実的な順番:

1. Issue 1: PostgreSQL runtime repository
2. Issue 2: Auth and workspace membership
3. Issue 3: GitHub Issue execute
4. Issue 4: Playwright mobile E2E
5. Issue 5: Provider fallback and repair prompt
6. Issue 6: pgvector-assisted similarity
7. Issue 7: Queue async Playbook Run

理由:

- JSON Repository境界は入ったため、次は保存先をPostgreSQLへ移す。
- 外部公開前にはAuthとworkspace membershipが必要。
- Draft connectorはできたため、次は承認後executeを安全に実装する。
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
