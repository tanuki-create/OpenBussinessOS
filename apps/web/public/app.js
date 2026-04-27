(function () {
  "use strict";

  const API_BASE = "/api/v1";
  const STORE_KEY = "open-business-os-mvp";
  const API_TIMEOUT_MS = 2600;

  const views = ["idea", "intake", "map", "work", "review", "memory", "export", "settings"];
  const navItems = [
    ["idea", "+", "入力"],
    ["intake", "?", "質問"],
    ["map", "#", "Map"],
    ["work", ">", "施策"],
    ["review", "*", "Review"],
    ["memory", "@", "Memory"],
    ["export", "md", "Export"],
    ["settings", "=", "設定"],
  ];

  const exampleIdeas = [
    "建築図面から窓やドアを検出して見積作業を効率化するAI",
    "飲食店向けにSNS投稿を自動生成するツール",
    "社内問い合わせを自動化するAIエージェント",
  ];

  const defaultQuestions = [
    {
      id: "first_user",
      question: "最初に使う人は誰ですか？",
      reason: "対象ユーザーが曖昧だと、指標・UX・営業施策が決められないためです。",
      inputType: "short_text",
      options: [],
    },
    {
      id: "pain_now",
      question: "今いちばん高い痛みは何ですか？",
      reason: "最初の検証を価値が出やすい一点に絞るためです。",
      inputType: "short_text",
      options: [],
    },
    {
      id: "proof",
      question: "2週間で確認できる証拠は何ですか？",
      reason: "施策を作業ではなく検証にするためです。",
      inputType: "single_select",
      options: ["インタビュー", "利用ログ", "PoC結果", "商談メモ"],
    },
  ];

  const app = document.getElementById("app");
  let state = loadState();
  let volatileApiKey = "";

  function defaultState() {
    return {
      initialized: false,
      activeView: "idea",
      sampleMode: false,
      syncing: false,
      editing: null,
      toast: "",
      workspace: {
        id: "local-workspace",
        name: "",
        usageType: "individual",
        budgetMode: "cheap",
        monthlyBudgetUsd: 5,
      },
      provider: {
        mode: "later",
        status: "not_configured",
        model: "deepseek-v4-flash",
        label: "未設定",
      },
      project: {
        id: "local-project",
        title: "",
        idea: "",
        businessType: "",
        status: "draft",
      },
      questions: defaultQuestions,
      answers: {},
      cards: [],
      initiatives: [],
      workItems: [],
      reviews: [],
      costs: {
        currentRunUsd: 0.008,
        monthUsedUsd: 0,
        remainingUsd: 5,
        budgetExceeded: false,
        cacheRate: 0.18,
      },
      memoryGraph: { nodes: [], edges: [] },
      memorySummary: null,
      lastPlaybookRun: null,
      playbookRuns: [],
      toolActions: [],
      exportMarkdown: "",
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY));
      return mergeState(defaultState(), parsed || {});
    } catch (_error) {
      return defaultState();
    }
  }

  function mergeState(base, saved) {
    return {
      ...base,
      ...saved,
      workspace: { ...base.workspace, ...(saved.workspace || {}) },
      provider: { ...base.provider, ...(saved.provider || {}) },
      project: { ...base.project, ...(saved.project || {}) },
      costs: { ...base.costs, ...(saved.costs || {}) },
      questions: saved.questions || base.questions,
      answers: saved.answers || base.answers,
      cards: saved.cards || base.cards,
      initiatives: saved.initiatives || base.initiatives,
      workItems: saved.workItems || base.workItems,
      reviews: saved.reviews || base.reviews,
      memoryGraph: saved.memoryGraph || base.memoryGraph,
      memorySummary: saved.memorySummary || base.memorySummary,
      lastPlaybookRun: saved.lastPlaybookRun || base.lastPlaybookRun,
      playbookRuns: saved.playbookRuns || base.playbookRuns,
      toolActions: saved.toolActions || base.toolActions,
    };
  }

  function saveState() {
    const safeState = {
      ...state,
      provider: { ...state.provider },
      syncing: false,
      editing: null,
      toast: "",
    };
    delete safeState.apiKey;
    delete safeState.api_key;
    delete safeState.provider.apiKey;
    delete safeState.provider.api_key;
    delete safeState.provider.secret;
    delete safeState.provider.token;
    localStorage.setItem(STORE_KEY, JSON.stringify(safeState));
  }

  function uid(prefix) {
    if (window.crypto && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function html(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function money(value) {
    return `$${Number(value || 0).toFixed(3)}`;
  }

  function truncate(value, length) {
    const text = String(value || "");
    if (text.length <= length) return text;
    return `${text.slice(0, length - 1)}…`;
  }

  async function apiRequest(path, options) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const init = {
      method: "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      ...options,
    };

    try {
      const response = await fetch(`${API_BASE}${path}`, init);
      const text = await response.text();
      const payload = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error(payload?.error?.message || `API ${response.status}`);
        error.code = payload?.error?.code || `HTTP_${response.status}`;
        error.details = payload?.error?.details || {};
        throw error;
      }
      state.sampleMode = false;
      return payload;
    } catch (error) {
      state.sampleMode = true;
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function syncWithFallback(path, options, fallback) {
    state.syncing = true;
    render();
    try {
      const payload = await apiRequest(path, options);
      return typeof fallback === "function" ? fallback(payload, true) : payload;
    } catch (error) {
      if (error.code === "BUDGET_EXCEEDED") {
        setToast("月間予算を超えています。設定で上限を上げるか、予算モードを下げてください。");
      } else if (error.code === "TOOL_ACTION_REQUIRES_APPROVAL") {
        setToast("高品質実行には明示承認が必要です。");
      }
      return typeof fallback === "function" ? fallback(null, false, error) : null;
    } finally {
      state.syncing = false;
      saveState();
      render();
    }
  }

  function unwrapApi(payload, keys) {
    if (!payload || typeof payload !== "object") return payload;
    for (const key of keys) {
      if (payload[key] !== undefined) return payload[key];
    }
    if (payload.playbookRun?.output) return payload.playbookRun.output;
    if (payload.run?.output) return payload.run.output;
    if (payload.data && typeof payload.data === "object") return unwrapApi(payload.data, keys);
    return payload;
  }

  function setToast(message) {
    state.toast = message;
    render();
    window.clearTimeout(setToast.timer);
    setToast.timer = window.setTimeout(() => {
      state.toast = "";
      render();
    }, 2600);
  }

  function currentProgress() {
    const limit = Number(state.workspace.monthlyBudgetUsd || 0);
    if (!limit) return 0;
    return Math.min(100, Math.round((state.costs.monthUsedUsd / limit) * 100));
  }

  function addCost(amount) {
    const value = Number(amount ?? state.costs.currentRunUsd ?? 0);
    state.costs.monthUsedUsd = Number((Number(state.costs.monthUsedUsd || 0) + value).toFixed(4));
    const limit = Number(state.workspace.monthlyBudgetUsd || 0);
    state.costs.remainingUsd = limit ? Math.max(0, Number((limit - state.costs.monthUsedUsd).toFixed(4))) : null;
    state.costs.budgetExceeded = Boolean(limit && state.costs.monthUsedUsd > limit);
  }

  function applyCostSummary(summary) {
    if (!summary) return;
    state.costs.monthUsedUsd = Number(summary.estimatedCostUsd ?? summary.estimated_cost_usd ?? state.costs.monthUsedUsd ?? 0);
    state.costs.remainingUsd = summary.remainingUsd ?? summary.remaining_usd ?? state.costs.remainingUsd;
    state.costs.budgetExceeded = Boolean(summary.budgetExceeded ?? summary.budget_exceeded ?? state.costs.budgetExceeded);
    if (summary.monthlyBudgetUsd ?? summary.monthly_budget_usd) {
      state.workspace.monthlyBudgetUsd = Number(summary.monthlyBudgetUsd ?? summary.monthly_budget_usd);
    }
  }

  async function refreshCostSummary({ silent = false } = {}) {
    if (!state.workspace.id) return;
    try {
      const payload = await apiRequest(`/workspaces/${encodeURIComponent(state.workspace.id)}/costs/summary`);
      applyCostSummary(unwrapApi(payload, ["costSummary", "summary"]));
      saveState();
      if (!silent) setToast("予算サマリーを更新しました。");
    } catch (_error) {
      if (!silent) setToast("予算サマリーはローカル推定で表示しています。");
    } finally {
      if (!silent) render();
    }
  }

  function estimateCost(kind) {
    const mode = state.workspace.budgetMode;
    const base = {
      intake: 0.006,
      map: 0.022,
      initiative: 0.018,
      review: 0.014,
      deepen: 0.004,
    }[kind] || 0.008;
    const multiplier = mode === "ultra_cheap" ? 0.45 : mode === "balanced" ? 1.8 : mode === "high_quality" ? 5.2 : 1;
    state.costs.currentRunUsd = Number((base * multiplier).toFixed(4));
    return state.costs.currentRunUsd;
  }

  function highCostConfirm(kind) {
    const cost = estimateCost(kind);
    const limit = Number(state.workspace.monthlyBudgetUsd || 0);
    const projected = state.costs.monthUsedUsd + cost;
    if (state.workspace.budgetMode === "high_quality" || (limit && projected / limit > 0.82)) {
      return window.confirm(`今回の予想コストは${money(cost)}です。実行しますか？`);
    }
    return true;
  }

  function render() {
    if (!state.initialized) {
      app.innerHTML = renderSetup();
      return;
    }

    app.innerHTML = `
      <div class="app-frame">
        ${renderTopbar()}
        ${renderView()}
      </div>
      ${renderCostMeter()}
      ${renderBottomNav()}
      ${state.toast ? `<div class="toast" role="status">${html(state.toast)}</div>` : ""}
    `;
  }

  function renderTopbar() {
    const workspaceName = state.workspace.name || "Open Business OS";
    return `
      <header class="topbar">
        <div class="brand">
          <p class="brand-kicker">${html(state.project.title || "MVP Workspace")}</p>
          <h1 class="brand-title">${html(workspaceName)}</h1>
        </div>
        <div class="status-stack">
          ${state.syncing ? `<span class="badge info">同期中</span>` : ""}
          <span class="badge ${state.sampleMode ? "warn" : "ok"}">${state.sampleMode ? "Sample" : "API"}</span>
        </div>
      </header>
    `;
  }

  function renderView() {
    if (!views.includes(state.activeView)) state.activeView = "idea";
    return {
      idea: renderIdeaView,
      intake: renderIntakeView,
      map: renderMapView,
      work: renderWorkView,
      review: renderReviewView,
      memory: renderMemoryView,
      export: renderExportView,
      settings: renderSettingsView,
    }[state.activeView]();
  }

  function renderSetup() {
    return `
      <main class="app-frame">
        <section class="view" aria-labelledby="setup-title">
          <div class="view-header">
            <h1 id="setup-title">Open Business OS</h1>
            <p>一文から始めて、AIと一緒に事業計画・施策・実装タスクまで作ります。</p>
          </div>
          <form class="setup-panel" data-form="setup">
            <div class="form-grid">
              <label class="field">
                <span>ワークスペース名</span>
                <input name="workspaceName" autocomplete="organization" required placeholder="例: 図面AI Lab" />
              </label>
              <fieldset class="field">
                <legend>使い方</legend>
                <div class="segmented">
                  ${radio("usageType", "individual", "個人", true)}
                  ${radio("usageType", "team", "チーム")}
                  ${radio("usageType", "oss", "OSS")}
                  ${radio("usageType", "internal", "社内新規")}
                </div>
              </fieldset>
              <fieldset class="field">
                <legend>AI API設定</legend>
                <div class="segmented">
                  ${radio("providerMode", "deepseek", "DeepSeek", false)}
                  ${radio("providerMode", "later", "あとで", true)}
                  ${radio("providerMode", "env", "ENV", false)}
                  ${radio("providerMode", "local", "Local", false)}
                </div>
              </fieldset>
              <div class="form-grid two">
                <label class="field">
                  <span>月間上限 USD</span>
                  <input name="monthlyBudgetUsd" inputmode="decimal" type="number" min="1" step="0.5" value="5" required />
                </label>
                <label class="field">
                  <span>予算モード</span>
                  <select name="budgetMode">
                    <option value="ultra_cheap">節約</option>
                    <option value="cheap" selected>標準</option>
                    <option value="balanced">バランス</option>
                    <option value="high_quality">高品質レビュー</option>
                  </select>
                </label>
              </div>
              <div class="actions">
                <button class="button" type="submit">開始</button>
                <button class="button secondary" type="button" data-action="sample-start">サンプル</button>
              </div>
            </div>
          </form>
        </section>
      </main>
    `;
  }

  function radio(name, value, label, checked) {
    return `
      <label>
        <input type="radio" name="${html(name)}" value="${html(value)}" ${checked ? "checked" : ""} />
        ${html(label)}
      </label>
    `;
  }

  function renderIdeaView() {
    return `
      <main class="view" aria-labelledby="idea-title">
        <div class="view-header">
          <h2 id="idea-title">事業アイデア入力</h2>
          <p>一文で開始。生成結果はカードで編集できます。</p>
        </div>
        <section class="form-panel">
          <label class="field">
            <span>何を作りたいですか？</span>
            <textarea id="idea-input" placeholder="何を作りたいですか？">${html(state.project.idea)}</textarea>
          </label>
          <div class="examples" aria-label="入力例">
            ${exampleIdeas
              .map(
                (idea) => `
                  <button class="example-card" type="button" data-action="use-example" data-idea="${html(idea)}">
                    ${html(idea)}
                  </button>
                `,
              )
              .join("")}
          </div>
          <div class="actions">
            <button class="button" type="button" data-action="classify-idea">分類する</button>
            <button class="button secondary" type="button" data-action="generate-map">Map生成</button>
          </div>
        </section>
        ${state.cards.length ? `<section class="grid" aria-label="直近カード">${renderStats()}${renderCardGrid(state.cards.slice(0, 4))}</section>` : ""}
      </main>
    `;
  }

  function renderIntakeView() {
    const unanswered = state.questions.filter((question) => !state.answers[question.id]).slice(0, 3);
    const answered = state.questions.filter((question) => state.answers[question.id]);
    return `
      <main class="view" aria-labelledby="intake-title">
        <div class="view-header">
          <h2 id="intake-title">段階質問</h2>
          <p>最大3問ずつ回答します。</p>
        </div>
        <section class="grid">
          ${
            unanswered.length
              ? unanswered.map(renderQuestionCard).join("")
              : `<div class="empty-state"><p>回答済みです。事業マップを生成できます。</p></div>`
          }
          <div class="actions">
            <button class="button" type="button" data-action="save-answers">回答を保存</button>
            <button class="button secondary" type="button" data-action="generate-map">Map生成</button>
          </div>
          ${
            answered.length
              ? `<ul class="answer-list">${answered
                  .map((question) => `<li><strong>${html(question.question)}</strong><br />${html(state.answers[question.id])}</li>`)
                  .join("")}</ul>`
              : ""
          }
        </section>
      </main>
    `;
  }

  function renderQuestionCard(question) {
    const value = state.answers[question.id] || "";
    const input =
      question.inputType === "single_select"
        ? `<select data-question-input="${html(question.id)}">
            <option value="">選択</option>
            ${(question.options || []).map((option) => `<option value="${html(option)}">${html(option)}</option>`).join("")}
          </select>`
        : `<input data-question-input="${html(question.id)}" value="${html(value)}" placeholder="短く入力" />`;
    return `
      <article class="question-card">
        <h3>${html(question.question)}</h3>
        <p>${html(question.reason)}</p>
        <div class="question-tools">
          ${input}
          <button class="icon-button" type="button" title="音声入力" aria-label="音声入力" data-action="voice-note" data-question-id="${html(question.id)}">mic</button>
        </div>
      </article>
    `;
  }

  function renderMapView() {
    return `
      <main class="view" aria-labelledby="map-title">
        <div class="view-header">
          <h2 id="map-title">事業マップ</h2>
          <p>カード単位で承認・修正・深掘りします。</p>
        </div>
        ${renderStats()}
        <section class="map-layout">
          <div class="grid">
            ${state.cards.length ? renderCardGrid(state.cards) : renderEmptyMap()}
          </div>
          <aside class="grid" aria-label="操作">
            <div class="form-panel">
              <div class="actions">
                <button class="button" type="button" data-action="generate-map">Map再生成</button>
                <button class="button secondary" type="button" data-nav="work">施策へ</button>
              </div>
            </div>
            ${renderTracePanel()}
          </aside>
        </section>
      </main>
    `;
  }

  function renderWorkView() {
    return `
      <main class="view" aria-labelledby="work-title">
        <div class="view-header">
          <h2 id="work-title">仮説 / 施策 / WorkItem</h2>
          <p>2週間で検証できる粒度にします。</p>
        </div>
        <section class="work-layout">
          <div class="grid">
            <div class="actions">
              <button class="button" type="button" data-action="generate-initiatives">施策生成</button>
              <button class="button secondary" type="button" data-action="add-work-item">WorkItem追加</button>
            </div>
            ${
              state.initiatives.length
                ? state.initiatives.map(renderInitiativeCard).join("")
                : `<div class="empty-state"><p>事業マップから施策を生成してください。</p></div>`
            }
          </div>
          <div class="grid">
            ${
              state.workItems.length
                ? state.workItems.map(renderWorkItemCard).join("")
                : `<div class="empty-state"><p>施策に紐づく実装タスクがここに出ます。</p></div>`
            }
          </div>
        </section>
      </main>
    `;
  }

  function renderReviewView() {
    return `
      <main class="view" aria-labelledby="review-title">
        <div class="view-header">
          <h2 id="review-title">レビュー</h2>
          <p>実行結果から仮説と次の施策を更新します。</p>
        </div>
        <section class="review-layout">
          <form class="review-composer" data-form="review">
            <label class="field">
              <span>実行したこと</span>
              <textarea name="done" required placeholder="例: 3社にPoC画面を見せた"></textarea>
            </label>
            <label class="field">
              <span>得られた証拠</span>
              <textarea name="evidence" required placeholder="例: 見積時間の削減見込み、離脱点"></textarea>
            </label>
            <label class="field">
              <span>動いた指標</span>
              <input name="metric" placeholder="例: 初回価値到達 12分" />
            </label>
            <div class="actions">
              <button class="button" type="submit">整理</button>
            </div>
          </form>
          <div class="grid">
            ${
              state.reviews.length
                ? state.reviews.map(renderReviewCard).join("")
                : `<div class="empty-state"><p>レビュー結果がここに残ります。</p></div>`
            }
          </div>
        </section>
      </main>
    `;
  }

  function renderMemoryView() {
    const graph = activeMemoryGraph();
    const nodes = graph.nodes.slice().sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0));
    const edges = graph.edges.slice(0, 18);
    const latestRun = state.lastPlaybookRun;
    const latestPlaybookId = latestRun?.playbookId || latestRun?.playbook_id;
    const applyable = ["business_map_generation", "initiative_generation", "implementation_breakdown"].includes(latestPlaybookId);
    const canApprove = applyable && latestRun?.id && ["completed", "user_reviewing", "approved"].includes(latestRun.status || "completed");
    return `
      <main class="view" aria-labelledby="memory-title">
        <div class="view-header">
          <h2 id="memory-title">Memory Graph</h2>
          <p>仮説、指標、施策、WorkItem、レビューをProject Memoryとして辿ります。</p>
        </div>
        <section class="memory-layout">
          <div class="grid">
            <div class="form-panel">
              <div class="card-head">
                <div class="card-title-group">
                  <p class="card-type">approval</p>
                  <h3 class="card-title">Playbook output</h3>
                </div>
                <span class="badge ${latestRun?.status === "applied" ? "ok" : "warn"}">${html(latestRun?.status || "未生成")}</span>
              </div>
              <p class="card-body">${html(latestPlaybookId || "Business Map / Initiative生成後に承認できます。")}</p>
              <div class="actions">
                <button class="button" type="button" data-action="approve-playbook-output" ${canApprove ? "" : "disabled"}>承認して適用</button>
                <button class="button secondary" type="button" data-action="refresh-memory">Memory更新</button>
              </div>
            </div>
            <div class="form-panel">
              <div class="card-head">
                <div class="card-title-group">
                  <p class="card-type">summary</p>
                  <h3 class="card-title">Project Memory Summary</h3>
                </div>
                <span class="badge info">${html(state.memorySummary?.token_estimate || state.memorySummary?.tokenEstimate || 0)} tokens</span>
              </div>
              <textarea class="memory-summary" readonly>${html(state.memorySummary?.body || "Memory更新後に要約が表示されます。")}</textarea>
              <div class="actions">
                <button class="button secondary" type="button" data-action="copy-memory-summary">Copy</button>
              </div>
            </div>
          </div>
          <div class="grid">
            <div class="stat-row">
              <div class="stat-card"><strong>${nodes.length}</strong><span>nodes</span></div>
              <div class="stat-card"><strong>${graph.edges.length}</strong><span>edges</span></div>
            </div>
            <section class="memory-list" aria-label="Memory nodes">
              ${nodes.length ? nodes.slice(0, 12).map(renderMemoryNode).join("") : `<div class="empty-state"><p>まだMemory nodeがありません。</p></div>`}
            </section>
            <section class="memory-list" aria-label="Memory edges">
              ${
                edges.length
                  ? edges.map((edge) => renderMemoryEdge(edge, graph.nodes)).join("")
                  : `<div class="empty-state"><p>WorkItemやレビューを作ると関係が表示されます。</p></div>`
              }
            </section>
          </div>
        </section>
      </main>
    `;
  }

  function renderMemoryNode(node) {
    return `
      <article class="memory-node">
        <div class="card-head">
          <div class="card-title-group">
            <p class="card-type">${html(node.node_type || node.nodeType || "node")}</p>
            <h3 class="card-title">${html(node.title)}</h3>
          </div>
          <span class="badge ${statusBadgeClass(node.status)}">${statusLabel(node.status)}</span>
        </div>
        ${node.body ? `<p class="card-body">${html(truncate(node.body, 140))}</p>` : ""}
      </article>
    `;
  }

  function renderMemoryEdge(edge, nodes) {
    const from = nodes.find((node) => node.id === edge.from_node_id || node.id === edge.fromNodeId);
    const to = nodes.find((node) => node.id === edge.to_node_id || node.id === edge.toNodeId);
    return `
      <article class="memory-edge">
        <span>${html(from?.title || edge.from_node_id || edge.fromNodeId)}</span>
        <strong>${html(edge.relation_type || edge.relationType)}</strong>
        <span>${html(to?.title || edge.to_node_id || edge.toNodeId)}</span>
      </article>
    `;
  }

  function renderExportView() {
    const markdown = state.exportMarkdown || buildMarkdown();
    return `
      <main class="view" aria-labelledby="export-title">
        <div class="view-header">
          <h2 id="export-title">Markdown export</h2>
          <p>カードとタスクをそのまま共有できます。</p>
        </div>
        <section class="export-panel">
          <div class="actions">
            <button class="button" type="button" data-action="refresh-export">再生成</button>
            <button class="button secondary" type="button" data-action="copy-export">Copy</button>
            <button class="button secondary" type="button" data-action="download-export">.md</button>
          </div>
          <textarea class="markdown-preview" id="markdown-preview" readonly>${html(markdown)}</textarea>
        </section>
      </main>
    `;
  }

  function renderSettingsView() {
    return `
      <main class="view" aria-labelledby="settings-title">
        <div class="view-header">
          <h2 id="settings-title">ワークスペース / AI / 予算</h2>
          <p>APIキーはブラウザに保存しません。</p>
        </div>
        <section class="settings-layout">
          <form class="settings-panel" data-form="workspace">
            <label class="field">
              <span>ワークスペース名</span>
              <input name="workspaceName" value="${html(state.workspace.name)}" />
            </label>
            <label class="field">
              <span>月間上限 USD</span>
              <input name="monthlyBudgetUsd" type="number" inputmode="decimal" min="1" step="0.5" value="${html(state.workspace.monthlyBudgetUsd)}" />
            </label>
            <label class="field">
              <span>予算モード</span>
              <select name="budgetMode">
                ${option("ultra_cheap", "節約", state.workspace.budgetMode)}
                ${option("cheap", "標準", state.workspace.budgetMode)}
                ${option("balanced", "バランス", state.workspace.budgetMode)}
                ${option("high_quality", "高品質レビュー", state.workspace.budgetMode)}
              </select>
            </label>
            <div class="actions">
              <button class="button" type="submit">保存</button>
            </div>
          </form>
          <form class="settings-panel" data-form="api-key">
            <label class="field">
              <span>Provider</span>
              <select name="providerMode">
                ${option("deepseek", "DeepSeek Direct", state.provider.mode)}
                ${option("env", "セルフホストENV", state.provider.mode)}
                ${option("local", "Local/Ollama", state.provider.mode)}
                ${option("later", "あとで設定", state.provider.mode)}
              </select>
            </label>
            <label class="field">
              <span>APIキー</span>
              <input name="apiKey" type="password" autocomplete="off" placeholder="サーバーへ送信のみ" />
              <small>保存先は /api/v1/workspaces/:id/api-keys です。</small>
            </label>
            <label class="field">
              <span>現在のモデル</span>
              <select name="model">
                ${option("deepseek-v4-flash", "deepseek-v4-flash", state.provider.model)}
                ${option("deepseek-v4-pro", "deepseek-v4-pro", state.provider.model)}
                ${option("local-default", "local-default", state.provider.model)}
              </select>
            </label>
            <div class="actions">
              <button class="button" type="submit">キー保存</button>
              <button class="button secondary" type="button" data-action="test-provider">Test</button>
            </div>
            <span class="badge ${providerBadgeClass()}">${html(state.provider.label)}</span>
          </form>
        </section>
      </main>
    `;
  }

  function option(value, label, selected) {
    return `<option value="${html(value)}" ${value === selected ? "selected" : ""}>${html(label)}</option>`;
  }

  function providerBadgeClass() {
    if (state.provider.status === "configured") return "ok";
    if (state.provider.status === "failed") return "danger";
    if (state.provider.status === "env") return "info";
    return "warn";
  }

  function renderBottomNav() {
    return `
      <nav class="bottom-nav" aria-label="主要ナビゲーション">
        <div class="bottom-nav-inner">
          ${navItems
            .map(
              ([view, icon, label]) => `
                <button class="nav-button ${state.activeView === view ? "active" : ""}" type="button" data-nav="${view}" aria-current="${state.activeView === view ? "page" : "false"}">
                  <strong aria-hidden="true">${html(icon)}</strong>
                  <span>${html(label)}</span>
                </button>
              `,
            )
            .join("")}
        </div>
      </nav>
    `;
  }

  function renderCostMeter() {
    const progress = currentProgress();
    const limit = Number(state.workspace.monthlyBudgetUsd || 0);
    const remaining = state.costs.remainingUsd ?? Math.max(0, limit - Number(state.costs.monthUsedUsd || 0));
    return `
      <aside class="cost-dock" aria-label="コストメーター">
        <div class="cost-meter">
          <div class="cost-top">
            <strong>今回 ${money(state.costs.currentRunUsd)}</strong>
            <span>残 ${money(remaining)} / 今月 ${money(state.costs.monthUsedUsd)} / ${money(limit)}</span>
          </div>
          <div class="progress" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="月間AI予算使用率">
            <span style="--progress:${progress}%"></span>
          </div>
          <div class="cost-meta">
            <span class="badge">${html(state.provider.model)}</span>
            <span class="badge info">${budgetLabel(state.workspace.budgetMode)}</span>
            ${state.costs.budgetExceeded ? `<span class="badge danger">予算超過</span>` : ""}
            <span class="badge">${Math.round(Number(state.costs.cacheRate || 0) * 100)}% cache</span>
          </div>
        </div>
      </aside>
    `;
  }

  function budgetLabel(value) {
    return {
      ultra_cheap: "節約",
      cheap: "標準",
      balanced: "バランス",
      high_quality: "高品質レビュー",
    }[value] || "標準";
  }

  function renderStats() {
    const approved = state.cards.filter((card) => card.status === "approved").length;
    const highRisk = state.cards.filter((card) => ["high", "critical"].includes(card.riskLevel || card.severity)).length;
    return `
      <section class="stat-row" aria-label="状態">
        <div class="stat-card"><strong>${approved}/${state.cards.length}</strong><span>承認カード</span></div>
        <div class="stat-card"><strong>${highRisk}</strong><span>高リスク</span></div>
      </section>
    `;
  }

  function renderCardGrid(cards) {
    return `<div class="card-grid three">${cards.filter((card) => !card.deleted).map(renderPrimitiveCard).join("")}</div>`;
  }

  function renderPrimitiveCard(card) {
    const editing = state.editing?.kind === "card" && state.editing.id === card.id;
    return `
      <article class="primitive-card ${html(card.status || "draft")}" data-card-id="${html(card.id)}">
        <div class="card-head">
          <div class="card-title-group">
            <p class="card-type">${html(card.type)}</p>
            <h3 class="card-title">${html(card.title)}</h3>
          </div>
          <span class="badge ${statusBadgeClass(card.status)}">${statusLabel(card.status)}</span>
        </div>
        ${
          editing
            ? renderEditor("card", card)
            : `
              <p class="card-body">${html(card.body)}</p>
              ${renderDetails(card.details)}
            `
        }
        <div class="card-meta">
          ${card.evidenceLevel ? `<span class="badge ${evidenceClass(card.evidenceLevel)}">証拠 ${html(card.evidenceLevel)}</span>` : ""}
          ${card.riskLevel ? `<span class="badge ${riskClass(card.riskLevel)}">リスク ${html(card.riskLevel)}</span>` : ""}
          ${card.links ? `<span class="badge">${html(card.links)}</span>` : ""}
        </div>
        ${renderCardActions("card", card)}
      </article>
    `;
  }

  function renderInitiativeCard(item) {
    const editing = state.editing?.kind === "initiative" && state.editing.id === item.id;
    return `
      <article class="initiative-card ${html(item.status || "draft")}" data-initiative-id="${html(item.id)}">
        <div class="card-head">
          <div class="card-title-group">
            <p class="card-type">${html(item.initiativeType || "initiative")}</p>
            <h3 class="card-title">${html(item.title)}</h3>
          </div>
          <span class="badge ${statusBadgeClass(item.status)}">${statusLabel(item.status)}</span>
        </div>
        ${
          editing
            ? renderEditor("initiative", item)
            : `
              <p class="card-body">${html(item.description)}</p>
              <ul class="detail-list">
                <li>仮説: ${html(item.hypothesis || item.relatedAssumption)}</li>
                <li>成功条件: ${html(item.successCriteria)}</li>
                <li>期限: ${html(item.timeboxDays)}日</li>
              </ul>
            `
        }
        <div class="card-meta">
          <span class="badge ${riskClass(item.priority)}">優先度 ${html(item.priority)}</span>
          <span class="badge">Cost ${money(item.estimatedCostUsd || 0.02)}</span>
        </div>
        ${renderCardActions("initiative", item)}
      </article>
    `;
  }

  function renderWorkItemCard(item) {
    const editing = state.editing?.kind === "workItem" && state.editing.id === item.id;
    return `
      <article class="work-card ${html(item.status || "draft")}" data-work-id="${html(item.id)}">
        <div class="card-head">
          <div class="card-title-group">
            <p class="card-type">${html(item.workType || "task")}</p>
            <h3 class="card-title">${html(item.title)}</h3>
          </div>
          <span class="badge ${statusBadgeClass(item.status)}">${statusLabel(item.status)}</span>
        </div>
        ${
          editing
            ? renderEditor("workItem", item)
            : `
              <p class="card-body">${html(item.description)}</p>
              <ul class="criteria-list">${(item.acceptanceCriteria || []).map((criterion) => `<li>${html(criterion)}</li>`).join("")}</ul>
            `
        }
        <div class="card-meta">
          <span class="badge ${riskClass(item.priority)}">優先度 ${html(item.priority)}</span>
          ${item.relatedInitiative ? `<span class="badge">${html(item.relatedInitiative)}</span>` : ""}
        </div>
        ${renderWorkItemTrace(item)}
        ${renderCardActions("workItem", item)}
        <div class="actions">
          <button class="button secondary" type="button" data-action="draft-github-issue" data-id="${html(item.id)}">GitHub Issue draft</button>
        </div>
      </article>
    `;
  }

  function renderReviewCard(review) {
    return `
      <article class="review-card">
        <div class="card-head">
          <div class="card-title-group">
            <p class="card-type">review</p>
            <h3 class="card-title">${html(review.title)}</h3>
          </div>
          <span class="badge info">${html(review.createdAt)}</span>
        </div>
        <p class="card-body">${html(review.summary)}</p>
        <ul class="detail-list">
          ${(review.recommendations || []).map((item) => `<li>${html(item)}</li>`).join("")}
        </ul>
        <div class="actions">
          <button class="button secondary" type="button" data-action="apply-review" data-review-id="${html(review.id)}">反映</button>
        </div>
      </article>
    `;
  }

  function renderEditor(kind, item) {
    const bodyValue = item.body || item.description || "";
    return `
      <div class="card-editor">
        <label class="field">
          <span>タイトル</span>
          <input data-edit-title="${html(item.id)}" value="${html(item.title)}" />
        </label>
        <label class="field">
          <span>本文</span>
          <textarea data-edit-body="${html(item.id)}">${html(bodyValue)}</textarea>
        </label>
        <div class="actions">
          <button class="button" type="button" data-action="save-edit" data-kind="${html(kind)}" data-id="${html(item.id)}">保存</button>
          <button class="button secondary" type="button" data-action="cancel-edit">Cancel</button>
        </div>
      </div>
    `;
  }

  function renderCardActions(kind, item) {
    return `
      <div class="card-actions" aria-label="カード操作">
        <button class="icon-button approve" type="button" title="承認" aria-label="承認" data-action="approve-item" data-kind="${html(kind)}" data-id="${html(item.id)}">ok</button>
        <button class="icon-button" type="button" title="修正" aria-label="修正" data-action="edit-item" data-kind="${html(kind)}" data-id="${html(item.id)}">edit</button>
        <button class="icon-button deepen" type="button" title="深掘り" aria-label="深掘り" data-action="deepen-item" data-kind="${html(kind)}" data-id="${html(item.id)}">...</button>
        <button class="icon-button delete" type="button" title="削除" aria-label="削除" data-action="delete-item" data-kind="${html(kind)}" data-id="${html(item.id)}">x</button>
      </div>
    `;
  }

  function renderDetails(details) {
    if (!details || !details.length) return "";
    return `<ul class="detail-list">${details.map((detail) => `<li>${html(detail)}</li>`).join("")}</ul>`;
  }

  function renderEmptyMap() {
    return `
      <div class="empty-state">
        <p>一文入力または段階質問から事業マップを生成してください。</p>
        <button class="button" type="button" data-nav="idea">入力へ</button>
      </div>
    `;
  }

  function renderTracePanel() {
    const assumptions = state.cards.filter((card) => card.type === "Assumption Card");
    return `
      <section class="form-panel" aria-label="トレース">
        <h3 class="card-title">Traceability</h3>
        <ul class="detail-list">
          ${
            assumptions.length
              ? assumptions.map((card) => `<li>${html(card.title)} -> 施策 ${linkedInitiatives(card.id)}</li>`).join("")
              : `<li>仮説カード生成後に関連が表示されます。</li>`
          }
        </ul>
      </section>
    `;
  }

  function linkedInitiatives(cardId) {
    const count = state.initiatives.filter((item) => item.relatedCardId === cardId).length;
    return `${count}件`;
  }

  function activeMemoryGraph() {
    if (state.memoryGraph?.nodes?.length) return state.memoryGraph;
    return buildLocalMemoryGraph();
  }

  function buildLocalMemoryGraph() {
    const nodes = [];
    const edges = [];
    const addNode = (node) => {
      nodes.push({
        id: node.id,
        workspace_id: state.workspace.id,
        project_id: state.project.id,
        status: node.status || "draft",
        importance: node.importance ?? 0.5,
        confidence: node.confidence ?? 0.5,
        ...node,
      });
      return node;
    };
    state.cards.forEach((card) => {
      const type = /Metric/.test(card.type)
        ? "metric"
        : /Assumption/.test(card.type)
          ? "assumption"
          : /Risk/.test(card.type)
            ? "risk"
            : "vision";
      addNode({
        id: `node-${card.id}`,
        node_type: type,
        source_entity_type: "card",
        source_entity_id: card.id,
        title: card.title,
        body: card.body,
        status: card.status || "draft",
      });
    });
    state.initiatives.forEach((initiative) => {
      addNode({
        id: `node-${initiative.id}`,
        node_type: "initiative",
        source_entity_type: "initiative",
        source_entity_id: initiative.id,
        title: initiative.title,
        body: initiative.description,
        status: initiative.status || "draft",
        importance: 0.7,
      });
      if (initiative.relatedCardId) {
        edges.push({
          id: `edge-${initiative.id}-${initiative.relatedCardId}`,
          from_node_id: `node-${initiative.id}`,
          to_node_id: `node-${initiative.relatedCardId}`,
          relation_type: "derived_from",
          strength: 0.62,
        });
      }
    });
    state.workItems.forEach((workItem) => {
      addNode({
        id: `node-${workItem.id}`,
        node_type: "work_item",
        source_entity_type: "work_item",
        source_entity_id: workItem.id,
        title: workItem.title,
        body: workItem.description,
        status: workItem.status || "draft",
        importance: 0.58,
      });
      if (workItem.relatedInitiative) {
        edges.push({
          id: `edge-${workItem.id}-${workItem.relatedInitiative}`,
          from_node_id: `node-${workItem.id}`,
          to_node_id: `node-${workItem.relatedInitiative}`,
          relation_type: "implements",
          strength: 0.72,
        });
      }
    });
    state.reviews.forEach((review) => {
      addNode({
        id: `node-${review.id}`,
        node_type: "review",
        source_entity_type: "review",
        source_entity_id: review.id,
        title: review.title,
        body: review.summary,
        status: "active",
        importance: 0.64,
      });
    });
    return { nodes, edges };
  }

  function renderWorkItemTrace(item) {
    const graph = activeMemoryGraph();
    const itemNode = graph.nodes.find(
      (node) =>
        (node.source_entity_type === "work_item" && node.source_entity_id === item.id) ||
        (node.sourceEntityType === "work_item" && node.sourceEntityId === item.id) ||
        node.id === `node-${item.id}`
    );
    if (!itemNode) return "";
    const related = graph.edges
      .filter((edge) => edge.from_node_id === itemNode.id || edge.fromNodeId === itemNode.id)
      .map((edge) => {
        const targetId = edge.to_node_id || edge.toNodeId;
        const target = graph.nodes.find((node) => node.id === targetId);
        return target ? `${edge.relation_type || edge.relationType}: ${target.title}` : "";
      })
      .filter(Boolean)
      .slice(0, 3);
    if (!related.length) return "";
    return `<ul class="trace-list">${related.map((entry) => `<li>${html(entry)}</li>`).join("")}</ul>`;
  }

  function statusLabel(status) {
    return {
      approved: "承認",
      draft: "Draft",
      review: "深掘り",
      rejected: "棄却",
    }[status] || "Draft";
  }

  function statusBadgeClass(status) {
    return status === "approved" ? "ok" : status === "review" ? "info" : status === "rejected" ? "danger" : "warn";
  }

  function evidenceClass(level) {
    return level === "strong" ? "ok" : level === "medium" ? "info" : level === "weak" ? "warn" : "danger";
  }

  function riskClass(level) {
    return ["critical", "high"].includes(level) ? "danger" : level === "medium" ? "warn" : "ok";
  }

  function currentIdea() {
    return document.getElementById("idea-input")?.value.trim() || state.project.idea.trim();
  }

  function classifyIdeaFromText(idea) {
    const lowered = idea.toLowerCase();
    const isAi = /ai|llm|自動|検出|生成|エージェント/.test(lowered);
    const isB2b = /社内|企業|見積|店舗|建築|営業|問い合わせ|業務|b2b/i.test(idea);
    const businessType = isB2b ? "b2b_saas" : "prosumer_tool";
    const user = /飲食/.test(idea)
      ? "店舗オーナーとSNS担当者"
      : /建築|図面|見積/.test(idea)
        ? "見積担当者と施工管理者"
        : /社内|問い合わせ/.test(idea)
          ? "情シスとバックオフィス"
          : "最初に痛みが強い業務担当者";

    return {
      business_type: businessType,
      initial_concept: idea,
      target_user_candidates: [user, "導入判断者", "現場の運用担当者"],
      uncertainties: [
        { type: "customer", description: `${user}が今すぐ代替したい作業か` },
        { type: isAi ? "technical" : "market", description: isAi ? "精度とコストがPoC価値に収まるか" : "既存代替より早く価値を見せられるか" },
        { type: "gtm", description: "最初の10社に届く導線があるか" },
      ],
      next_questions: defaultQuestions,
    };
  }

  function cardsFromIntake(intake) {
    return [
      {
        id: uid("card"),
        type: "Concept Card",
        title: businessTitle(intake.initial_concept),
        body: intake.initial_concept,
        status: "draft",
        evidenceLevel: "none",
        links: intake.business_type,
        details: [`事業タイプ: ${intake.business_type}`],
      },
      {
        id: uid("card"),
        type: "Target User Card",
        title: intake.target_user_candidates[0] || "初期ユーザー",
        body: (intake.target_user_candidates || []).join(" / "),
        status: "draft",
        evidenceLevel: "weak",
        links: "user",
        details: ["最初の利用者と導入判断者を分けて検証"],
      },
      {
        id: uid("card"),
        type: "Risk Card",
        title: "未確定リスク",
        body: (intake.uncertainties || []).map((item) => `${item.type}: ${item.description}`).join("。"),
        status: "draft",
        evidenceLevel: "none",
        riskLevel: "high",
        links: "risk",
      },
    ];
  }

  function businessTitle(idea) {
    const cleaned = String(idea || "新規事業").replace(/[。、.]/g, " ").trim();
    return truncate(cleaned, 28);
  }

  function sampleBusinessMap() {
    const idea = state.project.idea || "スマホで進める新規事業OS";
    const intake = classifyIdeaFromText(idea);
    const user = state.answers.first_user || intake.target_user_candidates[0];
    const pain = state.answers.pain_now || "手作業と判断待ちで検証速度が落ちている";
    const proof = state.answers.proof || "PoC結果";
    const conceptId = uid("card");
    const assumptionCustomerId = uid("card");
    const assumptionSolutionId = uid("card");

    return [
      {
        id: conceptId,
        type: "Concept Card",
        title: businessTitle(idea),
        body: idea,
        status: "draft",
        evidenceLevel: "weak",
        links: intake.business_type,
        details: ["一文入力から作成", `分類: ${intake.business_type}`],
      },
      {
        id: uid("card"),
        type: "Target User Card",
        title: user,
        body: `${user}が最初の検証対象です。導入判断者と日次利用者を分けて観察します。`,
        status: "draft",
        evidenceLevel: state.answers.first_user ? "medium" : "weak",
        links: conceptId,
        details: ["初回価値を感じる利用者を優先"],
      },
      {
        id: uid("card"),
        type: "Pain Card",
        title: "検証する痛み",
        body: pain,
        status: "draft",
        evidenceLevel: state.answers.pain_now ? "medium" : "weak",
        links: user,
        details: ["既存代替と頻度を次に確認"],
      },
      {
        id: uid("card"),
        type: "Ideal State Card",
        title: "2週間後の理想状態",
        body: "最初の利用者が価値を説明でき、次の検証に進む判断材料が揃っている。",
        status: "draft",
        evidenceLevel: "none",
        links: conceptId,
        details: ["観測可能な成果: デモ完了、見積時間、継続意向"],
      },
      {
        id: uid("card"),
        type: "Metric Card",
        title: "North Star: 初回価値到達時間",
        body: "ユーザーが最初の成果を確認するまでの時間。短いほどPoC転換率に効きます。",
        status: "draft",
        evidenceLevel: "weak",
        links: "metric",
        details: ["補助指標: 完了率、再実行率、手戻り数"],
      },
      {
        id: assumptionCustomerId,
        type: "Assumption Card",
        title: "顧客仮説",
        body: `${user}は${pain}を今すぐ減らしたい。`,
        status: "draft",
        evidenceLevel: state.answers.proof ? "weak" : "none",
        riskLevel: "high",
        links: "customer",
        details: [`検証方法: ${proof}`, "状態: unverified"],
      },
      {
        id: assumptionSolutionId,
        type: "Assumption Card",
        title: "ソリューション仮説",
        body: "候補提示と人間確認を組み合わせれば、完全自動化前でも価値を出せる。",
        status: "draft",
        evidenceLevel: "none",
        riskLevel: "medium",
        links: "solution",
        details: ["検証方法: 低忠実度PoCと5件の実データ"],
      },
      {
        id: uid("card"),
        type: "Product Experience Card",
        title: "最初の体験",
        body: "入力、AI処理、確認、結果共有までを10分以内で完了させる。",
        status: "draft",
        evidenceLevel: "none",
        links: conceptId,
        details: ["スマホでは承認と修正に絞る"],
      },
      {
        id: uid("card"),
        type: "Engineering State Card",
        title: "技術状態",
        body: "精度・速度・コストをPoC価値の判断材料として入力し、営業表現に変換する。",
        status: "draft",
        evidenceLevel: "weak",
        links: assumptionSolutionId,
        details: ["完全自動化として売る前に確認UIを前提にする"],
      },
      {
        id: uid("card"),
        type: "Risk Card",
        title: "販売前リスク",
        body: "精度、データ権限、初回設定の重さがPoC離脱につながる。",
        status: "draft",
        evidenceLevel: "none",
        riskLevel: "high",
        links: "risk",
        details: ["緩和: 小さいデータセットでデモ、監査ログ、明確な非対応範囲"],
      },
    ];
  }

  function sampleInitiatives() {
    const assumptions = state.cards.filter((card) => card.type === "Assumption Card");
    const primaryAssumption = assumptions[0] || { id: "local-assumption", title: "顧客仮説", body: "最初のユーザーが強い痛みを持つ" };
    const secondaryAssumption = assumptions[1] || primaryAssumption;

    const initiativeOneId = uid("initiative");
    const initiativeTwoId = uid("initiative");
    const initiatives = [
      {
        id: initiativeOneId,
        title: "5件インタビューで痛みを検証",
        description: "対象ユーザー候補に現在の代替手段、頻度、失敗コストを確認する。",
        initiativeType: "research",
        relatedCardId: primaryAssumption.id,
        relatedAssumption: primaryAssumption.title,
        relatedMetric: "初回価値到達時間",
        hypothesis: primaryAssumption.body,
        successCriteria: "3件以上で有料PoCに進む理由が明確",
        timeboxDays: 7,
        priority: "high",
        estimatedCostUsd: 0.018,
        status: "draft",
      },
      {
        id: initiativeTwoId,
        title: "10分PoC導線を作る",
        description: "入力から結果確認までの最短フローを作り、初回価値を測る。",
        initiativeType: "product",
        relatedCardId: secondaryAssumption.id,
        relatedAssumption: secondaryAssumption.title,
        relatedMetric: "初回価値到達時間",
        hypothesis: secondaryAssumption.body,
        successCriteria: "初見ユーザーが15分以内に価値を確認",
        timeboxDays: 10,
        priority: "critical",
        estimatedCostUsd: 0.026,
        status: "draft",
      },
    ];

    const workItems = [
      {
        id: uid("work"),
        title: "インタビュースクリプトを作る",
        description: "仮説の強弱が判定できる質問と記録テンプレートを用意する。",
        workType: "research",
        acceptanceCriteria: ["頻度、代替、失敗コストを聞ける", "回答をEvidenceとして残せる"],
        priority: "high",
        relatedInitiative: initiativeOneId,
        status: "draft",
      },
      {
        id: uid("work"),
        title: "初回入力から結果確認までの画面を作る",
        description: "PoCで初回価値を10分以内に見せるため、入力、処理開始、結果確認の導線を作る。",
        workType: "issue",
        acceptanceCriteria: ["スマホで入力できる", "処理状態が分かる", "結果カードを承認・修正できる"],
        priority: "critical",
        relatedInitiative: initiativeTwoId,
        status: "draft",
      },
      {
        id: uid("work"),
        title: "コストと失敗時メッセージを表示",
        description: "APIが未起動でもサンプルモードに切り替わり、検証作業を止めない。",
        workType: "ops",
        acceptanceCriteria: ["API失敗時にローカル生成する", "今回と月間の予算が見える"],
        priority: "medium",
        relatedInitiative: initiativeTwoId,
        status: "draft",
      },
    ];

    return { initiatives, workItems };
  }

  function normalizeIntake(payload) {
    const output = unwrapApi(payload, ["output", "result"]);
    const initialConcept = output?.initial_concept || output?.initialConcept || state.project.idea;
    if (!output || !initialConcept) return classifyIdeaFromText(state.project.idea);
    return {
      business_type: output.business_type || output.businessType || "b2b_saas",
      initial_concept: initialConcept,
      target_user_candidates: output.target_user_candidates || output.targetUsers || [],
      uncertainties: output.uncertainties || [],
      next_questions: output.next_questions || output.nextQuestions || defaultQuestions,
    };
  }

  function normalizeBusinessMap(payload) {
    const output = unwrapApi(payload, ["businessMap", "business_map", "output", "result"]);
    if (!output?.concept) return sampleBusinessMap();

    const cards = [
      {
        id: uid("card"),
        type: "Concept Card",
        title: output.concept.title,
        body: output.concept.oneLiner || output.concept.description,
        status: "draft",
        evidenceLevel: "weak",
        links: output.concept.businessType,
        details: [output.concept.description],
      },
      ...(output.targetUsers || []).map((user) => ({
        id: uid("card"),
        type: "Target User Card",
        title: user.name,
        body: user.description,
        status: "draft",
        evidenceLevel: "weak",
        links: "user",
        details: [...(user.painPoints || []), ...(user.currentAlternatives || []).map((item) => `代替: ${item}`)],
      })),
      {
        id: uid("card"),
        type: "Ideal State Card",
        title: "理想状態",
        body: output.idealState?.description || "",
        status: "draft",
        evidenceLevel: "none",
        links: "ideal",
        details: output.idealState?.observableOutcomes || [],
      },
      {
        id: uid("card"),
        type: "Metric Card",
        title: output.northStarMetric?.name || "North Star Metric",
        body: output.northStarMetric?.definition || "",
        status: "draft",
        evidenceLevel: "weak",
        links: "metric",
        details: [output.northStarMetric?.whyItMatters, ...(output.northStarMetric?.caveats || [])].filter(Boolean),
      },
      ...(output.assumptions || []).map((assumption) => ({
        id: uid("card"),
        type: "Assumption Card",
        title: assumption.type || "仮説",
        body: assumption.statement,
        status: "draft",
        evidenceLevel: assumption.evidenceLevel || "none",
        riskLevel: assumption.riskLevel || "medium",
        links: assumption.type,
        details: [assumption.validationMethod],
      })),
      ...(output.risks || []).map((risk) => ({
        id: uid("card"),
        type: "Risk Card",
        title: risk.title,
        body: risk.description,
        status: "draft",
        evidenceLevel: "none",
        riskLevel: risk.severity,
        links: "risk",
        details: [risk.mitigation],
      })),
    ];
    return cards.filter((card) => card.title || card.body);
  }

  function normalizeInitiatives(payload) {
    const output = unwrapApi(payload, ["output", "result"]);
    if (!output?.initiatives) return sampleInitiatives();

    const initiatives = [];
    const workItems = [];
    output.initiatives.forEach((item) => {
      const initiativeId = uid("initiative");
      initiatives.push({
        id: initiativeId,
        title: item.title,
        description: item.description,
        initiativeType: item.initiativeType,
        relatedAssumption: item.relatedAssumption,
        relatedMetric: item.relatedMetric,
        hypothesis: item.hypothesis,
        successCriteria: item.successCriteria,
        timeboxDays: item.timeboxDays,
        priority: item.priority,
        estimatedCostUsd: 0.02,
        status: "draft",
      });
      (item.workItems || []).forEach((workItem) => {
        workItems.push({
          id: uid("work"),
          title: workItem.title,
          description: workItem.description,
          workType: workItem.workType,
          acceptanceCriteria: workItem.acceptanceCriteria || [],
          priority: workItem.priority,
          relatedInitiative: initiativeId,
          status: "draft",
        });
      });
    });
    return { initiatives, workItems };
  }

  function capturePlaybookRun(payload) {
    const run = unwrapApi(payload, ["playbookRun", "run"]);
    if (!run?.id) return null;
    state.lastPlaybookRun = run;
    state.playbookRuns = [run, ...(state.playbookRuns || []).filter((item) => item.id !== run.id)].slice(0, 10);
    return run;
  }

  function normalizeApiInitiatives(items) {
    return (items || []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      initiativeType: item.initiativeType || item.initiative_type,
      relatedMetricId: item.relatedMetricId || item.related_metric_id,
      relatedAssumptionId: item.relatedAssumptionId || item.related_assumption_id,
      hypothesis: item.hypothesis,
      successCriteria: item.successCriteria || item.success_criteria,
      timeboxDays: item.timeboxDays || 14,
      priority: item.priority || "medium",
      status: item.status || "draft",
    }));
  }

  function normalizeApiWorkItems(items) {
    return (items || []).map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      workType: item.workType || item.work_type,
      acceptanceCriteria: item.acceptanceCriteria || item.acceptance_criteria || [],
      priority: item.priority || "medium",
      relatedInitiative: item.relatedInitiative || item.initiativeId || item.initiative_id,
      status: item.status || "draft",
    }));
  }

  function collectAnswers() {
    document.querySelectorAll("[data-question-input]").forEach((input) => {
      const id = input.getAttribute("data-question-input");
      if (input.value.trim()) {
        state.answers[id] = input.value.trim();
      }
    });
  }

  async function startSetup(form, sample) {
    const data = new FormData(form);
    state.workspace.name = data.get("workspaceName") || "Open Business OS";
    state.workspace.usageType = data.get("usageType") || "individual";
    state.workspace.monthlyBudgetUsd = Number(data.get("monthlyBudgetUsd") || 5);
    state.workspace.budgetMode = data.get("budgetMode") || "cheap";
    state.provider.mode = data.get("providerMode") || "later";
    state.provider.status = state.provider.mode === "env" ? "env" : "not_configured";
    state.provider.label = state.provider.mode === "env" ? "ENV参照" : "未設定";
    state.initialized = true;
    state.activeView = "idea";

    if (sample) {
      state.sampleMode = true;
      saveState();
      render();
      return;
    }

    await syncWithFallback(
      "/workspaces",
      {
        method: "POST",
        body: JSON.stringify({
          name: state.workspace.name,
          usage_type: state.workspace.usageType,
          default_budget_mode: state.workspace.budgetMode,
          monthly_budget_usd: state.workspace.monthlyBudgetUsd,
        }),
      },
      (payload) => {
        const workspace = unwrapApi(payload, ["workspace"]);
        if (workspace?.id) state.workspace.id = workspace.id;
        if (workspace?.slug) state.workspace.slug = workspace.slug;
        return payload;
      },
    );
  }

  async function ensureProjectRecord() {
    if (state.project.id && !state.project.id.startsWith("local-")) return;
    await syncWithFallback(
      "/projects",
      {
        method: "POST",
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          name: state.project.title || businessTitle(state.project.idea),
          oneLiner: state.project.idea,
          businessType: state.project.businessType || "",
        }),
      },
      (payload) => {
        const project = unwrapApi(payload, ["project"]);
        if (project?.id) state.project.id = project.id;
        if (project?.businessType || project?.business_type) {
          state.project.businessType = project.businessType || project.business_type;
        }
        return project;
      },
    );
  }

  async function classifyIdea() {
    const idea = currentIdea();
    if (!idea) {
      setToast("事業アイデアを入力してください。");
      return;
    }
    estimateCost("intake");
    const approvedHighCost = highCostConfirm("intake");
    if (!approvedHighCost) return;
    state.project.idea = idea;
    state.project.title = businessTitle(idea);

    await ensureProjectRecord();

    await syncWithFallback(
      "/playbook-runs",
      {
        method: "POST",
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          projectId: state.project.id,
          playbookId: "idea_intake",
          budgetMode: state.workspace.budgetMode,
          approvedHighCost,
          input: { idea, oneLiner: idea },
        }),
      },
      (payload) => {
        capturePlaybookRun(payload);
        const intake = normalizeIntake(payload);
        state.project.businessType = intake.business_type;
        state.questions = normalizeQuestions(intake.next_questions);
        state.cards = cardsFromIntake(intake);
        state.activeView = "intake";
        addCost(state.costs.currentRunUsd);
        setToast(state.sampleMode ? "サンプルモードで分類しました。" : "分類しました。");
        return intake;
      },
    );
  }

  function normalizeQuestions(questions) {
    if (!questions || !questions.length) return defaultQuestions;
    return questions.slice(0, 6).map((question, index) => ({
      id: question.id || `question_${index}`,
      question: question.question,
      reason: question.reason || question.why || "",
      inputType: question.input_type || question.inputType || "short_text",
      options: question.options || [],
    }));
  }

  async function generateMap() {
    const idea = currentIdea();
    if (idea) {
      state.project.idea = idea;
      state.project.title = businessTitle(idea);
    }
    if (!state.project.idea) {
      setToast("先に事業アイデアを入力してください。");
      state.activeView = "idea";
      render();
      return;
    }
    collectAnswers();
    estimateCost("map");
    const approvedHighCost = highCostConfirm("map");
    if (!approvedHighCost) return;
    await ensureProjectRecord();

    await syncWithFallback(
      "/playbook-runs",
      {
        method: "POST",
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          projectId: state.project.id,
          playbookId: "business_map_generation",
          budgetMode: state.workspace.budgetMode,
          approvedHighCost,
          input: {
            idea: state.project.idea,
            oneLiner: state.project.idea,
            answers: state.answers,
            existing_cards: state.cards,
          },
        }),
      },
      (payload) => {
        capturePlaybookRun(payload);
        state.cards = normalizeBusinessMap(payload);
        state.activeView = "map";
        addCost(state.costs.currentRunUsd);
        if (!state.initiatives.length) {
          const generated = sampleInitiatives();
          state.initiatives = generated.initiatives;
          state.workItems = generated.workItems;
        }
        setToast(state.sampleMode ? "サンプルモードでMapを生成しました。" : "Mapを生成しました。");
        return state.cards;
      },
    );
  }

  async function generateInitiatives() {
    if (!state.cards.length) {
      await generateMap();
      return;
    }
    estimateCost("initiative");
    const approvedHighCost = highCostConfirm("initiative");
    if (!approvedHighCost) return;

    await syncWithFallback(
      "/playbook-runs",
      {
        method: "POST",
        body: JSON.stringify({
          workspaceId: state.workspace.id,
          projectId: state.project.id,
          playbookId: "initiative_generation",
          budgetMode: state.workspace.budgetMode,
          approvedHighCost,
          input: {
            cards: state.cards,
            budget_mode: state.workspace.budgetMode,
          },
        }),
      },
      (payload) => {
        capturePlaybookRun(payload);
        const generated = normalizeInitiatives(payload);
        state.initiatives = generated.initiatives;
        state.workItems = generated.workItems;
        state.activeView = "work";
        addCost(state.costs.currentRunUsd);
        setToast(state.sampleMode ? "サンプルモードで施策を生成しました。" : "施策を生成しました。");
        return generated;
      },
    );
  }

  async function deepenItem(kind, id) {
    const item = findItem(kind, id);
    if (!item) return;
    estimateCost("deepen");
    const approvedHighCost = highCostConfirm("deepen");
    if (!approvedHighCost) return;
    await syncWithFallback(
      "/ai-runs",
      {
        method: "POST",
        body: JSON.stringify({
          workspace_id: state.workspace.id,
          project_id: state.project.id,
          task: "deepen_card",
          budget_mode: state.workspace.budgetMode,
          approvedHighCost,
          input: item,
        }),
      },
      (payload) => {
        const suggestion = payload?.suggestion || payload?.output?.suggestion || sampleDeepDive(item);
        item.status = "review";
        item.details = [...(item.details || []), suggestion];
        addCost(state.costs.currentRunUsd);
        setToast("深掘りを追加しました。");
        return item;
      },
    );
  }

  function sampleDeepDive(item) {
    const label = item.type || item.initiativeType || item.workType || "item";
    if (/Assumption|仮説|research/.test(label + item.title)) {
      return "深掘り: 証拠の種類、判定基準、次の意思決定を1つずつ分けて記録する。";
    }
    if (/Risk|risk/.test(label + item.title)) {
      return "深掘り: 発生条件、検知方法、最初の緩和策をカードに紐づける。";
    }
    return "深掘り: この項目がどの仮説と指標を動かすかを明記する。";
  }

  function findItem(kind, id) {
    const list = listForKind(kind);
    return list.find((item) => item.id === id);
  }

  function listForKind(kind) {
    if (kind === "card") return state.cards;
    if (kind === "initiative") return state.initiatives;
    if (kind === "workItem") return state.workItems;
    return [];
  }

  async function patchItem(kind, item) {
    const endpoint =
      kind === "card"
        ? `/visions/${encodeURIComponent(item.id)}`
        : kind === "initiative"
          ? `/initiatives/${encodeURIComponent(item.id)}`
          : `/work-items/${encodeURIComponent(item.id)}`;
    try {
      await apiRequest(endpoint, { method: "PATCH", body: JSON.stringify(item) });
    } catch (_error) {
      state.sampleMode = true;
    }
  }

  async function approveItem(kind, id) {
    const item = findItem(kind, id);
    if (!item) return;
    item.status = "approved";
    await patchItem(kind, item);
    saveState();
    setToast("承認しました。");
    render();
  }

  async function saveEdit(kind, id) {
    const item = findItem(kind, id);
    if (!item) return;
    const title = document.querySelector(`[data-edit-title="${CSS.escape(id)}"]`)?.value.trim();
    const body = document.querySelector(`[data-edit-body="${CSS.escape(id)}"]`)?.value.trim();
    if (title) item.title = title;
    if (body) {
      if (kind === "card") item.body = body;
      else item.description = body;
    }
    item.status = item.status === "approved" ? "approved" : "draft";
    state.editing = null;
    await patchItem(kind, item);
    saveState();
    setToast("修正しました。");
    render();
  }

  function deleteItem(kind, id) {
    const list = listForKind(kind);
    const index = list.findIndex((item) => item.id === id);
    if (index >= 0) {
      list.splice(index, 1);
      saveState();
      setToast("削除しました。");
      render();
    }
  }

  function addWorkItem() {
    state.workItems.unshift({
      id: uid("work"),
      title: "新しいWorkItem",
      description: "このタスクがどの仮説と指標に効くかを入力してください。",
      workType: "task",
      acceptanceCriteria: ["完了条件を1つ以上書く"],
      priority: "medium",
      status: "draft",
    });
    state.activeView = "work";
    saveState();
    render();
  }

  async function submitReview(form) {
    const data = new FormData(form);
    const done = data.get("done");
    const evidence = data.get("evidence");
    const metric = data.get("metric");
    if (!done || !evidence) return;

    estimateCost("review");
    const approvedHighCost = highCostConfirm("review");
    if (!approvedHighCost) return;

    await syncWithFallback(
      `/projects/${encodeURIComponent(state.project.id)}/reviews`,
      {
        method: "POST",
        body: JSON.stringify({ done, evidence, metric }),
      },
      (payload) => {
        const review = normalizeReview(payload, { done, evidence, metric });
        state.reviews.unshift(review);
        addCost(state.costs.currentRunUsd);
        form.reset();
        setToast(state.sampleMode ? "サンプルモードでレビューを整理しました。" : "レビューを整理しました。");
        return review;
      },
    );
  }

  function normalizeReview(payload, input) {
    const output = unwrapApi(payload, ["review", "output", "result"]);
    if (output?.summary) {
      return {
        id: output.id || uid("review"),
        title: output.title || "レビュー結果",
        summary: output.summary,
        recommendations: output.recommendations || [],
        createdAt: new Date().toLocaleDateString("ja-JP"),
      };
    }
    return {
      id: uid("review"),
      title: "2週間レビュー",
      summary: `${input.done}。証拠: ${input.evidence}${input.metric ? `。指標: ${input.metric}` : ""}`,
      recommendations: [
        "強まった仮説をsupported候補にする",
        "証拠が弱い仮説は次の施策に残す",
        "WorkItemを初回価値到達時間に寄せて並べ替える",
      ],
      createdAt: new Date().toLocaleDateString("ja-JP"),
    };
  }

  async function applyReview(id) {
    const review = state.reviews.find((item) => item.id === id);
    if (!review) return;
    state.cards
      .filter((card) => card.type === "Assumption Card")
      .slice(0, 1)
      .forEach((card) => {
        card.evidenceLevel = "medium";
        card.details = [...(card.details || []), "レビュー反映: supported候補"];
      });
    try {
      await apiRequest(`/reviews/${encodeURIComponent(id)}/apply-recommendations`, { method: "POST", body: JSON.stringify({ review }) });
    } catch (_error) {
      state.sampleMode = true;
    }
    saveState();
    setToast("レビュー提案を反映しました。");
    render();
  }

  async function refreshProjectSnapshot({ silent = false } = {}) {
    if (!state.project.id || state.project.id.startsWith("local-")) return;
    try {
      const payload = await apiRequest(`/projects/${encodeURIComponent(state.project.id)}`);
      const project = unwrapApi(payload, ["project"]);
      if (project?.id) {
        state.project.id = project.id;
        state.project.title = project.name || state.project.title;
        state.project.idea = project.oneLiner || project.one_liner || state.project.idea;
        state.project.businessType = project.businessType || project.business_type || state.project.businessType;
      }
      const businessMap = payload.businessMap || payload.business_map;
      if (businessMap) state.cards = normalizeBusinessMap({ output: businessMap });
      state.initiatives = normalizeApiInitiatives(payload.initiatives || state.initiatives);
      state.workItems = normalizeApiWorkItems(payload.workItems || payload.work_items || state.workItems);
      saveState();
      if (!silent) setToast("Project Stateを更新しました。");
    } catch (_error) {
      if (!silent) setToast("Project Stateはローカル表示のままです。");
    }
  }

  async function refreshMemory({ silent = false } = {}) {
    if (!state.project.id || state.project.id.startsWith("local-")) {
      state.memoryGraph = buildLocalMemoryGraph();
      state.memorySummary = {
        body: buildLocalMemorySummary(state.memoryGraph),
        token_estimate: 0,
      };
      saveState();
      if (!silent) render();
      return;
    }
    state.syncing = true;
    render();
    try {
      const graphPayload = await apiRequest(`/projects/${encodeURIComponent(state.project.id)}/memory/graph`);
      const summaryPayload = await apiRequest(`/projects/${encodeURIComponent(state.project.id)}/memory/summary`);
      state.memoryGraph = unwrapApi(graphPayload, ["memoryGraph", "graph"]) || { nodes: [], edges: [] };
      state.memorySummary = unwrapApi(summaryPayload, ["memorySummary", "summary"]);
      if (!silent) setToast("Memoryを更新しました。");
    } catch (_error) {
      state.memoryGraph = buildLocalMemoryGraph();
      state.memorySummary = {
        body: buildLocalMemorySummary(state.memoryGraph),
        token_estimate: 0,
      };
      if (!silent) setToast("Memoryはローカルトレースで表示しています。");
    } finally {
      state.syncing = false;
      saveState();
      render();
    }
  }

  function buildLocalMemorySummary(graph) {
    const nodes = (graph.nodes || []).slice(0, 12);
    const edges = (graph.edges || []).slice(0, 12);
    return [
      `Project: ${state.project.title || state.project.idea || "Open Business OS"}`,
      "",
      "Important nodes:",
      ...nodes.map((node) => `- [${node.node_type}/${node.status}] ${node.title}`),
      "",
      "Relations:",
      ...edges.map((edge) => `- ${edge.from_node_id} --${edge.relation_type}--> ${edge.to_node_id}`),
    ].join("\n");
  }

  async function approvePlaybookOutput() {
    const run = state.lastPlaybookRun;
    if (!run?.id) {
      setToast("承認できるPlaybook Runがありません。");
      return;
    }
    if (run.status === "applied") {
      setToast("このPlaybook outputは適用済みです。");
      return;
    }
    const approved = await syncWithFallback(
      `/playbook-runs/${encodeURIComponent(run.id)}/approve-output`,
      { method: "POST" },
      (payload, fromApi, error) => {
        if (!fromApi) {
          if (error?.code === "VALIDATION_ERROR" || error?.code === "FORBIDDEN") {
            setToast(error.message || "このPlaybook outputは適用できません。");
            return null;
          }
          run.status = "applied";
          state.lastPlaybookRun = run;
          setToast("API未接続のためローカル上で適用済みにしました。");
          return run;
        }
        const appliedRun = unwrapApi(payload, ["playbookRun", "run"]);
        if (appliedRun?.id) state.lastPlaybookRun = appliedRun;
        setToast("Playbook outputをProject Stateへ適用しました。");
        return appliedRun;
      },
    );
    if (approved?.id) {
      await refreshProjectSnapshot({ silent: true });
      await refreshMemory({ silent: true });
    }
  }

  async function copyMemorySummary() {
    const text = state.memorySummary?.body || buildLocalMemorySummary(activeMemoryGraph());
    try {
      await navigator.clipboard.writeText(text);
      setToast("Memory Summaryをコピーしました。");
    } catch (_error) {
      setToast("コピーできませんでした。テキストを選択してください。");
    }
  }

  async function draftGitHubIssue(id) {
    const workItem = state.workItems.find((item) => item.id === id);
    if (!workItem) return;
    await syncWithFallback(
      `/work-items/${encodeURIComponent(id)}/github-issue-draft`,
      {
        method: "POST",
        body: JSON.stringify({ labels: ["open-business-os", workItem.priority || "medium"] }),
      },
      (payload, fromApi) => {
        const toolAction = unwrapApi(payload, ["toolAction", "tool_action"]) || {
          id: uid("tool"),
          workspace_id: state.workspace.id,
          project_id: state.project.id,
          tool_provider: "github",
          action_type: "issue_create",
          payload: { title: workItem.title, source_work_item_id: workItem.id },
          preview: `GitHub issue draft: ${workItem.title}`,
          status: "draft",
          created_at: new Date().toISOString(),
        };
        state.toolActions = [toolAction, ...(state.toolActions || []).filter((item) => item.id !== toolAction.id)];
        setToast(fromApi ? "GitHub Issue draftを作成しました。" : "API未接続のためローカルdraftにしました。");
        return toolAction;
      },
    );
  }

  async function saveWorkspace(form) {
    const data = new FormData(form);
    state.workspace.name = data.get("workspaceName") || state.workspace.name;
    state.workspace.monthlyBudgetUsd = Number(data.get("monthlyBudgetUsd") || state.workspace.monthlyBudgetUsd);
    state.workspace.budgetMode = data.get("budgetMode") || state.workspace.budgetMode;
    addCost(0);
    await syncWithFallback(
      `/workspaces/${encodeURIComponent(state.workspace.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: state.workspace.name,
          default_budget_mode: state.workspace.budgetMode,
          monthly_budget_usd: state.workspace.monthlyBudgetUsd,
        }),
      },
      () => {
        setToast("設定を保存しました。");
      },
    );
  }

  async function saveApiKey(form) {
    const data = new FormData(form);
    volatileApiKey = data.get("apiKey") || "";
    state.provider.mode = data.get("providerMode") || state.provider.mode;
    state.provider.model = data.get("model") || state.provider.model;

    if (state.provider.mode === "env") {
      state.provider.status = "env";
      state.provider.label = "ENV参照";
      volatileApiKey = "";
      saveState();
      setToast("セルフホストENV参照にしました。");
      render();
      return;
    }

    if (!volatileApiKey && state.provider.mode !== "local") {
      state.provider.status = "not_configured";
      state.provider.label = "キー未入力";
      saveState();
      setToast("APIキーを入力してください。");
      render();
      return;
    }

    await syncWithFallback(
      `/workspaces/${encodeURIComponent(state.workspace.id)}/api-keys`,
      {
        method: "POST",
        body: JSON.stringify({
          provider: state.provider.mode === "deepseek" ? "deepseek_direct" : state.provider.mode,
          apiKey: volatileApiKey,
          model: state.provider.model,
        }),
      },
      (_payload, fromApi) => {
        state.provider.status = fromApi ? "configured" : "failed";
        state.provider.label = fromApi ? "サーバー保存済み" : "API未接続";
        volatileApiKey = "";
        form.reset();
        setToast(fromApi ? "APIキーを保存しました。" : "API未接続のためキーは保存していません。");
      },
    );
  }

  async function testProvider() {
    await syncWithFallback(
      `/workspaces/${encodeURIComponent(state.workspace.id)}/api-keys/test`,
      { method: "POST", body: JSON.stringify({ provider: state.provider.mode === "deepseek" ? "deepseek_direct" : state.provider.mode, model: state.provider.model }) },
      (_payload, fromApi) => {
        state.provider.status = fromApi ? "configured" : "failed";
        state.provider.label = fromApi ? "接続OK" : "API未接続";
        setToast(state.provider.label);
      },
    );
  }

  function buildMarkdown() {
    const lines = [];
    lines.push(`# ${state.project.title || "Open Business OS Project"}`);
    lines.push("");
    lines.push(`- Workspace: ${state.workspace.name || "未設定"}`);
    lines.push(`- Budget: ${budgetLabel(state.workspace.budgetMode)} / ${money(state.workspace.monthlyBudgetUsd)}`);
    lines.push(`- Model: ${state.provider.model}`);
    lines.push("");
    lines.push("## Idea");
    lines.push("");
    lines.push(state.project.idea || "未入力");
    lines.push("");
    lines.push("## Business Map");
    state.cards.forEach((card) => {
      lines.push("");
      lines.push(`### ${card.type}: ${card.title}`);
      lines.push("");
      lines.push(card.body || "");
      if (card.evidenceLevel || card.riskLevel || card.status) {
        lines.push("");
        lines.push(`- status: ${card.status || "draft"}`);
        if (card.evidenceLevel) lines.push(`- evidence: ${card.evidenceLevel}`);
        if (card.riskLevel) lines.push(`- risk: ${card.riskLevel}`);
      }
      (card.details || []).forEach((detail) => lines.push(`- ${detail}`));
    });
    lines.push("");
    lines.push("## Initiatives");
    state.initiatives.forEach((item) => {
      lines.push("");
      lines.push(`### ${item.title}`);
      lines.push(item.description || "");
      lines.push(`- hypothesis: ${item.hypothesis || item.relatedAssumption || ""}`);
      lines.push(`- success: ${item.successCriteria || ""}`);
      lines.push(`- timebox: ${item.timeboxDays || 14} days`);
    });
    lines.push("");
    lines.push("## WorkItems");
    state.workItems.forEach((item) => {
      lines.push("");
      lines.push(`### ${item.title}`);
      lines.push(item.description || "");
      (item.acceptanceCriteria || []).forEach((criterion) => lines.push(`- [ ] ${criterion}`));
    });
    lines.push("");
    lines.push("## Reviews");
    state.reviews.forEach((review) => {
      lines.push("");
      lines.push(`### ${review.title}`);
      lines.push(review.summary);
      (review.recommendations || []).forEach((item) => lines.push(`- ${item}`));
    });
    const graph = activeMemoryGraph();
    lines.push("");
    lines.push("## Memory Graph");
    lines.push("");
    lines.push(`- Nodes: ${graph.nodes.length}`);
    lines.push(`- Edges: ${graph.edges.length}`);
    graph.edges.slice(0, 12).forEach((edge) => {
      const from = graph.nodes.find((node) => node.id === (edge.from_node_id || edge.fromNodeId));
      const to = graph.nodes.find((node) => node.id === (edge.to_node_id || edge.toNodeId));
      lines.push(`- ${from?.title || edge.from_node_id || edge.fromNodeId} --${edge.relation_type || edge.relationType}--> ${to?.title || edge.to_node_id || edge.toNodeId}`);
    });
    return lines.join("\n");
  }

  function refreshExport() {
    state.exportMarkdown = buildMarkdown();
    saveState();
    render();
  }

  async function copyExport() {
    const markdown = buildMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      setToast("Markdownをコピーしました。");
    } catch (_error) {
      const textarea = document.getElementById("markdown-preview");
      textarea?.select();
      setToast("選択しました。");
    }
  }

  function downloadExport() {
    const markdown = buildMarkdown();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(state.project.title || "open-business-os")}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function safeFileName(value) {
    return String(value || "open-business-os")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80);
  }

  function handleNavigation(target) {
    if (!target) return;
    state.activeView = target;
    saveState();
    render();
    if (target === "memory") refreshMemory({ silent: true });
    if (target === "settings") refreshCostSummary({ silent: true });
  }

  app.addEventListener("submit", (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    event.preventDefault();
    const formType = form.getAttribute("data-form");
    if (formType === "setup") startSetup(form, false);
    if (formType === "workspace") saveWorkspace(form);
    if (formType === "api-key") saveApiKey(form);
    if (formType === "review") submitReview(form);
  });

  app.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      handleNavigation(nav.getAttribute("data-nav"));
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.getAttribute("data-action");
    const kind = button.getAttribute("data-kind");
    const id = button.getAttribute("data-id");

    if (action === "sample-start") {
      const form = button.closest("form");
      startSetup(form, true);
    }
    if (action === "use-example") {
      const input = document.getElementById("idea-input");
      if (input) input.value = button.getAttribute("data-idea") || "";
    }
    if (action === "classify-idea") classifyIdea();
    if (action === "save-answers") {
      collectAnswers();
      saveState();
      setToast("回答を保存しました。");
      render();
    }
    if (action === "generate-map") generateMap();
    if (action === "generate-initiatives") generateInitiatives();
    if (action === "approve-item") approveItem(kind, id);
    if (action === "edit-item") {
      state.editing = { kind, id };
      render();
    }
    if (action === "save-edit") saveEdit(kind, id);
    if (action === "cancel-edit") {
      state.editing = null;
      render();
    }
    if (action === "delete-item") deleteItem(kind, id);
    if (action === "deepen-item") deepenItem(kind, id);
    if (action === "add-work-item") addWorkItem();
    if (action === "draft-github-issue") draftGitHubIssue(id);
    if (action === "voice-note") setToast("端末の音声入力キーボードを使って入力できます。");
    if (action === "apply-review") applyReview(button.getAttribute("data-review-id"));
    if (action === "approve-playbook-output") approvePlaybookOutput();
    if (action === "refresh-memory") refreshMemory();
    if (action === "copy-memory-summary") copyMemorySummary();
    if (action === "refresh-export") refreshExport();
    if (action === "copy-export") copyExport();
    if (action === "download-export") downloadExport();
    if (action === "test-provider") testProvider();
  });

  window.addEventListener("beforeunload", saveState);

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  render();
})();
