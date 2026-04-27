# MVP Implementation Notes

作成日: 2026-04-28

## 目的

このMVPは、設計書の最小ループである「一文入力から、事業マップ、主要仮説、2週間施策、実装WorkItem、レビュー、Markdownエクスポートまで」を動かすことに集中する。CRM、BI、完全自律開発、外部ツールの即時実行は対象外に置く。

## 実装範囲

- Workspace作成と最小RBAC
- Workspace単位のLLM APIキー登録
- APIキーのサーバー側暗号化保存とkey hint返却
- Project作成と一文入力
- `idea_intake` などのPlaybook Run
- Business Map取得
- Initiative作成
- WorkItem作成
- Review作成
- Markdownエクスポート
- Cost Summary取得
- Playbook output承認適用
- Memory Graph / Project Memory Summary
- WorkItemからGitHub Issue draft作成
- 承認済みToolActionからGitHub Issue dry-run / token実作成
- PostgreSQL runtime Store
- Browserless mobile E2E
- token/local auth、workspace membership enforcement
- Unit test対象のSecurity、Schema、LLM cost、RBAC helper、API auth境界

## 設計書との対応

| 設計書 | MVPで確認する内容 |
| --- | --- |
| 3. MVPスコープ | 一文入力、事業マップ、施策、WorkItem、Markdown export、コストメーター、APIキー暗号化保存 |
| 6. 主要ワークフロー | Project作成、Playbook Run、Business Map取得、Review Loopの入口 |
| 9. API設計 | `/api/v1/workspaces`、`/api/v1/projects`、`/api/v1/playbook-runs`、Business Primitive系、Cost Summary |
| 10. LLM Gateway | コスト推定、usage記録、Providerをアプリ本体から分離する前提 |
| 12. AI出力Schema | BusinessMapOutputとInitiativeGenerationOutputの検証 |
| 13. セキュリティ設計 | APIキー非返却、redaction、RBAC、ToolAction承認制の方針 |
| 14.3 Markdown Export | Business Map、施策、WorkItem、Review、Decision LogのMarkdown出力 |

## テスト契約

`tests/e2e-mobile.mjs` はブラウザやサーバーポートを起動せず、CIで軽く回せるmobile E2E契約を検証する。

1. `index.html` がmobile viewport、theme color、manifest、app root、deferred JSを持つ
2. `manifest.webmanifest` がstandalone / portrait / 192px・512px iconを持つ
3. `service-worker.js` がapp shellをprecacheし、API requestをnetworkへ通し、navigation fallbackを持つ
4. `styles.css` が320px最小幅、44px tap target、safe-area対応、fixed bottom navを持つ
5. `app.js` が主要mobile workflow view、API endpoint、APIキー非永続化、Service Worker登録を持つ
6. `handleApi` 直呼びでWorkspace -> API key -> Project -> Playbook Run -> approval -> Memory -> Initiative -> WorkItem -> ToolAction -> Review -> Markdown export -> Cost Summaryまで到達できる
7. high_quality PlaybookとToolAction executeが承認なしで拒否される
8. APIレスポンスとMarkdown exportにraw API key / `encrypted_key` が出ない

`tests/smoke.mjs` は起動済みAPIに対し、以下を直列に検証する。

1. Workspaceを作成できる
2. DeepSeek APIキーを保存でき、レスポンスとMarkdownに生キーが返らない
3. Projectを作成できる
4. Playbook Runが完了し、構造化outputを返す
5. Business Mapを取得できる
6. high_quality実行が明示承認なしで拒否される
7. Playbook outputを承認してProject Stateへ適用できる
8. Memory Graph / Summaryを取得できる
9. InitiativeとWorkItemを作成でき、WorkItemがInitiativeに紐づく
10. WorkItemからGitHub Issue draftを作成できる
11. Reviewを作成できる
12. Markdown exportに主要セクションとMemory Graphが含まれる
13. Cost Summaryに非負の推定コストが含まれる

`tests/unit.mjs` は実装済み helper を前提に、暗号化復号、redaction、schema validation、cost estimator、RBAC、token auth modeの `/me` とowner/member/viewer/unauthenticated境界を検証する。未実装の場合はskipせず、どのmodule/exportが不足しているか分かる形で失敗する。

ローカルでサーバー起動なしに回すCI寄りの確認:

```sh
npm run verify
```

サーバーを含めたfull smoke:

```sh
npm run dev
BASE_URL=http://localhost:3000 npm run test:smoke
```

Playwrightはまだ導入しない。ブラウザdownloadがCI/ローカルの足止めにならない段階で、iPhone viewportの実レンダリング、スクリーンショット、テキストoverflow/overlap検査を追加する。

## セキュリティ注意点

- APIキーはフロントエンド、APIレスポンス、Markdown export、ログ、traceに出さない。
- 保存時はAES-256-GCM相当の認証付き暗号を使い、復号はLLM Gateway実行時に限定する。
- `key_hint` は末尾4文字など、識別に必要な最小情報だけにする。
- Redaction helperはAPIキー、Bearer token、Authorization header、ネストしたログpayloadを対象にする。
- RBACはUIではなくAPI側で強制する。OwnerのみAPIキー作成、Viewerは閲覧のみ、External Advisorは監査ログや機密設定にアクセス不可とする。
- AI出力はStructured Outputとしてschema validationを通してから保存する。
- 外部ツールへの書き込みはToolAction承認後のみ実行する。GitHub tokenがない場合はdry-runで完了する。

## 未実装/次フェーズ

- OIDC / secure cookie session、招待、チーム管理
- Durable async queue
- Provider fallback
- Webhook / Slack connector
- Playbook Registry、Provider Registry、Connector Registry
- Playwright mobile visual regressionとAI eval scenario

## レビュー観点

- 生のAPIキーが一切返らないか
- AI出力がschemaを通らず保存される経路がないか
- WorkItemからInitiative、Assumption、Metricへ理由を辿れるか
- コスト推定とCost Summaryが0固定や未記録になっていないか
- RBACがUI依存ではなくAPIで強制されているか
- Markdown exportが共有可能で、機密値を含まないか
