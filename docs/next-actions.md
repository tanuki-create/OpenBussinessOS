# Open Business OS 次のアクション

更新日: 2026-04-28

## 1. 現在地

ローカルMVPとして、次のループは動く。

1. Workspaceを作る。
2. APIキーを暗号化保存する。
3. 事業アイデアを一文入力する。
4. Playbook RunでBusiness Mapを生成する。
5. Playbook outputを承認してProject Stateへ反映する。
6. InitiativeとWorkItemを作る。
7. Reviewを残す。
8. Memory Graph / Project Memory Summaryで理由を辿る。
9. WorkItemからGitHub Issue draftを作る。
10. ToolActionをapprove / executeする。
11. Markdown exportする。
12. Cost Summaryを見る。

完了済みとして次アクションから外すもの:

- PostgreSQL runtime Store
- token auth / `/me`
- workspace membership enforcement
- GitHub Issue ToolAction dry-run / token実行
- browserless mobile E2E
- Live LLM structured output repair prompt
- Memory Graph API / UI
- Project Memory Summary
- high_quality approval gate
- Live LLM budget check

## 2. 優先判断

優先度は以下で決める。

| 基準 | 意味 |
| --- | --- |
| 外部公開安全性 | セルフホストOSSとして公開して事故が起きにくいか |
| 復旧性 | 長時間LLM実行、失敗、再起動に耐えるか |
| 検証可能性 | スマホで主要workflowが壊れていないと確認できるか |
| 運用可能性 | DB、backup、migration、cost、secretを扱えるか |
| 拡張性 | Provider / Connector / Memoryを段階的に増やせるか |

## 3. 実装順

妥協しない場合の順番:

1. OIDC / secure cookie Auth
2. Durable Queue / async Playbook Run
3. PostgreSQL CI smoke / migration / backup / restore
4. Playwright mobile visual regression
5. Provider fallback
6. pgvector-assisted memory search
7. AI eval scenarios
8. Slack / Webhook connectors

## 4. A1: OIDC / Secure Cookie Auth

目的:

token modeを、外部公開できる認証へ引き上げる。

対象:

- `apps/api/src/auth.js`
- `apps/api/src/server.js`
- `packages/security/src/*`
- `apps/web/public/app.js`
- `tests/unit.mjs`
- `tests/smoke.mjs`

作業:

- `OPEN_BUSINESS_OS_AUTH_MODE=local|token|oidc`
- OIDC discovery / callback / logout
- secure / httpOnly / sameSite cookie
- CSRF token
- session secret rotation方針
- workspace invite
- `/me` とmembershipのE2E

受け入れ条件:

- 未認証writeが拒否される。
- viewerはreadのみ。
- owner / admin / memberが実ユーザー単位で判定される。
- local mode以外で `x-open-business-os-role` が権限に影響しない。
- cookie sessionとCSRFのテストがある。

## 5. A2: Durable Queue / Async Playbook Run

目的:

同期HTTP実行をやめ、retryと再起動復旧に耐えるPlaybook Runへ移す。

対象:

- `apps/api/src/server.js`
- 新規 `apps/api/src/queue*.js`
- `apps/web/public/app.js`
- `packages/db/schema.sql`
- `tests/smoke.mjs`

作業:

- pending / running / completed / failed statusの永続化
- worker process分離
- retry policy
- stale running job recovery
- UI polling
- failed runの再実行API

受け入れ条件:

- 長いLLM request中にHTTP接続を保持しない。
- server restart後にpending jobを再開できる。
- runningのまま残ったjobをrecoverできる。
- 失敗jobを再実行できる。
- `ai_runs` と `cost_ledger` に失敗も残る。

## 6. A3: PostgreSQL CI Smoke / Migration / Backup

目的:

PostgreSQL runtimeを「動く」から「運用できる」へ進める。

対象:

- `packages/db/schema.sql`
- `apps/api/src/repositories/postgres.js`
- `docker-compose.yml`
- 新規 `scripts/*`
- `tests/smoke.mjs`
- CI設定

作業:

- CIでPostgreSQL serviceを起動する。
- `OPEN_BUSINESS_OS_STORE=postgres` のsmokeを追加する。
- JSON -> PostgreSQL migration scriptを作る。
- backup / restore commandを作る。
- schema drift checkを追加する。

受け入れ条件:

- CIでPostgreSQL smokeが通る。
- migrationを再実行しても重複・破壊が起きない。
- backupからrestoreしたDBでsmokeが通る。
- `OPEN_BUSINESS_OS_INIT_DB=0` の挙動が明確にテストされる。

