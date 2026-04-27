"use strict";

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const {
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  createAuditLog,
  createId,
  nowIso,
  publicApiKey
} = require("./store");
const { createStore } = require("./repositories");
const { encryptSecret, decryptSecret, keyHint } = require("./security");
const { can } = require("../../../packages/security/src");
const {
  buildDeepSeekChatRequest,
  callDeepSeek,
  estimateCost,
  estimateRunCost,
  estimateTokens,
  sampleBusinessMap,
  sampleForTask,
  sampleInitiatives
} = require("../../../packages/llm-gateway/src");
const {
  validateBusinessMapOutput,
  validateEngineeringStateAnalysisOutput,
  validateInitiativeGenerationOutput
} = require("../../../packages/schemas/src");

const PORT = Number(process.env.PORT || 3000);
const API_PREFIX = "/api/v1";
const ROOT_DIR = path.resolve(__dirname, "../../..");
const WEB_DIR = path.join(ROOT_DIR, "apps/web/public");

function toSlug(value) {
  return String(value || "workspace")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `workspace-${Date.now()}`;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(Object.assign(new Error("Request body too large."), { code: "VALIDATION_ERROR" }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { code: "VALIDATION_ERROR" }));
      }
    });
    request.on("error", reject);
  });
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, headers);
  response.end(body);
}

