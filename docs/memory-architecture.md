# Open Business OS Memory Architecture

作成日: 2026-04-28

## 1. 結論

Open Business OSの長期記憶は、Markdownや単純なベクトル検索をsource of truthにしない。

採用する方針:

```txt
Rules: Markdown
Source of truth: PostgreSQL
Relations: memory_edges
Search: pgvector later
LLM Context: graph traversal + summary
Export: Markdown
```

Markdownは共有・レビュー・エクスポート用の成果物として扱う。変化する状態、意思決定、仮説、証拠、却下理由、置換関係はDB内のノードとエッジで管理する。

## 2. なぜMarkdownを記憶本体にしないか

Markdownを記憶本体にすると、以下が破綻しやすい。

- 同じ事実の重複除去が難しい
- 古い情報の減衰がない
- 重要度や信頼度でランキングできない
- 矛盾解決が書き込み時にできない
- 100件以上の履歴でコンテキスト投入が重くなる
- 「なぜ却下されたか」「何に置き換わったか」の関係が消える

Open Business OSで本当に必要なのは、単に「何が書かれていたか」ではなく、「なぜそう判断されたか」「何が根拠だったか」「その後どう置き換わったか」を辿れること。

## 3. 記憶の階層

### 3.1 Fixed Rules

固定ルールはMarkdownでよい。

例:

- プロダクト原則
- セキュリティ方針
- ToolActionは承認必須
- Cheap by default
- Evidence over Confidence
- ProviderやConnectorの設計原則

保存先:

- `open_business_os_detailed_design.md`
- `docs/implementation-details.md`
- 将来の `docs/agent-rules.md`

### 3.2 Evolving State

変化する状態はPostgreSQLに保存する。

例:

- Vision
- Metric
- Assumption
- Evidence
- Decision
- Initiative
- WorkItem
- Review
- Risk
- Constraint
- Lesson
- Preference

### 3.3 Derived Context

LLMに渡す文脈はDBから生成した派生物にする。

例:

- Project Memory Summary
- Recent Activity Summary
- Decision Chain
- Assumption Evidence Chain
- Risk Mitigation Chain

これらはcacheしてよいが、source of truthにはしない。

## 4. Memory Graph

中心は2つのテーブル。

```txt
memory_nodes
memory_edges
```

### 4.1 memory_nodes

ノードは記憶の単位である。

代表的な `node_type`:

```txt
vision
metric
assumption
evidence
decision
initiative
work_item
review
risk
constraint
preference
lesson
tool_action
ai_run
```

代表的な状態:

```txt
draft
active
approved
supported
rejected
superseded
archived
```

重要な属性:

- `importance`: 重要度
- `confidence`: 信頼度
- `valid_from`: 有効開始
- `valid_until`: 有効終了
- `last_accessed_at`: 最近使われた時刻
- `metadata`: 型別の追加情報

### 4.2 memory_edges

エッジはノード間の意味関係である。

代表的な `relation_type`:

```txt
supports
supported_by
contradicts
caused_by
derived_from
replaced_by
blocks
implements
implemented_by
validated_by
rejected_because
depends_on
measured_by
similar_to
mentions
updates
```

例:

```txt
Assumption A
  -> supported_by -> Evidence B
  -> implemented_by -> Initiative C
  -> rejected_because -> Review D
  -> replaced_by -> Assumption E
```

## 5. 基本クエリ

### 5.1 「3週間前に否決した案は何で、なぜ？」

見るべきもの:

- `memory_nodes.node_type in ('assumption','initiative','decision')`
- `status in ('rejected','superseded')`
- `created_at` または `updated_at` が対象期間
- `memory_edges.relation_type in ('rejected_because','contradicts','replaced_by')`

返すべき文脈:

1. 否決されたノード
2. 否決理由につながるEvidence / Review / Decision
3. 置き換え先がある場合は置き換え後の案
4. 現在も有効な教訓

### 5.2 「このWorkItemはなぜ必要？」

見るべきもの:

```txt
work_item
  <- implements / derived_from
initiative
  <- validates / derived_from
assumption
  <- measured_by
metric
```

返すべき文脈:

- WorkItem
- 紐づくInitiative
- 検証対象のAssumption
- 動かしたいMetric
- 根拠Evidence

### 5.3 「前回同じ問題をどう解いた？」

見るべきもの:

- `node_type in ('lesson','review','decision','work_item')`
- `similar_to` edge
- 将来はembedding similarityも補助に使う

返すべき文脈:

- 類似した過去の問題
- 解決したWorkItem
- その結果Review
- 今回に適用できるLesson

## 6. 書き込み時の方針

Memory Graphは読み出しだけでなく、書き込み時の整理が重要。

書き込み時にやること:

1. 既存ノードとの重複候補を探す
2. 矛盾候補を探す
3. 置換関係があるか確認する
4. 重要度と信頼度を初期設定する
5. 関係エッジを張る
6. 古いノードを必要に応じて `superseded` にする

MVP次段階では完全自動ではなく、AI提案と人間承認で進める。

## 7. 減衰とランキング

LLMに渡す記憶は、すべて同じ重みで扱わない。

ランキング要素:

- 明示的な重要度
- 信頼度
- 新しさ
- 最近アクセスされたか
- 現在のProject Stateに近いか
- エッジの強さ
- 承認済みか
- Evidenceに支えられているか

古い情報は削除せず、検索順位を下げる。意思決定や却下理由は長期的に価値があるため、単純な日付だけで消さない。

## 8. pgvectorの位置づけ

pgvectorは後で追加する。

役割:

- 類似ノード検索
- 類似過去レビュー検索
- 類似WorkItem検索
- ユーザー入力から関連ノード候補を探す

ただし、pgvectorは関係性のsource of truthではない。因果関係、却下理由、置換関係、依存関係は `memory_edges` で表現する。

## 9. 実装順

推奨順:

1. PostgreSQL schemaに `memory_nodes` / `memory_edges` を追加
2. Project State正規化時にmemory nodeを書き込む
3. Assumption / Evidence / Decision / Initiative / WorkItem間にedgeを張る
4. Review完了時にstatus更新提案とedge更新を作る
5. `project_memory_summaries` をgraph traversalから生成する
6. 必要になった時点でpgvectorを追加する

## 10. API案

初期API:

```txt
GET  /api/v1/projects/:projectId/memory/nodes
POST /api/v1/projects/:projectId/memory/nodes
GET  /api/v1/projects/:projectId/memory/graph
POST /api/v1/projects/:projectId/memory/edges
GET  /api/v1/projects/:projectId/memory/summary
POST /api/v1/projects/:projectId/memory/refresh-summary
```

将来:

```txt
POST /api/v1/projects/:projectId/memory/query
POST /api/v1/projects/:projectId/memory/resolve-conflict
POST /api/v1/projects/:projectId/memory/approve-edge
```

## 11. 受け入れテスト

最低限のテスト:

1. 否決されたAssumptionに `rejected_because` edgeが張られる
2. WorkItemからInitiative、Assumption、Metricを辿れる
3. ReviewからEvidenceと次Actionを辿れる
4. SupersededされたDecisionが最新Decisionへ `replaced_by` でつながる
5. Markdown exportはgraphから生成された関係を含む
6. LLM contextは全履歴ではなく、graph traversal結果だけを含む
