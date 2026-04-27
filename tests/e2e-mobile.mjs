import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { JsonStore } = require("../apps/api/src/store.js");
const { handleApi } = require("../apps/api/src/server.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "apps/web/public");
const originalLiveLlm = process.env.OPEN_BUSINESS_OS_LIVE_LLM;

process.env.OPEN_BUSINESS_OS_LIVE_LLM = "0";

test.after(() => {
  if (originalLiveLlm === undefined) {
    delete process.env.OPEN_BUSINESS_OS_LIVE_LLM;
  } else {
    process.env.OPEN_BUSINESS_OS_LIVE_LLM = originalLiveLlm;
  }
});

async function readPublic(fileName) {
  return readFile(path.join(PUBLIC_DIR, fileName), "utf8");
}

function includesAll(text, values, label) {
  for (const value of values) {
    assert.ok(text.includes(value), `${label} must include ${value}`);
  }
}

test("mobile PWA shell exposes installable, touch-safe workflow assets", async () => {
  const [indexHtml, styles, app, serviceWorker, manifestRaw] = await Promise.all([
    readPublic("index.html"),
    readPublic("styles.css"),
    readPublic("app.js"),
    readPublic("service-worker.js"),
    readPublic("manifest.webmanifest")
  ]);
  const manifest = JSON.parse(manifestRaw);

  assert.match(indexHtml, /<meta name="viewport" content="[^"]*width=device-width[^"]*viewport-fit=cover/);
  assert.match(indexHtml, /<meta name="theme-color" content="#0f172a"/);
  assert.match(indexHtml, /<link rel="manifest" href="\.\/manifest\.webmanifest"/);
  assert.match(indexHtml, /<div id="app" class="app-shell"/);
  assert.match(indexHtml, /<script src="\.\/app\.js" defer><\/script>/);

  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait-primary");
  assert.equal(manifest.start_url, "./index.html");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => String(icon.sizes).includes("192x192")), "manifest needs a 192x192 icon");
  assert.ok(manifest.icons.some((icon) => String(icon.sizes).includes("512x512")), "manifest needs a 512x512 icon");

  includesAll(serviceWorker, ["./index.html", "./styles.css", "./app.js", "./manifest.webmanifest"], "service worker app shell");
  assert.match(serviceWorker, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /caches\.match\("\.\/index\.html"\)/);

  assert.match(styles, /--tap:\s*44px/);
  assert.match(styles, /html\s*{[\s\S]*min-width:\s*320px/);
  assert.match(styles, /\.bottom-nav\s*{[\s\S]*position:\s*fixed/);
  assert.match(styles, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.nav-button\s*{[\s\S]*min-height:\s*68px/);
  assert.match(styles, /@media\s*\(min-width:\s*760px\)/);

  includesAll(app, [
    'const views = ["idea", "intake", "map", "work", "review", "memory", "export", "settings"]',
    'const API_BASE = "/api/v1"',
    'localStorage.setItem(STORE_KEY',
    "delete safeState.provider.apiKey",
    'navigator.serviceWorker.register("./service-worker.js")',
    'data-form="setup"',
    'id="idea-input"',
    'data-action="classify-idea"',
    'data-action="generate-map"',
    'data-action="approve-playbook-output"',
    'data-action="draft-github-issue"',
    'data-action="refresh-export"',
    'data-action="download-export"'
  ], "mobile app workflow");

  includesAll(app, [
    '"/workspaces"',
    '"/projects"',
    '"/playbook-runs"',
    '"/ai-runs"',
    "/workspaces/${encodeURIComponent(state.workspace.id)}/api-keys",
    "/projects/${encodeURIComponent(state.project.id)}/memory/graph",
    "/projects/${encodeURIComponent(state.project.id)}/memory/summary",
    "/playbook-runs/${encodeURIComponent(run.id)}/approve-output",
    "/work-items/${encodeURIComponent(id)}/github-issue-draft"
  ], "mobile app API contract");
});

function createRequest(method, body, headers = {}) {
  const request = new EventEmitter();
  request.method = method;
  request.headers = headers;
  request.socket = { remoteAddress: "127.0.0.1" };

  process.nextTick(() => {
    if (body !== undefined) {
      request.emit("data", Buffer.from(JSON.stringify(body)));
    }
    request.emit("end");
  });

  return request;
}

function createResponse() {
  return {
    status: null,
    headers: {},
    body: "",
    writeHead(status, headers = {}) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    }
  };
}

async function apiCall(store, method, route, body, { expectedStatus = [200, 201] } = {}) {
  const response = createResponse();
  const request = createRequest(method, body);
  const url = new URL(`http://open-business-os.local/api/v1${route}`);

  await handleApi(store, request, response, url);

  const expected = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  if (!expected.includes(response.status)) {
    let payload = null;
    try {
      payload = response.body ? JSON.parse(response.body) : null;
    } catch {
      // Leave payload null; the message below includes the raw response body.
    }
    const error = new Error(
      `${method} ${route} returned ${response.status}, expected ${expected.join("/")}. Body: ${response.body}`
    );
    error.status = response.status;
    error.code = payload?.error?.code || `HTTP_${response.status}`;
    error.details = payload?.error?.details || {};
    throw error;
  }

  const contentType = response.headers["content-type"] || response.headers["Content-Type"] || "";
  return {
    status: response.status,
    headers: response.headers,
    text: response.body,
    data: contentType.includes("application/json") && response.body ? JSON.parse(response.body) : null
  };
}

function unwrap(payload, keys) {
  if (!payload || typeof payload !== "object") return payload;
  for (const key of keys) {
    if (payload[key] && typeof payload[key] === "object") return payload[key];
  }
  if (payload.data && typeof payload.data === "object") return unwrap(payload.data, keys);
  return payload;
}

function requiredId(entity, label) {
  assert.ok(entity && typeof entity === "object", `${label} must be an object`);
  assert.equal(typeof entity.id, "string", `${label}.id must be a string`);
  assert.ok(entity.id.length > 0, `${label}.id must not be empty`);
  return entity.id;
}

function assertNoSecretLeak(payload, secret, label) {
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
  assert.ok(!serialized.includes(secret), `${label} must not leak the raw API key`);
  assert.ok(!serialized.includes("encrypted_key"), `${label} must not expose encrypted_key`);
}

test("browserless mobile workflow reaches export through the API contract", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storePath = path.join(os.tmpdir(), `open-business-os-mobile-e2e-${suffix}.json`);
  const store = await new JsonStore(storePath).init();
  const rawApiKey = `sk-mobile-e2e-${suffix}-secret`;
  const oneLiner = "Help product teams turn a rough mobile PWA idea into a validated two-week plan.";

  try {
    const workspaceResponse = await apiCall(store, "POST", "/workspaces", {
      name: `Mobile E2E ${suffix}`,
      slug: `mobile-e2e-${suffix}`,
      monthlyBudgetUsd: 5
    });
    const workspace = unwrap(workspaceResponse.data, ["workspace"]);
    const workspaceId = requiredId(workspace, "workspace");

    const apiKeyResponse = await apiCall(store, "POST", `/workspaces/${workspaceId}/api-keys`, {
      provider: "deepseek_direct",
      apiKey: rawApiKey
    });
    const apiKey = unwrap(apiKeyResponse.data, ["apiKey", "api_key"]);
    requiredId(apiKey, "apiKey");
    assert.ok(apiKey.keyHint || apiKey.key_hint, "API key response must include a key hint");
    assertNoSecretLeak(apiKeyResponse.data, rawApiKey, "API key save response");

    const apiKeysResponse = await apiCall(store, "GET", `/workspaces/${workspaceId}/api-keys`);
    assertNoSecretLeak(apiKeysResponse.data, rawApiKey, "API key list response");

    const projectResponse = await apiCall(store, "POST", "/projects", {
      workspaceId,
      name: `Mobile PWA Project ${suffix}`,
      oneLiner,
      businessType: "b2b_saas"
    });
    const project = unwrap(projectResponse.data, ["project"]);
    const projectId = requiredId(project, "project");

    const intakeResponse = await apiCall(store, "POST", "/playbook-runs", {
      workspaceId,
      projectId,
      playbookId: "idea_intake",
      input: { oneLiner }
    });
    const intakeRun = unwrap(intakeResponse.data, ["playbookRun", "run"]);
    assert.equal(intakeRun.status, "completed");
    assert.ok(intakeRun.output && typeof intakeRun.output === "object", "intake run must include output");

    await assert.rejects(
      () => apiCall(store, "POST", "/playbook-runs", {
        workspaceId,
        projectId,
        playbookId: "business_map_generation",
        budgetMode: "high_quality",
        input: { oneLiner }
      }),
      (error) => error.code === "TOOL_ACTION_REQUIRES_APPROVAL"
    );

    const mapRunResponse = await apiCall(store, "POST", "/playbook-runs", {
      workspaceId,
      projectId,
      playbookId: "business_map_generation",
      input: { oneLiner }
    });
    const mapRun = unwrap(mapRunResponse.data, ["playbookRun", "run"]);
    const mapRunId = requiredId(mapRun, "mapRun");

    const approveRunResponse = await apiCall(store, "POST", `/playbook-runs/${mapRunId}/approve-output`);
    const approvedRun = unwrap(approveRunResponse.data, ["playbookRun", "run"]);
    assert.equal(approvedRun.status, "applied");
    assert.ok(approvedRun.approvedAt || approvedRun.approved_at, "approved run must include approval metadata");

    const businessMapResponse = await apiCall(store, "GET", `/projects/${projectId}/business-map`);
    const businessMap = unwrap(businessMapResponse.data, ["businessMap", "business_map"]);
    assert.ok(businessMap.concept, "business map must include concept");
    assert.ok(Array.isArray(businessMap.targetUsers || businessMap.target_users), "business map must include target users");
    assert.ok(Array.isArray(businessMap.assumptions), "business map must include assumptions");

    const initiativeResponse = await apiCall(store, "POST", `/projects/${projectId}/initiatives`, {
      title: "Validate mobile first-value workflow",
      description: "Confirm a phone-sized workflow reaches map, work, review, and export.",
      initiativeType: "product",
      hypothesis: "A user can move from one-liner to shareable plan in one session.",
      successCriteria: "The workflow creates a traceable WorkItem and export without leaking secrets.",
      priority: "high"
    });
    const initiative = unwrap(initiativeResponse.data, ["initiative"]);
    const initiativeId = requiredId(initiative, "initiative");

    const workItemResponse = await apiCall(store, "POST", `/projects/${projectId}/work-items`, {
      initiativeId,
      title: "Add mobile export verification",
      description: "Keep the PWA workflow verifiable in CI without a browser download.",
      workType: "issue",
      acceptanceCriteria: [
        "The mobile shell is installable.",
        "Markdown export contains the workflow trace.",
        "ToolAction execution requires approval."
      ],
      priority: "high"
    });
    const workItem = unwrap(workItemResponse.data, ["workItem", "work_item"]);
    const workItemId = requiredId(workItem, "workItem");
    assert.equal(workItem.initiativeId || workItem.initiative_id, initiativeId);

    const githubDraftResponse = await apiCall(store, "POST", `/work-items/${workItemId}/github-issue-draft`, {
      labels: ["open-business-os", "mobile-e2e"]
    });
    const githubDraft = unwrap(githubDraftResponse.data, ["toolAction", "tool_action"]);
    requiredId(githubDraft, "githubDraft");
    assert.equal(githubDraft.status, "draft");
    assert.equal(githubDraft.toolProvider || githubDraft.tool_provider, "github");
    assert.equal(githubDraft.payload?.source_work_item_id, workItemId);

    const toolActionResponse = await apiCall(store, "POST", "/tool-actions", {
      workspaceId,
      projectId,
      toolProvider: "github",
      actionType: "issue_create",
      payload: { title: "Mobile E2E approval gate", source_work_item_id: workItemId },
      preview: "Create a GitHub issue after approval."
    });
    const toolAction = unwrap(toolActionResponse.data, ["toolAction", "tool_action"]);
    const toolActionId = requiredId(toolAction, "toolAction");
    assert.equal(toolAction.status, "draft");

    await assert.rejects(
      () => apiCall(store, "POST", `/tool-actions/${toolActionId}/execute`),
      (error) => error.code === "TOOL_ACTION_REQUIRES_APPROVAL"
    );

    const approvedToolActionResponse = await apiCall(store, "POST", `/tool-actions/${toolActionId}/approve`);
    const approvedToolAction = unwrap(approvedToolActionResponse.data, ["toolAction", "tool_action"]);
    assert.equal(approvedToolAction.status, "approved");

    const executedToolActionResponse = await apiCall(store, "POST", `/tool-actions/${toolActionId}/execute`);
    const executedToolAction = unwrap(executedToolActionResponse.data, ["toolAction", "tool_action"]);
    assert.equal(executedToolAction.status, "completed");
    assertNoSecretLeak(executedToolAction, rawApiKey, "executed ToolAction");

    const reviewResponse = await apiCall(store, "POST", `/projects/${projectId}/reviews`, {
      title: "Mobile E2E review",
      reviewType: "weekly",
      summary: "The browserless E2E path reached review and export.",
      learnings: ["The mobile workflow has a CI-safe contract check."],
      nextActions: ["Run Playwright later for real viewport rendering."]
    });
    const review = unwrap(reviewResponse.data, ["review"]);
    requiredId(review, "review");

    const graphResponse = await apiCall(store, "GET", `/projects/${projectId}/memory/graph`);
    const graph = unwrap(graphResponse.data, ["memoryGraph", "graph"]);
    assert.ok(Array.isArray(graph.nodes), "memory graph must include nodes");
    assert.ok(graph.nodes.some((node) => node.source_entity_type === "work_item" && node.source_entity_id === workItemId));

    const summaryResponse = await apiCall(store, "GET", `/projects/${projectId}/memory/summary`);
    const summary = unwrap(summaryResponse.data, ["memorySummary", "summary"]);
    requiredId(summary, "memorySummary");
    assert.match(summary.body, /Important nodes/);

    const exportResponse = await apiCall(store, "GET", `/projects/${projectId}/export/markdown`, undefined, {
      expectedStatus: 200
    });
    assert.match(exportResponse.headers["content-type"] || "", /text\/markdown/);
    assert.match(exportResponse.text, /Business Map|事業マップ/);
    assert.match(exportResponse.text, /Initiative|施策/);
    assert.match(exportResponse.text, /WorkItem|Work Item|タスク/);
    assert.match(exportResponse.text, /Review|レビュー/);
    assert.match(exportResponse.text, /Memory Graph/);
    assertNoSecretLeak(exportResponse.text, rawApiKey, "Markdown export");

    const costResponse = await apiCall(store, "GET", `/workspaces/${workspaceId}/costs/summary`);
    const costSummary = unwrap(costResponse.data, ["costSummary", "summary"]);
    assert.equal(typeof (costSummary.estimatedCostUsd ?? costSummary.estimated_cost_usd), "number");
    assert.ok((costSummary.estimatedCostUsd ?? costSummary.estimated_cost_usd) >= 0);
  } finally {
    await rm(storePath, { force: true });
  }
});
