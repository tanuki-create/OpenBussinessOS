# Open Business OS Sample Export

## Business Map

### Concept

- Title: AI Drawing Takeoff Assistant
- One-liner: 建築図面から窓やドアを検出し、見積作業の初回確認を短縮するAI支援ツール
- Business type: B2B SaaS
- Description: 図面PDFをアップロードすると、窓、ドア、壁などの候補を抽出し、人間が確認できる形で数量と根拠を提示する。

### Target Users

| User | Pain | Current alternative |
| --- | --- | --- |
| 小規模施工会社の見積担当 | 図面確認と数量拾いに時間がかかる | 手作業、Excel、外注 |
| 建材販売会社の営業担当 | 初回提案のスピードが遅い | CAD担当への依頼、概算見積 |

### Ideal State

2週間以内に、ユーザーがPDFをアップロードし、10分以内に確認可能な数量候補を得られる。AIは完全自動化ではなく、見落としや誤検出を人間が確認できるPoC支援として位置付ける。

### North Star Metric

- Name: Reviewed takeoff candidates
- Definition: ユーザーが確認完了した検出候補数
- Why it matters: AI出力の量ではなく、見積判断に使える状態まで進んだ数を測るため
- Caveats: 候補数だけでは見積精度や受注貢献を保証しない

## Assumptions

| Status | Risk | Statement | Validation |
| --- | --- | --- | --- |
| unverified | high | 初回PoCでは完全自動化より候補提示の方が受け入れられる | 3社に候補提示UIを見せ、手作業との差分を聞く |
| unverified | medium | 10分以内に初回価値を見せれば継続利用の意欲が上がる | PDFアップロードから候補確認までの時間を計測する |
| needs_more_evidence | high | 80%精度でも確認UIがあれば実務で試せる | 誤検出時の修正フローを含めたユーザーテストを行う |

## Risks

| Severity | Risk | Mitigation |
| --- | --- | --- |
| high | AI検出結果が根拠なしに見える | 検出箇所のハイライトとconfidenceを表示する |
| critical | APIキーや図面データがログに残る | redaction、暗号化保存、最小ログ化を徹底する |

## 2-Week Initiatives

### Initiative: Validate first-value workflow

- Hypothesis: 図面アップロードから10分以内に候補一覧を見られれば、見積担当はPoC価値を感じる。
- Metric: Reviewed takeoff candidates
- Success criteria: 3人中2人が、手作業より初回確認が速いと判断する。
- Due: 2026-05-12
- Estimated AI cost: 0.25 USD

## Work Items

### WorkItem: PDF upload and processing start

Why: PoCで初回価値を10分以内に見せるため、ユーザーがPDFをアップロードし、処理開始できる導線を作る。

Acceptance criteria:

- PDFをアップロードできる
- 処理開始ボタンが表示される
- 失敗時にユーザー向けエラーが表示される
- APIキーや図面本文がクライアントログに出ない

### WorkItem: Candidate review list

Why: AIの検出結果をそのまま確定せず、人間が根拠を確認できる状態にするため。

Acceptance criteria:

- 検出候補の種別、ページ、confidenceを一覧できる
- 図面上の該当箇所へ移動できる
- 候補を承認、修正、除外できる

## Review Summary

- Period: 2026-04-28 to 2026-05-12
- Done: PDFアップロード導線と候補確認UIのプロトタイプを作成
- Evidence: 2人の見積担当が、候補提示だけでも初回確認の短縮価値があると回答
- Supported assumptions: 候補提示型PoCは初期提案として受け入れられる可能性がある
- Rejected assumptions: 80%精度だけで十分という仮説は未検証
- Next actions: 誤検出修正フローとコスト測定を追加する

## Decision Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-04-28 | MVPでは完全自動見積を約束しない | 精度リスクが高く、候補提示と確認UIの方が安全に価値検証できる |
| 2026-04-28 | Markdown exportを優先する | 外部連携なしでも計画を共有し、レビューできるため |

## Cost Summary

- Provider: deepseek_direct
- Default model: deepseek-v4-flash
- Month-to-date estimated cost: 0.04 USD
- Monthly limit: 5.00 USD