function sendJson(response, status, payload, headers = {}) {
  send(response, status, JSON.stringify(payload, null, 2), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
}

function sendError(response, status, code, message, details = {}) {
  sendJson(response, status, { error: { code, message, details } });
}

function notFound(response) {
  sendError(response, 404, "NOT_FOUND", "The requested resource was not found.");
}

function statusForErrorCode(code) {
  return {
    NOT_FOUND: 404,
    VALIDATION_ERROR: 400,
    SCHEMA_VALIDATION_FAILED: 422,
    TOOL_ACTION_REQUIRES_APPROVAL: 409,
    BUDGET_EXCEEDED: 402,
    FORBIDDEN: 403,
    UNAUTHORIZED: 401,
    LLM_PROVIDER_ERROR: 502,
    LLM_RATE_LIMITED: 429
  }[code] || 500;
}

function requireField(body, field) {
  if (body[field] === undefined || body[field] === null || body[field] === "") {
    const error = new Error(`${field} is required.`);
    error.code = "VALIDATION_ERROR";
    throw error;
  }
  return body[field];
}

function projectFor(data, projectId) {
  return data.projects.find((project) => project.id === projectId);
}

function workspaceFor(data, workspaceId) {
  return data.workspaces.find((workspace) => workspace.id === workspaceId);
}

function roleForWorkspace(data, request, workspaceId) {
  const requestedRole = request.headers["x-open-business-os-role"];
  if (requestedRole) return String(requestedRole).toLowerCase();
  return data.workspace_memberships.find(
    (membership) => membership.workspace_id === workspaceId && membership.user_id === DEFAULT_USER_ID
  )?.role || "viewer";
}

function requireWorkspacePermission(data, request, workspaceId, action) {
  const role = roleForWorkspace(data, request, workspaceId);
  if (!can(role, action)) {
    const error = new Error(`Role ${role || "none"} cannot perform ${action}.`);
    error.code = "FORBIDDEN";
    error.details = { workspaceId, action, role };
    throw error;
  }
  return role;
}

function exposeWorkspace(workspace) {
  return {
    ...workspace,
    ownerUserId: workspace.owner_user_id,
    defaultBudgetMode: workspace.default_budget_mode,
    monthlyBudgetUsd: workspace.monthly_budget_usd,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at
  };
}

function exposeProject(project) {
  return {
    ...project,
    workspaceId: project.workspace_id,
    oneLiner: project.one_liner,
    businessType: project.business_type,
    createdBy: project.created_by,
    createdAt: project.created_at,
    updatedAt: project.updated_at
  };
}

function exposeInitiative(initiative) {
  return {
    ...initiative,
    projectId: initiative.project_id,
    initiativeType: initiative.initiative_type,
    successCriteria: initiative.success_criteria,
    relatedMetricId: initiative.related_metric_id,
    relatedAssumptionId: initiative.related_assumption_id,
    createdBy: initiative.created_by,
    createdAt: initiative.created_at,
    updatedAt: initiative.updated_at
  };
}

function exposeWorkItem(workItem) {
  return {
    ...workItem,
    projectId: workItem.project_id,
    initiativeId: workItem.initiative_id,
    acceptanceCriteria: workItem.acceptance_criteria,
    workType: workItem.work_type,
    assigneeUserId: workItem.assignee_user_id,
    externalProvider: workItem.external_provider,
    externalId: workItem.external_id,
    externalUrl: workItem.external_url,
    createdBy: workItem.created_by,
    createdAt: workItem.created_at,
    updatedAt: workItem.updated_at
  };
}

function buildGitHubIssueDraft(project, initiative, workItem, options = {}) {
  const labels = Array.isArray(options.labels) && options.labels.length
    ? options.labels
    : ["open-business-os", workItem.priority || "medium", workItem.work_type || "task"];
  const criteria = Array.isArray(workItem.acceptance_criteria) ? workItem.acceptance_criteria : [];
  const body = [
    "## Context",
    project?.one_liner || "Created from Open Business OS.",
    "",
    initiative ? `Initiative: ${initiative.title}` : null,
    workItem.description ? `\n## Description\n${workItem.description}` : null,
    criteria.length ? `\n## Acceptance Criteria\n${criteria.map((criterion) => `- [ ] ${criterion}`).join("\n")}` : null,
    "",
    "## Trace",
    `- project_id: ${project?.id || ""}`,
    initiative ? `- initiative_id: ${initiative.id}` : null,
    `- work_item_id: ${workItem.id}`
  ].filter(Boolean).join("\n");

  return {
    title: options.title || workItem.title,
    body: options.body || body,
    labels,
    preview: `GitHub issue draft: ${workItem.title}`
  };
}

function exposeReview(review) {
  return {
    ...review,
    projectId: review.project_id,
    reviewType: review.review_type,
    periodStart: review.period_start,
    periodEnd: review.period_end,
    createdBy: review.created_by,
    createdAt: review.created_at
  };
}

function exposeApiKey(apiKey) {
  const publicKey = publicApiKey(apiKey);
  return {
    ...publicKey,
    workspaceId: publicKey.workspace_id,
    keyHint: publicKey.key_hint,
    createdBy: publicKey.created_by,
    createdAt: publicKey.created_at,
    updatedAt: publicKey.updated_at
  };
}

function exposePlaybookRun(run) {
  return {
    ...run,
    workspaceId: run.workspace_id,
    projectId: run.project_id,
    playbookId: run.playbook_id,
    createdBy: run.created_by,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    approvedBy: run.approved_by,
    approvedAt: run.approved_at,
    appliedAt: run.applied_at,
    memorySummaryId: run.memory_summary_id,
    createdAt: run.created_at
  };
}

function addAudit(data, request, workspaceId, action, entityType, entityId, metadata = {}) {
  data.audit_logs.push(createAuditLog({
    workspaceId,
    action,
    entityType,
    entityId,
    metadata,
    request
  }));
}

function currentMonthLedger(data, workspaceId) {
  const prefix = new Date().toISOString().slice(0, 7);
  return data.cost_ledger.filter(
    (entry) => entry.workspace_id === workspaceId && String(entry.created_at || "").startsWith(prefix)
  );
}

function costSummary(data, workspaceId) {
  const workspace = workspaceFor(data, workspaceId);
  const ledger = currentMonthLedger(data, workspaceId);
  const total = ledger.reduce((sum, entry) => sum + Number(entry.estimated_cost_usd || 0), 0);
  const inputTokens = ledger.reduce((sum, entry) => sum + Number(entry.input_tokens || 0), 0);
  const outputTokens = ledger.reduce((sum, entry) => sum + Number(entry.output_tokens || 0), 0);
  const monthlyBudgetUsd = Number(workspace?.monthly_budget_usd || 0);
  const remainingUsd = monthlyBudgetUsd ? Math.max(0, Number((monthlyBudgetUsd - total).toFixed(6))) : null;
  return {
    workspace_id: workspaceId,
    workspaceId,
    estimated_cost_usd: Number(total.toFixed(6)),
    estimatedCostUsd: Number(total.toFixed(6)),
    month_to_date_usd: Number(total.toFixed(6)),
    monthToDateUsd: Number(total.toFixed(6)),
    monthly_budget_usd: monthlyBudgetUsd,
    monthlyBudgetUsd,
    remaining_usd: remainingUsd,
    remainingUsd,
    budget_exceeded: Boolean(monthlyBudgetUsd && total > monthlyBudgetUsd),
    budgetExceeded: Boolean(monthlyBudgetUsd && total > monthlyBudgetUsd),
    input_tokens: inputTokens,
    inputTokens,
    output_tokens: outputTokens,
    outputTokens,
    ai_run_count: ledger.length,
    aiRunCount: ledger.length
  };
}

function validateLlmOutputForTask(task, output) {
  let validation = null;
  if (task === "business_map_generation" || task === "metric_design" || task === "assumption_extraction") {
    validation = validateBusinessMapOutput(output);
  } else if (task === "initiative_generation" || task === "implementation_breakdown") {
    validation = validateInitiativeGenerationOutput(output);
  } else if (task === "engineering_state_analysis") {
    validation = validateEngineeringStateAnalysisOutput(output);
  }

  if (validation && !validation.ok) {
    const error = new Error(`${validation.schemaName} validation failed.`);
    error.code = "SCHEMA_VALIDATION_FAILED";
    error.details = { errors: validation.errors };
    throw error;
  }

  return output;
}

function estimatePlannedAiCost({ model, input, maxOutputTokens = 1600 }) {
  const inputTokens = estimateTokens(input);
  const outputTokens = Math.max(1, Number(maxOutputTokens || 1600));
  return {
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCost({ model, inputTokens, outputTokens })
  };
}

function enforceBudget(data, { workspaceId, model, input, maxOutputTokens, approvedHighCost = false, budgetMode = "cheap", task }) {
  if (budgetMode === "high_quality" && !approvedHighCost) {
    const error = new Error("High quality AI execution requires explicit approval.");
    error.code = "TOOL_ACTION_REQUIRES_APPROVAL";
    error.details = { task, budgetMode };
    throw error;
  }

  const workspace = workspaceFor(data, workspaceId);
  const monthlyBudgetUsd = Number(workspace?.monthly_budget_usd || 0);
  if (!monthlyBudgetUsd) {
    return estimatePlannedAiCost({ model, input, maxOutputTokens });
  }

  const estimate = estimatePlannedAiCost({ model, input, maxOutputTokens });
  const currentUsd = costSummary(data, workspaceId).estimatedCostUsd;
  if (Number((currentUsd + estimate.estimatedCostUsd).toFixed(6)) > monthlyBudgetUsd) {
    const error = new Error("Monthly AI budget exceeded.");
    error.code = "BUDGET_EXCEEDED";
    error.details = {
      limitUsd: monthlyBudgetUsd,
      currentUsd,
      estimatedRunUsd: estimate.estimatedCostUsd,
      model,
      task
    };
    throw error;
  }
  return estimate;
}

function findMemoryNode(data, sourceEntityType, sourceEntityId) {
  return data.memory_nodes.find(
    (node) => node.source_entity_type === sourceEntityType && node.source_entity_id === sourceEntityId
  );
}

function upsertMemoryNode(data, input) {
  const now = nowIso();
  const existing = input.source_entity_type && input.source_entity_id
    ? findMemoryNode(data, input.source_entity_type, input.source_entity_id)
    : null;
  const node = existing || {
    id: createId(),
    workspace_id: input.workspace_id,
    project_id: input.project_id || null,
    node_type: input.node_type,
    source_entity_type: input.source_entity_type || null,
    source_entity_id: input.source_entity_id || null,
    created_by: input.created_by || DEFAULT_USER_ID,
    created_at: now
  };

  Object.assign(node, {
    workspace_id: input.workspace_id,
    project_id: input.project_id || node.project_id || null,
    node_type: input.node_type || node.node_type,
    title: input.title || node.title,
    body: input.body === undefined ? node.body || "" : input.body,
    status: input.status || node.status || "draft",
    importance: input.importance === undefined ? node.importance ?? 0.5 : Number(input.importance),
    confidence: input.confidence === undefined ? node.confidence ?? 0.5 : Number(input.confidence),
    valid_from: input.valid_from || node.valid_from || null,
    valid_until: input.valid_until || node.valid_until || null,
    last_accessed_at: input.last_accessed_at || node.last_accessed_at || null,
    metadata: { ...(node.metadata || {}), ...(input.metadata || {}) },
    updated_at: now
  });

  if (!existing) data.memory_nodes.push(node);
  return node;
}

function upsertMemoryEdge(data, input) {
  if (!input.from_node_id || !input.to_node_id || input.from_node_id === input.to_node_id) return null;
  const existing = data.memory_edges.find(
    (edge) =>
      edge.from_node_id === input.from_node_id &&
      edge.to_node_id === input.to_node_id &&
      edge.relation_type === input.relation_type
  );
  const edge = existing || {
    id: createId(),
    workspace_id: input.workspace_id,
    project_id: input.project_id || null,
    from_node_id: input.from_node_id,
    to_node_id: input.to_node_id,
    relation_type: input.relation_type,
    created_by: input.created_by || DEFAULT_USER_ID,
    created_at: nowIso()
  };

  Object.assign(edge, {
    workspace_id: input.workspace_id,
    project_id: input.project_id || edge.project_id || null,
    strength: input.strength === undefined ? edge.strength ?? 0.5 : Number(input.strength),
    metadata: { ...(edge.metadata || {}), ...(input.metadata || {}) }
  });

  if (!existing) data.memory_edges.push(edge);
  return edge;
}

function memoryNodeForMetric(data, project, metric) {
  return upsertMemoryNode(data, {
    workspace_id: project.workspace_id,
    project_id: project.id,
    node_type: "metric",
    source_entity_type: "metric",
    source_entity_id: metric.id,
    title: metric.name,
    body: metric.description || "",
    status: metric.status === "active" ? "active" : "draft",
    importance: metric.metric_type === "north_star" ? 0.9 : 0.6,
    confidence: 0.6,
    metadata: { metric_type: metric.metric_type, unit: metric.unit }
  });
}

function memoryNodeForAssumption(data, project, assumption) {
  return upsertMemoryNode(data, {
    workspace_id: project.workspace_id,
    project_id: project.id,
    node_type: "assumption",
    source_entity_type: "assumption",
    source_entity_id: assumption.id,
    title: assumption.assumption_type || "assumption",
    body: assumption.statement,
    status: assumption.status === "supported" ? "supported" : assumption.status === "rejected" ? "rejected" : "active",
    importance: assumption.risk_level === "critical" ? 0.95 : assumption.risk_level === "high" ? 0.85 : 0.65,
    confidence: { none: 0.2, weak: 0.4, medium: 0.65, strong: 0.85 }[assumption.evidence_level] || 0.4,
    metadata: {
      assumption_type: assumption.assumption_type,
      risk_level: assumption.risk_level,
      evidence_level: assumption.evidence_level
    }
  });
}

function memoryNodeForInitiative(data, project, initiative) {
  return upsertMemoryNode(data, {
    workspace_id: project.workspace_id,
    project_id: project.id,
    node_type: "initiative",
    source_entity_type: "initiative",
    source_entity_id: initiative.id,
    title: initiative.title,
    body: initiative.description || initiative.hypothesis || "",
    status: initiative.status === "done" ? "approved" : "draft",
    importance: initiative.priority === "critical" ? 0.9 : initiative.priority === "high" ? 0.8 : 0.55,
    confidence: 0.5,
    metadata: {
      initiative_type: initiative.initiative_type,
      priority: initiative.priority,
      success_criteria: initiative.success_criteria
    }
  });
}

function memoryNodeForWorkItem(data, project, workItem) {
  return upsertMemoryNode(data, {
    workspace_id: project.workspace_id,
    project_id: project.id,
    node_type: "work_item",
    source_entity_type: "work_item",
    source_entity_id: workItem.id,
    title: workItem.title,
    body: workItem.description || "",
    status: workItem.status === "done" ? "approved" : "draft",
    importance: workItem.priority === "critical" ? 0.9 : workItem.priority === "high" ? 0.75 : 0.5,
    confidence: 0.5,
    metadata: {
      work_type: workItem.work_type,
      priority: workItem.priority,
      acceptance_criteria: workItem.acceptance_criteria || []
    }
  });
}

function memoryNodeForReview(data, project, review) {
  return upsertMemoryNode(data, {
    workspace_id: project.workspace_id,
    project_id: project.id,
    node_type: "review",
    source_entity_type: "review",
    source_entity_id: review.id,
    title: review.title,
    body: review.summary || "",
    status: "active",
    importance: 0.7,
    confidence: 0.7,
    metadata: {
      review_type: review.review_type,
      learnings: review.learnings || [],
      next_actions: review.next_actions || []
    }
  });
}

function connectProjectMemoryGraph(data, project) {
  const metrics = data.metrics.filter((metric) => metric.project_id === project.id);
  const assumptions = data.assumptions.filter((assumption) => assumption.project_id === project.id);
  const initiatives = data.initiatives.filter((initiative) => initiative.project_id === project.id);
  const workItems = data.work_items.filter((workItem) => workItem.project_id === project.id);
  const reviews = data.reviews.filter((review) => review.project_id === project.id);

  const metricNodes = new Map(metrics.map((metric) => [metric.id, memoryNodeForMetric(data, project, metric)]));
  const assumptionNodes = new Map(assumptions.map((assumption) => [assumption.id, memoryNodeForAssumption(data, project, assumption)]));
  const initiativeNodes = new Map(initiatives.map((initiative) => [initiative.id, memoryNodeForInitiative(data, project, initiative)]));
  const workItemNodes = new Map(workItems.map((workItem) => [workItem.id, memoryNodeForWorkItem(data, project, workItem)]));
  const reviewNodes = new Map(reviews.map((review) => [review.id, memoryNodeForReview(data, project, review)]));

  for (const assumption of assumptions) {
    const assumptionNode = assumptionNodes.get(assumption.id);
    const metricNode = assumption.related_metric_id ? metricNodes.get(assumption.related_metric_id) : metricNodes.values().next().value;
    if (assumptionNode && metricNode) {
      upsertMemoryEdge(data, {
        workspace_id: project.workspace_id,
        project_id: project.id,
        from_node_id: assumptionNode.id,
        to_node_id: metricNode.id,
        relation_type: "measured_by",
        strength: 0.65
      });
    }
  }

  for (const initiative of initiatives) {
    const initiativeNode = initiativeNodes.get(initiative.id);
    const assumptionNode = initiative.related_assumption_id
      ? assumptionNodes.get(initiative.related_assumption_id)
      : findBestAssumptionNode(assumptions, assumptionNodes, initiative.hypothesis || initiative.description || "");
    const metricNode = initiative.related_metric_id ? metricNodes.get(initiative.related_metric_id) : metricNodes.values().next().value;

    if (initiativeNode && assumptionNode) {
      upsertMemoryEdge(data, {
        workspace_id: project.workspace_id,
        project_id: project.id,
        from_node_id: initiativeNode.id,
        to_node_id: assumptionNode.id,
        relation_type: "derived_from",
        strength: 0.7
      });
    }
    if (initiativeNode && metricNode) {
      upsertMemoryEdge(data, {
        workspace_id: project.workspace_id,
        project_id: project.id,
        from_node_id: initiativeNode.id,
        to_node_id: metricNode.id,
        relation_type: "measured_by",
        strength: 0.55
      });
    }
  }

  for (const workItem of workItems) {
    const workNode = workItemNodes.get(workItem.id);
    const initiativeNode = workItem.initiative_id ? initiativeNodes.get(workItem.initiative_id) : null;
    if (workNode && initiativeNode) {
      upsertMemoryEdge(data, {
        workspace_id: project.workspace_id,
        project_id: project.id,
        from_node_id: workNode.id,
        to_node_id: initiativeNode.id,
        relation_type: "implements",
        strength: 0.85
      });
    }
  }

  const assumptionNodeList = Array.from(assumptionNodes.values());
  for (const review of reviews) {
    const reviewNode = reviewNodes.get(review.id);
    if (!reviewNode) continue;
    const rejected = /棄却|却下|reject|failed|失敗/i.test(`${review.summary || ""} ${(review.learnings || []).join(" ")}`);
    for (const assumptionNode of assumptionNodeList.slice(0, 3)) {
      upsertMemoryEdge(data, {
        workspace_id: project.workspace_id,
        project_id: project.id,
        from_node_id: assumptionNode.id,
        to_node_id: reviewNode.id,
        relation_type: rejected ? "rejected_because" : "validated_by",
        strength: rejected ? 0.75 : 0.45
      });
    }
  }

  return memoryGraphForProject(data, project.id);
}

function findBestAssumptionNode(assumptions, assumptionNodes, text) {
  const normalized = String(text || "").toLowerCase();
  const exact = assumptions.find((assumption) => normalized.includes(String(assumption.statement || "").slice(0, 24).toLowerCase()));
  if (exact) return assumptionNodes.get(exact.id);
  return assumptionNodes.values().next().value;
}

function memoryGraphForProject(data, projectId) {
  const nodes = data.memory_nodes.filter((node) => node.project_id === projectId);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = data.memory_edges.filter(
    (edge) => edge.project_id === projectId && nodeIds.has(edge.from_node_id) && nodeIds.has(edge.to_node_id)
  );
  return { nodes, edges };
}

function getWorkspaceApiKey(data, workspaceId, provider = "deepseek_direct") {
  const stored = data.api_keys.find(
    (key) => key.workspace_id === workspaceId && key.provider === provider && key.status === "active"
  );
  if (stored?.encrypted_key) {
    return decryptSecret(stored.encrypted_key);
  }
  if (provider === "deepseek_direct" && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY;
  }
  return null;
}

function createAiAccounting(data, { workspaceId, projectId, task, input, output, provider = "sample", model = "sample-local", budgetMode = "cheap", status = "success", error = null }) {
  const usage = estimateRunCost({ model, input, output });
  const aiRun = {
    id: createId(),
    workspace_id: workspaceId,
    project_id: projectId || null,
    playbook_run_id: null,
    task,
    provider,
    model,
    budget_mode: budgetMode,
    prompt_hash: null,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_hit_tokens: usage.cacheHitTokens,
    estimated_cost_usd: usage.estimatedCostUsd,
    latency_ms: 0,
    status,
    error,
    created_by: DEFAULT_USER_ID,
    created_at: nowIso()
  };
  data.ai_runs.push(aiRun);
  data.cost_ledger.push({
    id: createId(),
    workspace_id: workspaceId,
    project_id: projectId || null,
    ai_run_id: aiRun.id,
    provider,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_hit_tokens: usage.cacheHitTokens,
    estimated_cost_usd: usage.estimatedCostUsd,
    created_at: nowIso()
  });
  return { aiRun, usage };
}

function memoryContextForRun(data, project) {
  if (!project) return null;
  const summary = refreshProjectMemorySummary(data, project);
  return {
    id: summary.id,
    summary_type: summary.summary_type,
    body: summary.body,
    source_node_ids: summary.source_node_ids,
    source_edge_ids: summary.source_edge_ids,
    token_estimate: summary.token_estimate,
    version: summary.version
  };
}

async function generatePlaybookOutput(data, { workspaceId, project, task, input, budgetMode = "cheap", approvedHighCost = false }) {
  const liveEnabled = process.env.OPEN_BUSINESS_OS_LIVE_LLM === "1";
  const model = budgetMode === "high_quality" || task === "critical_strategy_review" || task === "security_review"
    ? "deepseek-v4-pro"
    : "deepseek-v4-flash";
  const maxOutputTokens = task === "critical_strategy_review" ? 4000 : task === "implementation_breakdown" ? 2500 : 2200;
  const memoryContext = memoryContextForRun(data, project);
  const effectiveInput = memoryContext
    ? { ...input, project_memory_summary: memoryContext }
    : input;

  if (budgetMode === "high_quality" && !approvedHighCost) {
    const error = new Error("High quality AI execution requires explicit approval.");
    error.code = "TOOL_ACTION_REQUIRES_APPROVAL";
    error.details = { task, budgetMode };
    throw error;
  }

  if (!liveEnabled) {
    const output = sampleForTask(task, effectiveInput);
    validateLlmOutputForTask(task, output);
    return {
      output,
      provider: "sample",
      model: "sample-local",
      input: effectiveInput,
      memoryContext
    };
  }

  enforceBudget(data, {
    workspaceId,
    model,
    input: effectiveInput,
    maxOutputTokens,
    approvedHighCost,
    budgetMode,
    task
  });

  const apiKey = getWorkspaceApiKey(data, workspaceId, "deepseek_direct");
  if (!apiKey) {
    const error = new Error("DeepSeek API key is required for live LLM execution.");
    error.code = "LLM_PROVIDER_ERROR";
    throw error;
  }

  const request = buildDeepSeekChatRequest({
    model,
    system: [
      "You are Open Business OS. Return only valid JSON for the requested playbook.",
      "Separate facts, assumptions, recommendations, and decisions. Do not execute tools."
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          task,
          project: project ? { id: project.id, name: project.name, one_liner: project.one_liner } : null,
          memory_context: memoryContext,
          input: effectiveInput
        })
      }
    ],
    responseFormat: "json",
    maxOutputTokens
  });

  const response = await callDeepSeek({
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    request
  });
  const content = response.choices?.[0]?.message?.content || "{}";

  try {
    const output = JSON.parse(content);
    validateLlmOutputForTask(task, output);
    return {
      output,
      provider: "deepseek_direct",
      model,
      input: effectiveInput,
      memoryContext
    };
  } catch (parseError) {
    const error = new Error("DeepSeek response was not valid JSON.");
    error.code = "SCHEMA_VALIDATION_FAILED";
    error.details = { parseError: parseError.message };
    throw error;
  }
}

