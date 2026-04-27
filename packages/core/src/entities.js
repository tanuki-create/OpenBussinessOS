"use strict";

const { randomUUID } = require("node:crypto");

const PROJECT_STATUSES = ["draft", "active", "paused", "archived"];
const CARD_STATUSES = ["draft", "approved", "archived"];
const ASSUMPTION_TYPES = [
  "customer",
  "problem",
  "solution",
  "market",
  "pricing",
  "technical",
  "gtm",
  "security",
  "operations"
];
const ASSUMPTION_STATUSES = [
  "unverified",
  "supported",
  "rejected",
  "needs_more_evidence",
  "archived"
];
const EVIDENCE_LEVELS = ["none", "weak", "medium", "strong"];
const RISK_LEVELS = ["low", "medium", "high", "critical"];
const INITIATIVE_TYPES = [
  "product",
  "engineering",
  "marketing",
  "sales",
  "security",
  "operations",
  "research",
  "customer_success"
];
const INITIATIVE_STATUSES = [
  "draft",
  "planned",
  "in_progress",
  "done",
  "cancelled",
  "archived"
];
const WORK_TYPES = [
  "issue",
  "task",
  "bug",
  "research",
  "design",
  "security",
  "ops",
  "sales",
  "marketing"
];
const WORK_ITEM_STATUSES = [
  "draft",
  "todo",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
  "archived"
];
const REVIEW_TYPES = ["weekly", "biweekly", "monthly", "poc", "incident", "initiative"];
const TOOL_ACTION_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "executing",
  "completed",
  "failed",
  "cancelled"
];
const PRIORITIES = ["low", "medium", "high", "critical"];
const SOURCES = ["user", "ai", "imported"];

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return randomUUID();
}

function assertRequired(value, field) {
  if (value === undefined || value === null || value === "") {
    throw new TypeError(`${field} is required`);
  }
}

function assertOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${field} must be one of: ${allowed.join(", ")}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError("expected an array");
  return value.slice();
}

function withTimestamps(entity, timestamp) {
  const ts = timestamp || nowIso();
  return {
    ...entity,
    createdAt: entity.createdAt || ts,
    updatedAt: entity.updatedAt || ts
  };
}

function updateWithTimestamp(entity, patch, options = {}) {
  const allowedFields = options.allowedFields || null;
  const next = { ...entity };

  for (const [key, value] of Object.entries(patch || {})) {
    if (allowedFields && !allowedFields.includes(key)) {
      throw new TypeError(`${key} cannot be updated on ${options.entityName || "entity"}`);
    }
    next[key] = value;
  }

  next.updatedAt = options.timestamp || nowIso();
  return next;
}

function createWorkspace(input = {}) {
  assertRequired(input.name, "name");
  assertRequired(input.slug, "slug");
  assertRequired(input.ownerUserId, "ownerUserId");

  return withTimestamps({
    id: input.id || newId(),
    name: input.name,
    slug: input.slug,
    ownerUserId: input.ownerUserId,
    defaultBudgetMode: input.defaultBudgetMode || "cheap",
    monthlyBudgetUsd: input.monthlyBudgetUsd === undefined ? 5 : Number(input.monthlyBudgetUsd)
  }, input.createdAt);
}

function updateWorkspaceState(workspace, patch = {}) {
  if (patch.defaultBudgetMode !== undefined) {
    assertOneOf(patch.defaultBudgetMode, ["ultra_cheap", "cheap", "balanced", "high_quality"], "defaultBudgetMode");
  }

  return updateWithTimestamp(workspace, patch, {
    entityName: "workspace",
    allowedFields: ["name", "slug", "defaultBudgetMode", "monthlyBudgetUsd"]
  });
}

function createProject(input = {}) {
  assertRequired(input.workspaceId, "workspaceId");
  assertRequired(input.name, "name");
  const status = input.status || "active";
  assertOneOf(status, PROJECT_STATUSES, "status");

  return withTimestamps({
    id: input.id || newId(),
    workspaceId: input.workspaceId,
    name: input.name,
    oneLiner: input.oneLiner || "",
    businessType: input.businessType || null,
    status,
    createdBy: input.createdBy || null
  }, input.createdAt);
}

function updateProjectState(project, patch = {}) {
  if (patch.status !== undefined) assertOneOf(patch.status, PROJECT_STATUSES, "status");

  return updateWithTimestamp(project, patch, {
    entityName: "project",
    allowedFields: ["name", "oneLiner", "businessType", "status"]
  });
}

function createCard(input = {}) {
  assertRequired(input.projectId, "projectId");
  assertRequired(input.cardType, "cardType");
  assertRequired(input.title, "title");
  const status = input.status || "draft";
  const source = input.source || "user";
  assertOneOf(status, CARD_STATUSES, "status");
  assertOneOf(source, SOURCES, "source");

  return withTimestamps({
    id: input.id || newId(),
    projectId: input.projectId,
    cardType: input.cardType,
    title: input.title,
    body: input.body || "",
    status,
    source,
    metadata: input.metadata || {},
    createdBy: input.createdBy || null,
    approvedBy: input.approvedBy || null,
    approvedAt: input.approvedAt || null
  }, input.createdAt);
}

