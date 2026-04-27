import test from "node:test";
import assert from "node:assert/strict";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const API_PREFIX = process.env.API_PREFIX ?? "/api/v1";
const REQUEST_TIMEOUT_MS = Number(process.env.SMOKE_REQUEST_TIMEOUT_MS ?? 10_000);
const POLL_TIMEOUT_MS = Number(process.env.SMOKE_POLL_TIMEOUT_MS ?? 15_000);

const authToken = process.env.SMOKE_AUTH_TOKEN ?? process.env.API_TOKEN;

function apiUrl(path) {
  return `${BASE_URL}${API_PREFIX}${path}`;
}

function publicUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${normalizedPath}`;
}

function headers(extra = {}) {
  return {
    accept: "application/json",
    ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
    ...extra
  };
}

function truncate(value, max = 1_200) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function unwrap(payload, keys = []) {
  if (!payload || typeof payload !== "object") return payload;
  if (payload.data && typeof payload.data === "object") {
    return unwrap(payload.data, keys);
  }
  for (const key of keys) {
    if (payload[key] && typeof payload[key] === "object") {
      return payload[key];
    }
  }
  return payload;
}

function requiredString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  return value;
}

function requiredId(entity, label) {
  assert.ok(entity && typeof entity === "object", `${label} response must be an object`);
  return requiredString(entity.id, `${label}.id`);
}

function optionalNumber(entity, keys) {
  for (const key of keys) {
    const value = entity?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

async function rawRequest(method, path, body, expectedStatuses = [200, 201, 202], extraHeaders = {}) {
  const url = apiUrl(path);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: headers({
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...extraHeaders
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    assert.fail(
      `Could not reach ${url}. Start the API first, or set BASE_URL. Original error: ${error.message}`
    );
  }

  const text = await response.text();
  assert.ok(
    expectedStatuses.includes(response.status),
    `${method} ${url} returned ${response.status}, expected ${expectedStatuses.join(
      "/"
    )}. Body: ${truncate(text)}`
  );

  return { response, text };
}

async function rawPublicRequest(method, path, body, expectedStatuses = [200]) {
  const url = publicUrl(path);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: headers(body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (error) {
    assert.fail(
      `Could not reach ${url}. Start the API/UI server first, or set BASE_URL. Original error: ${error.message}`
    );
  }

  const text = await response.text();
  assert.ok(
    expectedStatuses.includes(response.status),
    `${method} ${url} returned ${response.status}, expected ${expectedStatuses.join(
      "/"
    )}. Body: ${truncate(text)}`
  );

  return { response, text };
}

async function jsonRequest(method, path, body, expectedStatuses, extraHeaders) {
  const { response, text } = await rawRequest(method, path, body, expectedStatuses, extraHeaders);
  if (!text.trim()) return { response, data: {} };

  try {
    return { response, data: JSON.parse(text) };
  } catch (error) {
    assert.fail(`${method} ${apiUrl(path)} must return JSON. Body: ${truncate(text)}`);
  }
}

async function pollPlaybookRun(initialRun) {
  const runId = requiredId(initialRun, "playbookRun");
  let run = initialRun;
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (["pending", "running", "queued"].includes(run.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const { data } = await jsonRequest("GET", `/playbook-runs/${runId}`);
    run = unwrap(data, ["playbookRun", "run"]);
  }

  assert.equal(
    run.status,
    "completed",
    `playbook run ${runId} must complete before smoke workflow continues`
  );
  assert.ok(run.output && typeof run.output === "object", "completed playbook run must include output");
  return run;
}

function assertNoSecretLeak(payload, secret) {
  const serialized = JSON.stringify(payload);
  assert.ok(
    !serialized.includes(secret),
    `API key save response must not include the raw API key. Response: ${truncate(serialized)}`
  );
}

test("MVP API smoke workflow", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const workspaceName = `Smoke Workspace ${suffix}`;
  const oneLiner =
    "Help small product teams turn a vague AI product idea into a two-week validation plan.";

  const healthResponse = await jsonRequest("GET", "/health");
  const health = unwrap(healthResponse.data);
  assert.equal(health.ok, true, "health endpoint must report ok");
  assert.equal(health.service, "open-business-os-api");

  const indexResponse = await rawPublicRequest("GET", "/");
  assert.match(indexResponse.response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(indexResponse.text, /Open Business OS/);
  assert.match(indexResponse.text, /app\.js/);

  const manifestResponse = await rawPublicRequest("GET", "/manifest.webmanifest");
  assert.match(manifestResponse.response.headers.get("content-type") ?? "", /manifest\+json|application\/json/);
  const manifest = JSON.parse(manifestResponse.text);
  assert.equal(manifest.name, "Open Business OS");
  assert.equal(manifest.display, "standalone");

  const workspaceResponse = await jsonRequest("POST", "/workspaces", {
    name: workspaceName,
    slug: `smoke-${suffix}`,
    usage: "oss_project",
    monthlyBudgetUsd: 5
  });
  const workspace = unwrap(workspaceResponse.data, ["workspace"]);
  const workspaceId = requiredId(workspace, "workspace");
  assert.equal(workspace.name, workspaceName);

  const forbiddenApiKeyResponse = await jsonRequest(
    "POST",
    `/workspaces/${workspaceId}/api-keys`,
    {
      provider: "deepseek_direct",
      apiKey: "sk-viewer-should-not-write"
    },
    [403],
    { "x-open-business-os-role": "viewer" }
  );
  assert.equal(
    forbiddenApiKeyResponse.data.error?.code,
    "FORBIDDEN",
    "viewer role must not create workspace API keys"
  );

  const rawApiKey = `sk-test-open-business-os-${suffix}-secret`;
  const apiKeyResponse = await jsonRequest("POST", `/workspaces/${workspaceId}/api-keys`, {
    provider: "deepseek_direct",
    apiKey: rawApiKey
  });
  const apiKeyRecord = unwrap(apiKeyResponse.data, ["apiKey", "key"]);
  requiredId(apiKeyRecord, "apiKey");
  assertNoSecretLeak(apiKeyResponse.data, rawApiKey);
  assert.equal(apiKeyRecord.provider, "deepseek_direct");
  assert.ok(
    apiKeyRecord.keyHint ?? apiKeyRecord.key_hint ?? apiKeyRecord.hint,
    "API key response must include a non-secret key hint"
  );

  const projectResponse = await jsonRequest("POST", "/projects", {
    workspaceId,
    name: `Smoke Project ${suffix}`,
    oneLiner,
    businessType: "b2b_saas"
  });
  const project = unwrap(projectResponse.data, ["project"]);
  const projectId = requiredId(project, "project");
  assert.equal(project.workspaceId ?? project.workspace_id, workspaceId);

  const runResponse = await jsonRequest("POST", "/playbook-runs", {
    workspaceId,
    projectId,
    playbookId: "idea_intake",
    input: { oneLiner }
  });
  await pollPlaybookRun(unwrap(runResponse.data, ["playbookRun", "run"]));

  const businessMapResponse = await jsonRequest("GET", `/projects/${projectId}/business-map`);
  const businessMap = unwrap(businessMapResponse.data, ["businessMap", "business_map"]);
  assert.ok(businessMap.concept && typeof businessMap.concept === "object", "business map needs concept");
  assert.ok(
    Array.isArray(businessMap.targetUsers ?? businessMap.target_users),
    "business map needs target users"
  );
  assert.ok(Array.isArray(businessMap.assumptions), "business map needs assumptions");
  assert.ok(Array.isArray(businessMap.risks), "business map needs risks");

  const highQualityResponse = await jsonRequest(
    "POST",
    "/playbook-runs",
    {
      workspaceId,
      projectId,
      playbookId: "business_map_generation",
      budgetMode: "high_quality",
      input: { oneLiner }
    },
    [409]
  );
  assert.equal(
    highQualityResponse.data.error?.code,
    "TOOL_ACTION_REQUIRES_APPROVAL",
    "high quality playbook runs must require approval"
  );

  const mapRunResponse = await jsonRequest("POST", "/playbook-runs", {
    workspaceId,
    projectId,
    playbookId: "business_map_generation",
    input: { oneLiner }
  });
  const mapRun = await pollPlaybookRun(unwrap(mapRunResponse.data, ["playbookRun", "run"]));
  const approvedMapRunResponse = await jsonRequest(
    "POST",
    `/playbook-runs/${mapRun.id}/approve-output`
  );
  const approvedMapRun = unwrap(approvedMapRunResponse.data, ["playbookRun", "run"]);
  assert.equal(approvedMapRun.status, "applied", "approved playbook output must be applied");
  assert.ok(approvedMapRun.approvedAt ?? approvedMapRun.approved_at, "applied run must include approval metadata");

  const initialGraphResponse = await jsonRequest("GET", `/projects/${projectId}/memory/graph`);
  const initialGraph = unwrap(initialGraphResponse.data, ["memoryGraph", "graph"]);
  assert.ok(Array.isArray(initialGraph.nodes), "memory graph must include nodes");
  assert.ok(Array.isArray(initialGraph.edges), "memory graph must include edges");
  assert.ok(
    initialGraph.nodes.some((node) => node.node_type === "assumption"),
    "memory graph must include assumption nodes"
  );
  assert.ok(
    initialGraph.edges.some((edge) => edge.relation_type === "measured_by"),
    "memory graph must connect assumptions or initiatives to metrics"
  );

  const initiativeResponse = await jsonRequest("POST", `/projects/${projectId}/initiatives`, {
    title: "Validate first-value workflow in two weeks",
    description: "Confirm that a small team can reach a usable plan without a long form.",
    initiativeType: "product",
    hypothesis: "Teams will continue if the first business map is useful within 10 minutes.",
    successCriteria: "At least three test users create and export a plan without help.",
    timeboxDays: 14,
    priority: "high"
  });
  const initiative = unwrap(initiativeResponse.data, ["initiative"]);
  const initiativeId = requiredId(initiative, "initiative");
  assert.equal(initiative.projectId ?? initiative.project_id, projectId);

  const workItemResponse = await jsonRequest("POST", `/projects/${projectId}/work-items`, {
    initiativeId,
    title: "Add first business map export path",
    description:
      "Create the export path so a user can inspect the strategy-to-work-item trace in Markdown.",
    workType: "issue",
    acceptanceCriteria: [
      "Markdown contains the concept, assumptions, initiatives, work items, reviews, and decisions.",
      "The export does not contain provider API keys or hidden secrets."
    ],
    priority: "high"
  });
  const workItem = unwrap(workItemResponse.data, ["workItem", "work_item"]);
  requiredId(workItem, "workItem");
  assert.equal(workItem.projectId ?? workItem.project_id, projectId);
  assert.equal(workItem.initiativeId ?? workItem.initiative_id, initiativeId);

  const githubDraftResponse = await jsonRequest("POST", `/work-items/${workItem.id}/github-issue-draft`, {
    labels: ["open-business-os", "smoke"]
  });
  const githubDraft = unwrap(githubDraftResponse.data, ["toolAction", "tool_action"]);
  requiredId(githubDraft, "githubDraft");
  assert.equal(githubDraft.toolProvider ?? githubDraft.tool_provider, "github");
  assert.equal(githubDraft.actionType ?? githubDraft.action_type, "issue_create");
  assert.equal(
    githubDraft.payload?.source_work_item_id,
    workItem.id,
    "GitHub draft payload must trace back to the source work item"
  );

  const graphResponse = await jsonRequest("GET", `/projects/${projectId}/memory/graph`);
  const graph = unwrap(graphResponse.data, ["memoryGraph", "graph"]);
  assert.ok(
    graph.nodes.some((node) => node.source_entity_type === "work_item" && node.source_entity_id === workItem.id),
    "memory graph must include a work item node"
  );
  assert.ok(
    graph.edges.some((edge) => edge.relation_type === "implements"),
    "memory graph must include WorkItem -> Initiative implements edges"
  );

  const reviewResponse = await jsonRequest("POST", `/projects/${projectId}/reviews`, {
    title: "Smoke biweekly review",
    reviewType: "biweekly",
    summary: "The smoke flow created the project, business map, initiative, and work item.",
    learnings: ["Traceability from initiative to work item is visible."],
    nextActions: ["Review the Markdown export and cost summary."]
  });
  const review = unwrap(reviewResponse.data, ["review"]);
  requiredId(review, "review");
  assert.equal(review.projectId ?? review.project_id, projectId);

  const summaryResponse = await jsonRequest("GET", `/projects/${projectId}/memory/summary`);
  const memorySummary = unwrap(summaryResponse.data, ["memorySummary", "summary"]);
  requiredId(memorySummary, "memorySummary");
  assert.match(memorySummary.body, /Important nodes/);
  assert.ok(Array.isArray(memorySummary.source_node_ids), "memory summary must keep source node ids");

  const toolActionResponse = await jsonRequest("POST", "/tool-actions", {
    workspaceId,
    projectId,
    toolProvider: "github",
    actionType: "issue_create",
    payload: {
      title: "Add first business map export path",
      body: "## Why\nKeep the generated plan traceable before creating an external issue.",
      labels: ["open-business-os", "mvp", "smoke"],
      source_work_item_id: workItem.id
    },
    preview:
      "Create a GitHub issue draft for the export work item. This must stay reviewable before execution."
  });
  const toolAction = unwrap(toolActionResponse.data, ["toolAction", "tool_action"]);
  const toolActionId = requiredId(toolAction, "toolAction");
  assert.equal(toolAction.projectId ?? toolAction.project_id, projectId);
  assert.equal(toolAction.workspaceId ?? toolAction.workspace_id, workspaceId);
  assert.equal(toolAction.status, "draft", "ToolAction must start as a draft");
  assert.equal(toolAction.toolProvider ?? toolAction.tool_provider, "github");

  const projectToolActionsResponse = await jsonRequest("GET", `/projects/${projectId}/tool-actions`);
  const projectToolActions =
    projectToolActionsResponse.data.toolActions ??
    projectToolActionsResponse.data.tool_actions ??
    unwrap(projectToolActionsResponse.data, ["toolActions", "tool_actions"]);
  assert.ok(Array.isArray(projectToolActions), "project ToolAction list must be an array");
  assert.ok(
    projectToolActions.some((item) => item.id === toolActionId),
    "project ToolAction list must include the created draft"
  );

  const unapprovedExecuteResponse = await jsonRequest("POST", `/tool-actions/${toolActionId}/execute`, undefined, [409]);
  assert.equal(
    unapprovedExecuteResponse.data.error?.code,
    "TOOL_ACTION_REQUIRES_APPROVAL",
    "ToolAction execute must reject unapproved actions"
  );

  const approvedToolActionResponse = await jsonRequest("POST", `/tool-actions/${toolActionId}/approve`);
  const approvedToolAction = unwrap(approvedToolActionResponse.data, ["toolAction", "tool_action"]);
  assert.equal(approvedToolAction.status, "approved", "ToolAction must be approved before execution");
  assert.ok(
    approvedToolAction.approvedAt ?? approvedToolAction.approved_at,
    "approved ToolAction must include an approval timestamp"
  );

  const executedToolActionResponse = await jsonRequest("POST", `/tool-actions/${toolActionId}/execute`);
  const executedToolAction = unwrap(executedToolActionResponse.data, ["toolAction", "tool_action"]);
  assert.equal(executedToolAction.status, "completed", "approved ToolAction execution must complete");
  assert.equal(executedToolAction.result?.ok, true, "GitHub ToolAction result must be successful");
  if (!process.env.OPEN_BUSINESS_OS_GITHUB_TOKEN && !process.env.OPEN_BUSINESS_OS_GITHUB_PAT) {
    assert.equal(executedToolAction.result?.mode, "dry_run", "GitHub ToolAction must dry-run without an app GitHub token");
  }
  assert.ok(
    executedToolAction.executedAt ?? executedToolAction.executed_at,
    "completed ToolAction must include an execution timestamp"
  );
  assertNoSecretLeak(executedToolAction, rawApiKey);

  const projectAfterToolActionResponse = await jsonRequest("GET", `/projects/${projectId}`);
  const workItemsAfterToolAction =
    projectAfterToolActionResponse.data.workItems ?? projectAfterToolActionResponse.data.work_items ?? [];
  const updatedWorkItem = workItemsAfterToolAction.find((item) => item.id === workItem.id);
  assert.ok(updatedWorkItem, "project snapshot must still include the source work item");
  if (executedToolAction.result?.mode === "real") {
    assert.equal(updatedWorkItem.externalProvider ?? updatedWorkItem.external_provider, "github");
    assert.ok(updatedWorkItem.externalUrl ?? updatedWorkItem.external_url, "real GitHub execution must store the issue URL");
  } else {
    assert.equal(updatedWorkItem.externalUrl ?? updatedWorkItem.external_url ?? null, null);
  }

  const exportResponse = await rawRequest("GET", `/projects/${projectId}/export/markdown`, undefined, [200]);
  let markdown = exportResponse.text;
  const contentType = exportResponse.response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const parsed = JSON.parse(exportResponse.text);
    markdown = unwrap(parsed, ["export"]).markdown ?? parsed.markdown;
  }
  assert.equal(typeof markdown, "string", "Markdown export must return text or a markdown field");
  assert.match(markdown, /Business Map|事業マップ/);
  assert.match(markdown, /Initiative|施策/);
  assert.match(markdown, /WorkItem|Work Item|作業|タスク/);
  assert.match(markdown, /Review|レビュー/);
  assert.match(markdown, /Memory Graph/);
  assert.ok(!markdown.includes(rawApiKey), "Markdown export must not leak the raw API key");

  const costResponse = await jsonRequest("GET", `/workspaces/${workspaceId}/costs/summary`);
  const costSummary = unwrap(costResponse.data, ["costSummary", "summary"]);
  const estimatedCost = optionalNumber(costSummary, [
    "estimatedCostUsd",
    "estimated_cost_usd",
    "totalEstimatedCostUsd",
    "total_estimated_cost_usd",
    "monthToDateUsd",
    "month_to_date_usd",
    "currentUsd",
    "current_usd"
  ]);
  assert.notEqual(estimatedCost, undefined, "cost summary must include an estimated cost number");
  assert.ok(estimatedCost >= 0, "estimated cost must be non-negative");
});