function applyBusinessMapOutput(data, project, output, { status = "draft", approvedBy = null } = {}) {
  const validation = validateBusinessMapOutput(output);
  if (!validation.ok) {
    const error = new Error("BusinessMapOutput failed validation.");
    error.code = "SCHEMA_VALIDATION_FAILED";
    error.details = validation.errors;
    throw error;
  }

  const now = nowIso();
  const existingMap = data.business_maps.find((map) => map.project_id === project.id && map.status !== "archived");
  const businessMap = existingMap || {
    id: createId(),
    project_id: project.id,
    created_by: DEFAULT_USER_ID,
    created_at: now
  };
  Object.assign(businessMap, {
    status,
    output,
    approved_by: approvedBy || businessMap.approved_by || null,
    approved_at: approvedBy ? now : businessMap.approved_at || null,
    updated_at: now
  });
  if (!existingMap) data.business_maps.push(businessMap);

  let northStar = data.metrics.find((metric) => metric.project_id === project.id && metric.metric_type === "north_star");
  if (!northStar) {
    northStar = {
      id: createId(),
      project_id: project.id,
      metric_type: "north_star",
      unit: "count",
      target_value: null,
      current_value: 0,
      target_date: null,
      parent_metric_id: null,
      created_at: now
    };
    data.metrics.push(northStar);
  }
  Object.assign(northStar, {
    name: output.northStarMetric.name,
    description: output.northStarMetric.definition,
    status: status === "approved" ? "active" : "draft",
    updated_at: now
  });

  for (const assumption of output.assumptions) {
    let stored = data.assumptions.find((item) => item.project_id === project.id && item.statement === assumption.statement);
    if (!stored) {
      stored = {
        id: createId(),
        project_id: project.id,
        statement: assumption.statement,
        created_by: DEFAULT_USER_ID,
        created_at: now
      };
      data.assumptions.push(stored);
    }
    Object.assign(stored, {
      assumption_type: assumption.type,
      evidence_level: assumption.evidenceLevel,
      status: stored.status === "supported" || stored.status === "rejected" ? stored.status : "unverified",
      risk_level: assumption.riskLevel,
      related_metric_id: northStar.id,
      updated_at: now
    });
  }

  connectProjectMemoryGraph(data, project);
  return output;
}