function updateCardState(card, patch = {}) {
  if (patch.status !== undefined) assertOneOf(patch.status, CARD_STATUSES, "status");
  if (patch.source !== undefined) assertOneOf(patch.source, SOURCES, "source");

  return updateWithTimestamp(card, patch, {
    entityName: "card",
    allowedFields: ["title", "body", "status", "source", "metadata", "approvedBy", "approvedAt"]
  });
}

function approveCard(card, userId, timestamp) {
  return updateCardState(card, {
    status: "approved",
    approvedBy: userId || null,
    approvedAt: timestamp || nowIso()
  });
}

function archiveCard(card) {
  return updateCardState(card, { status: "archived" });
}

function createAssumption(input = {}) {
  assertRequired(input.projectId, "projectId");
  assertRequired(input.statement, "statement");
  const assumptionType = input.assumptionType || input.type || "customer";
  const evidenceLevel = input.evidenceLevel || "none";
  const status = input.status || "unverified";
  const riskLevel = input.riskLevel || "medium";

  assertOneOf(assumptionType, ASSUMPTION_TYPES, "assumptionType");
  assertOneOf(evidenceLevel, EVIDENCE_LEVELS, "evidenceLevel");
  assertOneOf(status, ASSUMPTION_STATUSES, "status");
  assertOneOf(riskLevel, RISK_LEVELS, "riskLevel");

  return withTimestamps({
    id: input.id || newId(),
    projectId: input.projectId,
    statement: input.statement,
    assumptionType,
    evidenceLevel,
    status,
    riskLevel,
    relatedMetricId: input.relatedMetricId || null,
    createdBy: input.createdBy || null
  }, input.createdAt);
}

function updateAssumptionState(assumption, patch = {}) {
  if (patch.assumptionType !== undefined) assertOneOf(patch.assumptionType, ASSUMPTION_TYPES, "assumptionType");
  if (patch.evidenceLevel !== undefined) assertOneOf(patch.evidenceLevel, EVIDENCE_LEVELS, "evidenceLevel");
  if (patch.status !== undefined) assertOneOf(patch.status, ASSUMPTION_STATUSES, "status");
  if (patch.riskLevel !== undefined) assertOneOf(patch.riskLevel, RISK_LEVELS, "riskLevel");

  return updateWithTimestamp(assumption, patch, {
    entityName: "assumption",
    allowedFields: [
      "statement",
      "assumptionType",
      "evidenceLevel",
      "status",
      "riskLevel",
      "relatedMetricId"
    ]
  });
}

function createInitiative(input = {}) {
  assertRequired(input.projectId, "projectId");
  assertRequired(input.title, "title");
  const initiativeType = input.initiativeType || "product";
  const status = input.status || "draft";
  const priority = input.priority || "medium";

  assertOneOf(initiativeType, INITIATIVE_TYPES, "initiativeType");
  assertOneOf(status, INITIATIVE_STATUSES, "status");
  assertOneOf(priority, PRIORITIES, "priority");

  return withTimestamps({
    id: input.id || newId(),
    projectId: input.projectId,
    title: input.title,
    description: input.description || "",
    initiativeType,
    hypothesis: input.hypothesis || "",
    successCriteria: input.successCriteria || "",
    startDate: input.startDate || null,
    dueDate: input.dueDate || null,
    status,
    priority,
    relatedMetricId: input.relatedMetricId || null,
    relatedAssumptionId: input.relatedAssumptionId || null,
    createdBy: input.createdBy || null
  }, input.createdAt);
}

function updateInitiativeState(initiative, patch = {}) {
  if (patch.initiativeType !== undefined) assertOneOf(patch.initiativeType, INITIATIVE_TYPES, "initiativeType");
  if (patch.status !== undefined) assertOneOf(patch.status, INITIATIVE_STATUSES, "status");
  if (patch.priority !== undefined) assertOneOf(patch.priority, PRIORITIES, "priority");

  return updateWithTimestamp(initiative, patch, {
    entityName: "initiative",
    allowedFields: [
      "title",
      "description",
      "initiativeType",
      "hypothesis",
      "successCriteria",
      "startDate",
      "dueDate",
      "status",
      "priority",
      "relatedMetricId",
      "relatedAssumptionId"
    ]
  });
}