## 7. A4: Playwright Mobile Visual Regression

目的:

実スマホviewportで、主要ループが見切れず操作できることを確認する。

対象:

- `apps/web/public/app.js`
- `apps/web/public/styles.css`
- 新規 `tests/e2e/*.mjs`

作業:

- Playwright導入
- iPhone相当viewport
- setup -> idea -> map -> approve -> memory -> GitHub draft -> export
- screenshot保存
- text overflow / overlap検査
- Memory Graph非空チェック

受け入れ条件:

- 320px幅で主要ボタンが見切れない。
- 下部navが主要操作を隠さない。
- Memory Graphが空白にならない。
- approve後にnodes / edgesが増える。
- exportにMemory Graphが含まれる。

## 8. A5: Provider Fallback

目的:

LLM provider障害、rate limit、JSON不正でユーザー作業が止まらないようにする。

対象:

- `packages/llm-gateway/src/*`
- `apps/api/src/server.js`
- `config/provider-registry.json`
- `config/llm-policy.json`
- `tests/unit.mjs`
- `tests/smoke.mjs`

作業:

- fallback順序をpolicy化する。
- provider errorを正規化する。
- rate limit時のfallbackを実装する。
- repair失敗時のhuman review待ち状態を明確化する。
- fallback時のcost ledgerを記録する。

受け入れ条件:

- invalid JSONがProject Stateに保存されない。
- repair失敗時にreviewable errorが残る。
- fallbackしたproviderと理由が `ai_runs` に残る。
- budget超過時はfallbackしても有料実行しない。

## 9. A6: pgvector-Assisted Memory Search

目的:

Memory Graphをsource of truthにしたまま、類似ノード候補の検索を速くする。

対象:

- `packages/db/schema.sql`
- `apps/api/src/repositories/postgres.js`
- `apps/api/src/server.js`
- `packages/llm-gateway/src/*`

作業:

- pgvector extensionを任意導入にする。
- embedding保存tableを追加する。
- similar_to候補を作る。
- query APIを追加する。
- edge確定はAI提案 + 人間承認にする。

受け入れ条件:

- pgvectorなしでもMemory Graphは動く。
- pgvectorありなら類似Assumption / Review / WorkItem候補を返せる。
- vector結果だけで `rejected_because` や `replaced_by` を確定しない。

## 10. A7: AI Eval Scenarios

目的:

Sample / Live LLM出力の品質を継続確認する。

対象:

- 新規 `packages/evals/scenarios`
- `packages/schemas/src/*`
- `packages/llm-gateway/src/*`
- `tests/*`

作業:

- idea intake fixture
- business map fixture
- initiative generation fixture
- implementation breakdown fixture
- schema validity評価
- traceability評価
- risk coverage評価
- cost mode adherence評価

受け入れ条件:

- Sample outputとLive outputの両方を評価できる。
- schema不一致を検出できる。
- WorkItemにWhy / Acceptance Criteriaがない場合に失敗する。
- Cost mode違反を検出できる。

## 11. A8: Slack / Webhook Connectors

目的:

GitHub以外の外部通知・連携をToolAction安全モデルの上に追加する。

対象:

- `apps/api/src/connectors/*`
- `apps/api/src/server.js`
- `packages/security/src/redaction.js`
- `tests/smoke.mjs`

作業:

- Slack message draft / approve / execute
- generic webhook draft / approve / execute
- secret redaction
- dry-run mode
- audit log

受け入れ条件:

- 承認前に外部送信されない。
- token未設定時はdry-runで完了する。
- 実送信時のpayloadからsecretがredactされる。
- ToolAction audit trailが残る。

## 12. 直近でやらないこと

今は避ける:

- CRM / BI dashboardを先に広げる。
- 完全自律開発プラットフォーム化する。
- Providerを大量追加する。
- 重いORM再設計に寄せる。
- Markdownだけを長期記憶の本体にする。
- vector検索だけで因果関係を扱う。
- UIを管理画面化してスマホの主要workflowを後回しにする。

理由:

このMVPの価値は、一文の事業アイデアから検証可能な施策、WorkItem、学習記録、次の判断へ進めることにある。周辺機能を増やす前に、認証、復旧、DB運用、スマホ検証、LLM失敗耐性を固める。

## 13. 次回セッション開始手順

最初に確認する:

```sh
npm run verify
```

サーバーを含める場合:

```sh
npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

次に着手するなら、A1から始める。

最初に読むファイル:

- `apps/api/src/auth.js`
- `apps/api/src/server.js`
- `packages/security/src/rbac.js`
- `tests/unit.mjs`
- `tests/smoke.mjs`