function ensureBusinessMap(data, project) {
  const existing = data.business_maps.find((map) => map.project_id === project.id && map.status !== "archived");
  if (existing) {
    connectProjectMemoryGraph(data, project);
    return existing.output;
  }

  const output = sampleBusinessMap({ one_liner: project.one_liner, project });
  applyBusinessMapOutput(data, project, output);
  createAiAccounting(data, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    task: "business_map_generation",
    input: project.one_liner,
    output
  });
  return output;
}

function createInitiativesFromOutput(data, project, output) {
  const validation = validateInitiativeGenerationOutput(output);
  if (!validation.ok) {
    const error = new Error("InitiativeGenerationOutput failed validation.");
    error.code = "SCHEMA_VALIDATION_FAILED";
    error.details = validation.errors;
    throw error;
  }

  const createdInitiatives = [];
  const createdWorkItems = [];
  const metrics = data.metrics.filter((metric) => metric.project_id === project.id);
  const assumptions = data.assumptions.filter((assumption) => assumption.project_id === project.id);
  for (const item of output.initiatives) {
    const relatedAssumption = assumptions.find((assumption) =>
      item.relatedAssumption &&
      (assumption.statement === item.relatedAssumption ||
        assumption.statement.includes(item.relatedAssumption) ||
        item.relatedAssumption.includes(assumption.statement.slice(0, 32)))
    ) || assumptions[0] || null;
    const relatedMetric = metrics.find((metric) =>
      item.relatedMetric &&
      (metric.name === item.relatedMetric || metric.name.includes(item.relatedMetric) || item.relatedMetric.includes(metric.name))
    ) || metrics.find((metric) => metric.metric_type === "north_star") || metrics[0] || null;
    const initiative = {
      id: createId(),
      project_id: project.id,
      title: item.title,
      description: item.description,
      initiative_type: item.initiativeType,
      hypothesis: item.hypothesis,
      success_criteria: item.successCriteria,
      start_date: null,
      due_date: null,
      status: "draft",
      priority: item.priority,
      related_metric_id: relatedMetric?.id || null,
      related_assumption_id: relatedAssumption?.id || null,
      created_by: DEFAULT_USER_ID,
      created_at: nowIso(),
      updated_at: nowIso()
    };
    data.initiatives.push(initiative);
    createdInitiatives.push(initiative);

    for (const work of item.workItems) {
      const workItem = {
        id: createId(),
        project_id: project.id,
        initiative_id: initiative.id,
        title: work.title,
        description: work.description,
        acceptance_criteria: work.acceptanceCriteria,
        work_type: work.workType,
        status: "draft",
        priority: work.priority,
        assignee_user_id: null,
        external_provider: null,
        external_id: null,
        external_url: null,
        created_by: DEFAULT_USER_ID,
        created_at: nowIso(),
        updated_at: nowIso()
      };
      data.work_items.push(workItem);
      createdWorkItems.push(workItem);
    }
  }

  createAiAccounting(data, {
    workspaceId: project.workspace_id,
    projectId: project.id,
    task: "initiative_generation",
    input: project.one_liner,
    output
  });
  connectProjectMemoryGraph(data, project);
  return { initiatives: createdInitiatives, workItems: createdWorkItems };
}

function applyPlaybookRunOutput(data, run, approvedBy = DEFAULT_USER_ID) {
  if (run.status === "applied") {
    const error = new Error("PlaybookRun output has already been applied.");
    error.code = "VALIDATION_ERROR";
    error.details = { runId: run.id, status: run.status };
    throw error;
  }
  const project = run.project_id ? projectFor(data, run.project_id) : null;
  if (!project) {
    const error = new Error("PlaybookRun is not attached to a project.");
    error.code = "VALIDATION_ERROR";
    error.details = { runId: run.id };
    throw error;
  }

  let applied = null;
  if (run.playbook_id === "business_map_generation") {
    applied = {
      businessMap: applyBusinessMapOutput(data, project, run.output, {
        status: "approved",
        approvedBy
      })
    };
  } else if (run.playbook_id === "initiative_generation" || run.playbook_id === "implementation_breakdown") {
    applied = createInitiativesFromOutput(data, project, run.output);
  } else {
    const error = new Error("This playbook output cannot be applied to Project State.");
    error.code = "VALIDATION_ERROR";
    error.details = { playbookId: run.playbook_id };
    throw error;
  }

  run.status = "applied";
  run.approved_by = approvedBy;
  run.approved_at = nowIso();
  run.applied_at = nowIso();
  connectProjectMemoryGraph(data, project);
  return applied;
}