function createWorkItem(input = {}) {
  assertRequired(input.projectId, "projectId");
  assertRequired(input.title, "title");
  const workType = input.workType || "task";
  const status = input.status || "draft";
  const priority = input.priority || "medium";

  assertOneOf(workType, WORK_TYPES, "workType");
  assertOneOf(status, WORK_ITEM_STATUSES, "status");
  assertOneOf(priority, PRIORITIES, "priority");

  return withTimestamps({
    id: input.id || newId(),
    projectId: input.projectId,
    initiativeId: input.initiativeId || null,
    title: input.title,
    description: input.description || "",
    acceptanceCriteria: asArray(input.acceptanceCriteria),
    workType,
    status,
    priority,
    assigneeUserId: input.assigneeUserId || null,
    externalProvider: input.externalProvider || null,
    externalId: input.externalId || null,
    externalUrl: input.externalUrl || null,
    createdBy: input.createdBy || null
  }, input.createdAt);
}

function updateWorkItemState(workItem, patch = {}) {
  if (patch.workType !== undefined) assertOneOf(patch.workType, WORK_TYPES, "workType");
  if (patch.status !== undefined) assertOneOf(patch.status, WORK_ITEM_STATUSES, "status");
  if (patch.priority !== undefined) assertOneOf(patch.priority, PRIORITIES, "priority");

  return updateWithTimestamp(workItem, patch, {
    entityName: "workItem",
    allowedFields: [
      "initiativeId",
      "title",
      "description",
      "acceptanceCriteria",
      "workType",
      "status",
      "priority",
      "assigneeUserId",
      "externalProvider",
      "externalId",
      "externalUrl"
    ]
  });
}

function createReview(input = {}) {
  assertRequired(input.projectId, "projectId");
  assertRequired(input.title, "title");
  const reviewType = input.reviewType || "weekly";
  assertOneOf(reviewType, REVIEW_TYPES, "reviewType");

  return {
    id: input.id || newId(),
    projectId: input.projectId,
    title: input.title,
    reviewType,
    periodStart: input.periodStart || null,
    periodEnd: input.periodEnd || null,
    summary: input.summary || "",
    learnings: asArray(input.learnings),
    nextActions: asArray(input.nextActions),
    createdBy: input.createdBy || null,
    createdAt: input.createdAt || nowIso()
  };
}

function createToolAction(input = {}) {
  assertRequired(input.workspaceId, "workspaceId");
  assertRequired(input.toolProvider, "toolProvider");
  assertRequired(input.actionType, "actionType");
  const status = input.status || "draft";
  assertOneOf(status, TOOL_ACTION_STATUSES, "status");

  return {
    id: input.id || newId(),
    workspaceId: input.workspaceId,
    projectId: input.projectId || null,
    toolProvider: input.toolProvider,
    actionType: input.actionType,
    payload: input.payload || {},
    preview: input.preview || "",
    status,
    requestedBy: input.requestedBy || null,
    approvedBy: input.approvedBy || null,
    approvedAt: input.approvedAt || null,
    executedAt: input.executedAt || null,
    result: input.result || null,
    createdAt: input.createdAt || nowIso()
  };
}

function updateToolActionState(toolAction, patch = {}) {
  if (patch.status !== undefined) assertOneOf(patch.status, TOOL_ACTION_STATUSES, "status");
  return { ...toolAction, ...patch };
}

function requestToolActionApproval(toolAction) {
  return updateToolActionState(toolAction, { status: "pending_approval" });
}

function approveToolAction(toolAction, userId, timestamp) {
  return updateToolActionState(toolAction, {
    status: "approved",
    approvedBy: userId || null,
    approvedAt: timestamp || nowIso()
  });
}

function markToolActionExecuting(toolAction) {
  return updateToolActionState(toolAction, { status: "executing" });
}

function completeToolAction(toolAction, result, timestamp) {
  return updateToolActionState(toolAction, {
    status: "completed",
    result: result || {},
    executedAt: timestamp || nowIso()
  });
}

function failToolAction(toolAction, result, timestamp) {
  return updateToolActionState(toolAction, {
    status: "failed",
    result: result || {},
    executedAt: timestamp || nowIso()
  });
}

function cancelToolAction(toolAction, reason) {
  return updateToolActionState(toolAction, {
    status: "cancelled",
    result: reason ? { reason } : toolAction.result
  });
}

module.exports = {
  PROJECT_STATUSES,
  CARD_STATUSES,
  ASSUMPTION_TYPES,
  ASSUMPTION_STATUSES,
  EVIDENCE_LEVELS,
  RISK_LEVELS,
  INITIATIVE_TYPES,
  INITIATIVE_STATUSES,
  WORK_TYPES,
  WORK_ITEM_STATUSES,
  REVIEW_TYPES,
  TOOL_ACTION_STATUSES,
  PRIORITIES,
  SOURCES,
  newId,
  nowIso,
  createWorkspace,
  updateWorkspaceState,
  createProject,
  updateProjectState,
  createCard,
  updateCardState,
  approveCard,
  archiveCard,
  createAssumption,
  updateAssumptionState,
  createInitiative,
  updateInitiativeState,
  createWorkItem,
  updateWorkItemState,
  createReview,
  createToolAction,
  updateToolActionState,
  requestToolActionApproval,
  approveToolAction,
  markToolActionExecuting,
  completeToolAction,
  failToolAction,
  cancelToolAction
};