function refreshProjectMemorySummary(data, project) {
  const graph = connectProjectMemoryGraph(data, project);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const importantNodes = graph.nodes
    .slice()
    .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0))
    .slice(0, 12);
  const relationLines = graph.edges.slice(0, 24).map((edge) => {
    const from = nodeById.get(edge.from_node_id);
    const to = nodeById.get(edge.to_node_id);
    return `${from?.title || edge.from_node_id} --${edge.relation_type}--> ${to?.title || edge.to_node_id}`;
  });
  const body = [
    `Project: ${project.name}`,
    "",
    "Important nodes:",
    ...importantNodes.map((node) => `- [${node.node_type}/${node.status}] ${node.title}: ${node.body || ""}`),
    "",
    "Relations:",
    ...relationLines.map((line) => `- ${line}`)
  ].join("\n");

  const summary = {
    id: createId(),
    workspace_id: project.workspace_id,
    project_id: project.id,
    summary_type: "llm_context",
    body,
    source_node_ids: importantNodes.map((node) => node.id),
    source_edge_ids: graph.edges.slice(0, 24).map((edge) => edge.id),
    token_estimate: estimateTokens(body),
    version: data.project_memory_summaries.filter((item) => item.project_id === project.id && item.summary_type === "llm_context").length + 1,
    created_at: nowIso()
  };
  data.project_memory_summaries.push(summary);
  return summary;
}

function markdownForProject(data, project) {
  const businessMap = ensureBusinessMap(data, project);
  const initiatives = data.initiatives.filter((item) => item.project_id === project.id);
  const workItems = data.work_items.filter((item) => item.project_id === project.id);
  const reviews = data.reviews.filter((item) => item.project_id === project.id);
  const assumptions = data.assumptions.filter((item) => item.project_id === project.id);
  const decisions = data.decisions.filter((item) => item.project_id === project.id);
  const graph = connectProjectMemoryGraph(data, project);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  const lines = [
    `# ${project.name}`,
    "",
    "## Business Map",
    "",
    `- Concept: ${businessMap.concept.oneLiner}`,
    `- Business Type: ${businessMap.concept.businessType}`,
    `- Ideal State: ${businessMap.idealState.description}`,
    `- North Star Metric: ${businessMap.northStarMetric.name} - ${businessMap.northStarMetric.definition}`,
    "",
    "### Target Users",
    ...businessMap.targetUsers.map((user) => `- ${user.name}: ${user.description}`),
    "",
    "### Assumptions",
    ...(assumptions.length ? assumptions : businessMap.assumptions).map((assumption) => {
      const statement = assumption.statement;
      const risk = assumption.risk_level || assumption.riskLevel;
      const evidence = assumption.evidence_level || assumption.evidenceLevel;
      return `- [${risk}/${evidence}] ${statement}`;
    }),
    "",
    "### Risks",
    ...businessMap.risks.map((risk) => `- ${risk.title}: ${risk.mitigation}`),
    "",
    "## Initiative / 施策",
    "",
    ...(initiatives.length ? initiatives.map((initiative) => `- ${initiative.title}: ${initiative.success_criteria || initiative.successCriteria || ""}`) : ["- 未作成"]),
    "",
    "## WorkItem / タスク",
    "",
    ...(workItems.length ? workItems.flatMap((workItem) => [
      `### ${workItem.title}`,
      "",
      workItem.description || "",
      "",
      ...(workItem.acceptance_criteria || []).map((criterion) => `- [ ] ${criterion}`),
      ""
    ]) : ["- 未作成"]),
    "",
    "## Review / レビュー",
    "",
    ...(reviews.length ? reviews.map((review) => `- ${review.title}: ${review.summary}`) : ["- 未作成"]),
    "",
    "## Decision Log",
    "",
    ...(decisions.length ? decisions.map((decision) => `- ${decision.title}: ${decision.decision}`) : ["- 未作成"]),
    "",
    "## Memory Graph",
    "",
    `- Nodes: ${graph.nodes.length}`,
    `- Edges: ${graph.edges.length}`,
    "",
    ...graph.edges.slice(0, 16).map((edge) => {
      const from = nodeById.get(edge.from_node_id);
      const to = nodeById.get(edge.to_node_id);
      return `- ${from?.title || edge.from_node_id} --${edge.relation_type}--> ${to?.title || edge.to_node_id}`;
    }),
    ""
  ];

  return lines.join("\n");
}

async function serveStatic(request, response, pathname) {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const absolutePath = path.resolve(WEB_DIR, relativePath);
  if (!absolutePath.startsWith(WEB_DIR)) {
    notFound(response);
    return;
  }

  try {
    const stat = await fs.stat(absolutePath);
    const filePath = stat.isDirectory() ? path.join(absolutePath, "index.html") : absolutePath;
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    send(response, 200, content, {
      "content-type": contentTypes[ext] || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
  } catch {
    if (!path.extname(pathname)) {
      try {
        const index = await fs.readFile(path.join(WEB_DIR, "index.html"));
        send(response, 200, index, { "content-type": "text/html; charset=utf-8" });
        return;
      } catch {
        // Fall through to JSON not found.
      }
    }
    notFound(response);
  }
}

async function handleApi(store, request, response, url) {
  const method = request.method || "GET";
  const pathname = url.pathname.slice(API_PREFIX.length) || "/";
  const parts = pathname.split("/").filter(Boolean);

  if (method === "GET" && pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "open-business-os-api" });
    return;
  }

  if (method === "GET" && pathname === "/me") {
    const data = store.snapshot;
    const user = data.users.find((item) => item.id === DEFAULT_USER_ID);
    const memberships = data.workspace_memberships.filter((item) => item.user_id === DEFAULT_USER_ID);
    sendJson(response, 200, { user, memberships });
    return;
  }

  if (method === "GET" && pathname === "/workspaces") {
    sendJson(response, 200, { workspaces: store.repositoriesFor().workspaces.all().map(exposeWorkspace) });
    return;
  }

  if (method === "POST" && pathname === "/workspaces") {
    const body = await readJsonBody(request);
    const result = await store.transaction(async (data) => {
      const now = nowIso();
      const workspace = {
        id: createId(),
        name: requireField(body, "name"),
        slug: toSlug(body.slug || body.name),
        owner_user_id: DEFAULT_USER_ID,
        default_budget_mode: body.defaultBudgetMode || body.default_budget_mode || "cheap",
        monthly_budget_usd: Number(body.monthlyBudgetUsd || body.monthly_budget_usd || 5),
        created_at: now,
        updated_at: now
      };
      data.workspaces.push(workspace);
      data.workspace_memberships.push({
        workspace_id: workspace.id,
        user_id: DEFAULT_USER_ID,
        role: "owner",
        created_at: now
      });
      data.budgets.push({
        id: createId(),
        workspace_id: workspace.id,
        scope: "workspace",
        scope_id: workspace.id,
        limit_usd: workspace.monthly_budget_usd,
        period: "monthly",
        hard_limit: false,
        created_at: now
      });
      addAudit(data, request, workspace.id, "workspace.create", "workspace", workspace.id, { name: workspace.name });
      return workspace;
    });
    sendJson(response, 201, { workspace: exposeWorkspace(result) });
    return;
  }

  if (parts[0] === "workspaces" && parts[1]) {
    const workspaceId = parts[1];

    if (method === "GET" && parts.length === 2) {
      const workspace = workspaceFor(store.snapshot, workspaceId);
      if (!workspace) return notFound(response);
      sendJson(response, 200, { workspace: exposeWorkspace(workspace) });
      return;
    }

    if (method === "PATCH" && parts.length === 2) {
      const body = await readJsonBody(request);
      const result = await store.transaction(async (data) => {
        const workspace = workspaceFor(data, workspaceId);
        if (!workspace) {
          const error = new Error("Workspace not found.");
          error.code = "NOT_FOUND";
          throw error;
        }
        requireWorkspacePermission(data, request, workspaceId, "budget.write");
        if (body.name !== undefined) workspace.name = body.name;
        if (body.slug !== undefined) workspace.slug = toSlug(body.slug);
        if (body.defaultBudgetMode !== undefined || body.default_budget_mode !== undefined) {
          workspace.default_budget_mode = body.defaultBudgetMode || body.default_budget_mode;
        }
        if (body.monthlyBudgetUsd !== undefined || body.monthly_budget_usd !== undefined) {
          workspace.monthly_budget_usd = Number(body.monthlyBudgetUsd || body.monthly_budget_usd);
        }
        workspace.updated_at = nowIso();
        addAudit(data, request, workspaceId, "workspace.update", "workspace", workspaceId);
        return workspace;
      });
      sendJson(response, 200, { workspace: exposeWorkspace(result) });
      return;
    }

    if (method === "GET" && parts[2] === "costs" && parts[3] === "summary") {
      sendJson(response, 200, { costSummary: costSummary(store.snapshot, workspaceId) });
      return;
    }

    if (parts[2] === "api-keys" && method === "GET") {
      const keys = store.snapshot.api_keys
        .filter((key) => key.workspace_id === workspaceId)
        .map(exposeApiKey);
      sendJson(response, 200, { apiKeys: keys });
      return;
    }

    if (parts[2] === "api-keys" && method === "POST" && parts.length === 3) {
      const body = await readJsonBody(request);
      const apiKey = body.apiKey || body.api_key || body.key;
      if (!apiKey) {
        const error = new Error("apiKey is required.");
        error.code = "VALIDATION_ERROR";
        throw error;
      }
      const provider = body.provider || "deepseek_direct";
      const result = await store.transaction(async (data) => {
        if (!workspaceFor(data, workspaceId)) {
          const error = new Error("Workspace not found.");
          error.code = "NOT_FOUND";
          throw error;
        }
        requireWorkspacePermission(data, request, workspaceId, "api_key:create");
        const now = nowIso();
        const existing = data.api_keys.find((key) => key.workspace_id === workspaceId && key.provider === provider);
        const record = {
          id: existing?.id || createId(),
          workspace_id: workspaceId,
          provider,
          encrypted_key: encryptSecret(apiKey),
          key_hint: keyHint(apiKey),
          status: "active",
          created_by: DEFAULT_USER_ID,
          created_at: existing?.created_at || now,
          updated_at: now
        };
        if (existing) {
          Object.assign(existing, record);
        } else {
          data.api_keys.push(record);
        }
        addAudit(data, request, workspaceId, "api_key.upsert", "api_key", record.id, { provider, key_hint: record.key_hint });
        return record;
      });
      sendJson(response, 201, { apiKey: exposeApiKey(result) });
      return;
    }

    if (parts[2] === "api-keys" && parts[3] === "test" && method === "POST") {
      const body = await readJsonBody(request);
      const provider = body.provider || "deepseek_direct";
      const key = store.snapshot.api_keys.find((item) => item.workspace_id === workspaceId && item.provider === provider && item.status === "active");
      sendJson(response, 200, {
        ok: Boolean(key || process.env.DEEPSEEK_API_KEY || provider === "local"),
        provider,
        keyHint: key?.key_hint || (process.env.DEEPSEEK_API_KEY ? keyHint(process.env.DEEPSEEK_API_KEY) : null)
      });
      return;
    }

    if (parts[2] === "api-keys" && parts[4] === "test" && method === "POST") {
      const key = store.snapshot.api_keys.find((item) => item.id === parts[3] && item.workspace_id === workspaceId);
      if (!key) return notFound(response);
      sendJson(response, 200, { ok: true, provider: key.provider, keyHint: key.key_hint });
      return;
    }
  }

  if (method === "GET" && pathname === "/projects") {
    const workspaceId = url.searchParams.get("workspaceId") || url.searchParams.get("workspace_id");
    const projects = store.snapshot.projects
      .filter((project) => !workspaceId || project.workspace_id === workspaceId)
      .map(exposeProject);
    sendJson(response, 200, { projects });
    return;
  }

  if (method === "POST" && pathname === "/projects") {
    const body = await readJsonBody(request);
    const result = await store.transaction(async (data) => {
      const workspaceId = body.workspaceId || body.workspace_id || DEFAULT_WORKSPACE_ID;
      if (!workspaceFor(data, workspaceId)) {
        const error = new Error("Workspace not found.");
        error.code = "NOT_FOUND";
        throw error;
      }
      requireWorkspacePermission(data, request, workspaceId, "project:create");
      const now = nowIso();
      const project = {
        id: createId(),
        workspace_id: workspaceId,
        name: body.name || String(requireField(body, "oneLiner")).slice(0, 56),
        one_liner: body.oneLiner || body.one_liner || body.idea || "",
        business_type: body.businessType || body.business_type || null,
        status: "active",
        created_by: DEFAULT_USER_ID,
        created_at: now,
        updated_at: now
      };
      data.projects.push(project);
      addAudit(data, request, workspaceId, "project.create", "project", project.id, { name: project.name });
      return project;
    });
    sendJson(response, 201, { project: exposeProject(result) });
    return;
  }

  if (parts[0] === "projects" && parts[1]) {
    const projectId = parts[1];
    const project = projectFor(store.snapshot, projectId);
    if (!project) return notFound(response);

    if (method === "GET" && parts.length === 2) {
      const snapshot = store.repositoriesFor().projects.snapshot(projectId);
      sendJson(response, 200, {
        project: exposeProject(snapshot.project),
        businessMap: snapshot.businessMap,
        assumptions: snapshot.assumptions,
        metrics: snapshot.metrics,
        initiatives: snapshot.initiatives.map(exposeInitiative),
        workItems: snapshot.workItems.map(exposeWorkItem),
        reviews: snapshot.reviews.map(exposeReview)
      });
      return;
    }

    if (method === "GET" && parts[2] === "business-map") {
      const businessMap = await store.transaction(async (data) => ensureBusinessMap(data, project));
      sendJson(response, 200, { businessMap, business_map: businessMap });
      return;
    }

    if (parts[2] === "initiatives" && method === "GET") {
      const initiatives = store.snapshot.initiatives
        .filter((item) => item.project_id === projectId)
        .map(exposeInitiative);
      sendJson(response, 200, { initiatives });
      return;
    }

    if (parts[2] === "initiatives" && method === "POST") {
      const body = await readJsonBody(request);
      if (body.generate === true || !body.title) {
        const result = await store.transaction(async (data) => {
          requireWorkspacePermission(data, request, project.workspace_id, "work_item:create");
          const businessMap = ensureBusinessMap(data, project);
          const output = sampleInitiatives({ one_liner: project.one_liner, businessMap });
          return createInitiativesFromOutput(data, project, output);
        });
        sendJson(response, 201, {
          initiatives: result.initiatives.map(exposeInitiative),
          workItems: result.workItems.map(exposeWorkItem)
        });
        return;
      }

      const result = await store.transaction(async (data) => {
        requireWorkspacePermission(data, request, project.workspace_id, "work_item:create");
        const now = nowIso();
        const initiative = {
          id: createId(),
          project_id: projectId,
          title: body.title || "2週間レビュー",
          description: body.description || "",
          initiative_type: body.initiativeType || body.initiative_type || "product",
          hypothesis: body.hypothesis || "",
          success_criteria: body.successCriteria || body.success_criteria || "",
          start_date: body.startDate || body.start_date || null,
          due_date: body.dueDate || body.due_date || null,
          status: body.status || "draft",
          priority: body.priority || "medium",
          related_metric_id: body.relatedMetricId || body.related_metric_id || null,
          related_assumption_id: body.relatedAssumptionId || body.related_assumption_id || null,
          created_by: DEFAULT_USER_ID,
          created_at: now,
          updated_at: now
        };
        data.initiatives.push(initiative);
        connectProjectMemoryGraph(data, project);
        addAudit(data, request, project.workspace_id, "initiative.create", "initiative", initiative.id, { project_id: projectId });
        return initiative;
      });
      sendJson(response, 201, { initiative: exposeInitiative(result) });
      return;
    }

    if (parts[2] === "work-items" && method === "GET") {
      const workItems = store.snapshot.work_items
        .filter((item) => item.project_id === projectId)
        .map(exposeWorkItem);
      sendJson(response, 200, { workItems, work_items: workItems });
      return;
    }

    if (parts[2] === "work-items" && method === "POST") {
      const body = await readJsonBody(request);
      const result = await store.transaction(async (data) => {
        requireWorkspacePermission(data, request, project.workspace_id, "work_item:create");
        const now = nowIso();
        const workItem = {
          id: createId(),
          project_id: projectId,
          initiative_id: body.initiativeId || body.initiative_id || null,
          title: requireField(body, "title"),
          description: body.description || "",
          acceptance_criteria: body.acceptanceCriteria || body.acceptance_criteria || [],
          work_type: body.workType || body.work_type || "task",
          status: body.status || "draft",
          priority: body.priority || "medium",
          assignee_user_id: body.assigneeUserId || body.assignee_user_id || null,
          external_provider: null,
          external_id: null,
          external_url: null,
          created_by: DEFAULT_USER_ID,
          created_at: now,
          updated_at: now
        };
        data.work_items.push(workItem);
        connectProjectMemoryGraph(data, project);
        addAudit(data, request, project.workspace_id, "work_item.create", "work_item", workItem.id, { project_id: projectId });
        return workItem;
      });
      sendJson(response, 201, { workItem: exposeWorkItem(result), work_item: exposeWorkItem(result) });
      return;
    }

    if (parts[2] === "reviews" && method === "GET") {
      const reviews = store.snapshot.reviews
        .filter((item) => item.project_id === projectId)
        .map(exposeReview);
      sendJson(response, 200, { reviews });
      return;
    }

    if (parts[2] === "reviews" && method === "POST") {
      const body = await readJsonBody(request);
      const result = await store.transaction(async (data) => {
        requireWorkspacePermission(data, request, project.workspace_id, "review:create");
        const review = {
          id: createId(),
          project_id: projectId,
          title: requireField(body, "title"),
          review_type: body.reviewType || body.review_type || "weekly",
          period_start: body.periodStart || body.period_start || null,
          period_end: body.periodEnd || body.period_end || null,
          summary: body.summary || [body.done, body.evidence, body.metric].filter(Boolean).join(" / "),
          learnings: body.learnings || (body.evidence ? [body.evidence] : []),
          next_actions: body.nextActions || body.next_actions || ["次の施策候補を確認する"],
          created_by: DEFAULT_USER_ID,
          created_at: nowIso()
        };
        data.reviews.push(review);
        connectProjectMemoryGraph(data, project);
        addAudit(data, request, project.workspace_id, "review.create", "review", review.id, { project_id: projectId });
        return review;
      });
      sendJson(response, 201, { review: exposeReview(result) });
      return;
    }

    if (parts[2] === "memory" && parts[3] === "graph" && method === "GET") {
      const graph = await store.transaction(async (data) => connectProjectMemoryGraph(data, project));
      sendJson(response, 200, { memoryGraph: graph, graph });
      return;
    }

    if (parts[2] === "memory" && parts[3] === "nodes" && method === "GET") {
      const graph = await store.transaction(async (data) => connectProjectMemoryGraph(data, project));
      sendJson(response, 200, { nodes: graph.nodes });
      return;
    }

    if (parts[2] === "memory" && parts[3] === "nodes" && method === "POST") {
      const body = await readJsonBody(request);
      const result = await store.transaction(async (data) => {
        requireWorkspacePermission(data, request, project.workspace_id, "project.write");
        const node = upsertMemoryNode(data, {
          workspace_id: project.workspace_id,
          project_id: project.id,
          node_type: body.nodeType || body.node_type || "lesson",
          source_entity_type: body.sourceEntityType || body.source_entity_type || null,
          source_entity_id: body.sourceEntityId || body.source_entity_id || null,
          title: requireField(body, "title"),
          body: body.body || "",
          status: body.status || "active",
          importance: body.importance,
          confidence: body.confidence,
          metadata: body.metadata || {}
        });
        addAudit(data, request, project.workspace_id, "memory_node.upsert", "memory_node", node.id, { project_id: project.id });
        return node;
      });
      sendJson(response, 201, { node: result });
      return;
    }

    if (parts[2] === "memory" && parts[3] === "edges" && method === "POST") {
      const body = await readJsonBody(request);
      const result = await store.transaction(async (data) => {
        requireWorkspacePermission(data, request, project.workspace_id, "project.write");
        const edge = upsertMemoryEdge(data, {
          workspace_id: project.workspace_id,
          project_id: project.id,
          from_node_id: body.fromNodeId || body.from_node_id,
          to_node_id: body.toNodeId || body.to_node_id,
          relation_type: body.relationType || body.relation_type,
          strength: body.strength,
          metadata: body.metadata || {}
        });
        if (!edge) {
          const error = new Error("Valid fromNodeId, toNodeId, and relationType are required.");
          error.code = "VALIDATION_ERROR";
          throw error;
        }
        addAudit(data, request, project.workspace_id, "memory_edge.upsert", "memory_edge", edge.id, { project_id: project.id });
        return edge;
      });
      sendJson(response, 201, { edge: result });
      return;
    }

    if (parts[2] === "memory" && parts[3] === "summary" && method === "GET") {
      const summary = await store.transaction(async (data) => refreshProjectMemorySummary(data, project));
      sendJson(response, 200, { memorySummary: summary, summary });
      return;
    }

    if (parts[2] === "memory" && parts[3] === "refresh-summary" && method === "POST") {
      const summary = await store.transaction(async (data) => {
        requireWorkspacePermission(data, request, project.workspace_id, "project.write");
        return refreshProjectMemorySummary(data, project);
      });
      sendJson(response, 200, { memorySummary: summary, summary });
      return;
    }

    if (parts[2] === "export" && parts[3] === "markdown" && method === "GET") {
      const markdown = await store.transaction(async (data) => markdownForProject(data, project));
      send(response, 200, markdown, {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store"
      });
      return;
    }

    if (parts[2] === "tool-actions" && method === "GET") {
      const toolActions = store.snapshot.tool_actions.filter((item) => item.project_id === projectId);
      sendJson(response, 200, { toolActions });
      return;
    }
  }

  if (method === "GET" && pathname === "/playbooks") {
    sendJson(response, 200, {
      playbooks: [
        "idea_intake",
        "business_map_generation",
        "initiative_generation",
        "implementation_breakdown",
        "weekly_review"
      ]
    });
    return;
  }

  if (method === "POST" && pathname === "/playbook-runs") {
    const body = await readJsonBody(request);
    const result = await store.transaction(async (data) => {
      const project = body.projectId || body.project_id ? projectFor(data, body.projectId || body.project_id) : null;
      const workspaceId = body.workspaceId || body.workspace_id || project?.workspace_id || DEFAULT_WORKSPACE_ID;
      const playbookId = body.playbookId || body.playbook_id || "idea_intake";
      const budgetMode = body.budgetMode || body.budget_mode || "cheap";
      const rawInput = body.input || body.inputs || {};
      const input = { ...rawInput, one_liner: rawInput.oneLiner || rawInput.one_liner || rawInput.idea || project?.one_liner };
      requireWorkspacePermission(data, request, workspaceId, "ai.run");
      const generated = await generatePlaybookOutput(data, {
        workspaceId,
        project,
        task: playbookId,
        input,
        budgetMode,
        approvedHighCost: Boolean(body.approvedHighCost || body.approved_high_cost)
      });
      const output = generated.output;
      const effectiveInput = generated.input || input;
      const now = nowIso();
      const run = {
        id: createId(),
        workspace_id: workspaceId,
        project_id: project?.id || body.projectId || body.project_id || null,
        playbook_id: playbookId,
        input: effectiveInput,
        output,
        status: "completed",
        created_by: DEFAULT_USER_ID,
        started_at: now,
        completed_at: now,
        created_at: now,
        memory_summary_id: generated.memoryContext?.id || null
      };
      data.playbook_runs.push(run);
      const accounting = createAiAccounting(data, {
        workspaceId,
        projectId: run.project_id,
        task: playbookId,
        input: effectiveInput,
        output,
        provider: generated.provider,
        model: generated.model,
        budgetMode
      });
      run.ai_run_id = accounting.aiRun.id;
      addAudit(data, request, workspaceId, "playbook_run.complete", "playbook_run", run.id, { playbook_id: playbookId });
      return run;
    });
    sendJson(response, 201, { playbookRun: exposePlaybookRun(result), run: exposePlaybookRun(result) });
    return;
  }

  if (parts[0] === "playbook-runs" && parts[1] && parts[2] === "approve-output" && method === "POST") {
    const result = await store.transaction(async (data) => {
      const run = data.playbook_runs.find((item) => item.id === parts[1]);
      if (!run) {
        const error = new Error("PlaybookRun not found.");
        error.code = "NOT_FOUND";
        throw error;
      }
      requireWorkspacePermission(data, request, run.workspace_id, "project.write");
      const applied = applyPlaybookRunOutput(data, run, DEFAULT_USER_ID);
      addAudit(data, request, run.workspace_id, "playbook_run.approve_output", "playbook_run", run.id, {
        playbook_id: run.playbook_id,
        project_id: run.project_id
      });
      return { run, applied };
    });
    sendJson(response, 200, {
      playbookRun: exposePlaybookRun(result.run),
      run: exposePlaybookRun(result.run),
      applied: result.applied
    });
    return;
  }

  if (parts[0] === "playbook-runs" && parts[1] && method === "GET") {
    const run = store.snapshot.playbook_runs.find((item) => item.id === parts[1]);
    if (!run) return notFound(response);
    sendJson(response, 200, { playbookRun: exposePlaybookRun(run), run: exposePlaybookRun(run) });
    return;
  }

  if (method === "POST" && pathname === "/ai-runs") {
    const body = await readJsonBody(request);
    const result = await store.transaction(async (data) => {
      const workspaceId = body.workspaceId || body.workspace_id || DEFAULT_WORKSPACE_ID;
      const projectId = body.projectId || body.project_id || null;
      const task = body.task || "business_map_generation";
      const project = projectId ? projectFor(data, projectId) : null;
      requireWorkspacePermission(data, request, workspaceId, "ai.run");
      const generated = await generatePlaybookOutput(data, {
        workspaceId,
        project,
        task,
        input: body.input || {},
        budgetMode: body.budgetMode || body.budget_mode || "cheap",
        approvedHighCost: Boolean(body.approvedHighCost || body.approved_high_cost)
      });
      return createAiAccounting(data, {
        workspaceId,
        projectId,
        task,
        input: generated.input || body.input || {},
        output: generated.output,
        provider: generated.provider,
        model: generated.model,
        budgetMode: body.budgetMode || body.budget_mode || "cheap"
      }).aiRun;
    });
    sendJson(response, 201, { aiRun: result });
    return;
  }

  if (parts[0] === "ai-runs" && parts[1] && method === "GET") {
    const aiRun = store.snapshot.ai_runs.find((item) => item.id === parts[1]);
    if (!aiRun) return notFound(response);
    sendJson(response, 200, { aiRun });
    return;
  }

  if (parts[0] === "work-items" && parts[1] && parts[2] === "github-issue-draft" && method === "POST") {
    const body = await readJsonBody(request);
    const result = await store.transaction(async (data) => {
      const workItem = data.work_items.find((item) => item.id === parts[1]);
      if (!workItem) {
        const error = new Error("WorkItem not found.");
        error.code = "NOT_FOUND";
        throw error;
      }
      const project = projectFor(data, workItem.project_id);
      if (!project) {
        const error = new Error("Project not found for WorkItem.");
        error.code = "NOT_FOUND";
        throw error;
      }
      requireWorkspacePermission(data, request, project.workspace_id, "connector.write");
      const initiative = workItem.initiative_id
        ? data.initiatives.find((item) => item.id === workItem.initiative_id)
        : null;
      const draft = buildGitHubIssueDraft(project, initiative, workItem, body);
      const toolAction = {
        id: createId(),
        workspace_id: project.workspace_id,
        project_id: project.id,
        tool_provider: "github",
        action_type: "issue_create",
        payload: {
          title: draft.title,
          body: draft.body,
          labels: draft.labels,
          source_work_item_id: workItem.id,
          source_initiative_id: initiative?.id || null
        },
        preview: draft.preview,
        status: "draft",
        requested_by: DEFAULT_USER_ID,
        approved_by: null,
        approved_at: null,
        executed_at: null,
        result: null,
        created_at: nowIso()
      };
      data.tool_actions.push(toolAction);
      addAudit(data, request, project.workspace_id, "tool_action.github_issue_draft", "tool_action", toolAction.id, {
        project_id: project.id,
        work_item_id: workItem.id
      });
      return toolAction;
    });
    sendJson(response, 201, { toolAction: result, tool_action: result });
    return;
  }

  if (method === "POST" && pathname === "/tool-actions") {
    const body = await readJsonBody(request);
    const result = await store.transaction(async (data) => {
      const workspaceId = body.workspaceId || body.workspace_id || DEFAULT_WORKSPACE_ID;
      requireWorkspacePermission(data, request, workspaceId, "connector.write");
      const toolAction = {
        id: createId(),
        workspace_id: workspaceId,
        project_id: body.projectId || body.project_id || null,
        tool_provider: body.toolProvider || body.tool_provider || "markdown",
        action_type: body.actionType || body.action_type || "draft",
        payload: body.payload || {},
        preview: body.preview || "",
        status: "draft",
        requested_by: DEFAULT_USER_ID,
        approved_by: null,
        approved_at: null,
        executed_at: null,
        result: null,
        created_at: nowIso()
      };
      data.tool_actions.push(toolAction);
      addAudit(data, request, toolAction.workspace_id, "tool_action.create", "tool_action", toolAction.id);
      return toolAction;
    });
    sendJson(response, 201, { toolAction: result });
    return;
  }

  if (parts[0] === "tool-actions" && parts[1] && ["approve", "cancel", "execute"].includes(parts[2]) && method === "POST") {
    const result = await store.transaction(async (data) => {
      const action = data.tool_actions.find((item) => item.id === parts[1]);
      if (!action) {
        const error = new Error("ToolAction not found.");
        error.code = "NOT_FOUND";
        throw error;
      }
      requireWorkspacePermission(data, request, action.workspace_id, "connector.write");
      if (parts[2] === "approve") {
        action.status = "approved";
        action.approved_by = DEFAULT_USER_ID;
        action.approved_at = nowIso();
      } else if (parts[2] === "cancel") {
        if (action.status === "completed") {
          const error = new Error("Completed ToolAction cannot be cancelled.");
          error.code = "VALIDATION_ERROR";
          error.details = { status: action.status };
          throw error;
        }
        action.status = "cancelled";
      } else {
        if (action.status !== "approved") {
          const error = new Error("ToolAction must be approved before execution.");
          error.code = "TOOL_ACTION_REQUIRES_APPROVAL";
          error.details = { status: action.status };
          throw error;
        }
        action.status = "completed";
        action.executed_at = nowIso();
        action.result = { ok: true, mode: "stub" };
      }
      addAudit(data, request, action.workspace_id, `tool_action.${parts[2]}`, "tool_action", action.id);
      return action;
    });
    sendJson(response, 200, { toolAction: result });
    return;
  }

  notFound(response);
}

async function main() {
  const store = await createStore();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith(API_PREFIX)) {
        await handleApi(store, request, response, url);
      } else {
        await serveStatic(request, response, url.pathname);
      }
    } catch (error) {
      sendError(response, statusForErrorCode(error.code), error.code || "INTERNAL_ERROR", error.message || "Internal server error.", error.details || {});
    }
  });

  server.listen(PORT, () => {
    console.log(`Open Business OS listening on http://localhost:${PORT}`);
  });

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  handleApi,
  markdownForProject
};
