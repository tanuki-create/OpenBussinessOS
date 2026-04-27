"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  findModel,
  findProvider,
  getDefaultModelForTask,
  loadProviderRegistry,
  modelSupportsCapabilities
} = require("./provider-registry");

const DEFAULT_POLICY_PATH = path.resolve(__dirname, "../../../config/llm-policy.json");

function loadLlmPolicy(filePath = DEFAULT_POLICY_PATH) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function routeCandidates(policy, task, budgetMode) {
  const taskPolicy = policy.routing && policy.routing[task];
  if (!taskPolicy || !taskPolicy.budget_modes) return [];

  const preferredBudgetMode = budgetMode || policy.default_budget_mode || "cheap";
  const direct = taskPolicy.budget_modes[preferredBudgetMode];
  if (Array.isArray(direct) && direct.length > 0) return direct.slice();

  const fallbackBudgetModes = [
    policy.default_budget_mode,
    "cheap",
    "ultra_cheap",
    "balanced",
    "high_quality"
  ].filter(Boolean);

  for (const mode of fallbackBudgetModes) {
    const candidates = taskPolicy.budget_modes[mode];
    if (Array.isArray(candidates) && candidates.length > 0) return candidates.slice();
  }

  return [];
}

function maxOutputTokensForTask(policy, task, explicitMaxOutputTokens) {
  if (explicitMaxOutputTokens) return explicitMaxOutputTokens;
  return (
    policy.limits &&
    policy.limits.max_output_tokens &&
    policy.limits.max_output_tokens[task]
  ) || 1200;
}

function approvalReasonsForRoute(policy, route, context = {}) {
  const reasons = [];
  const approval = policy.approval || {};
  const model = context.modelInfo || null;
  const budgetMode = route.budgetMode;
  const task = route.task;

  if (model && model.requires_confirmation) {
    reasons.push("model_requires_confirmation");
  }
  if (approval.require_for_budget_mode && budgetMode === approval.require_for_budget_mode) {
    reasons.push("budget_mode_requires_confirmation");
  }
  if (Array.isArray(approval.require_for_tasks) && approval.require_for_tasks.includes(task)) {
    reasons.push("task_requires_confirmation");
  }
  if (
    typeof context.estimatedCostUsd === "number" &&
    typeof approval.require_for_cost_over_usd === "number" &&
    context.estimatedCostUsd > approval.require_for_cost_over_usd
  ) {
    reasons.push("estimated_cost_requires_confirmation");
  }
  if (context.requireApprovalForHighCost && route.budgetMode === "high_quality") {
    reasons.push("request_requires_high_cost_confirmation");
  }

  return reasons;
}

function selectLlmRoute(request, options = {}) {
  const policy = options.policy || loadLlmPolicy(options.policyPath);
  const registry = options.registry || loadProviderRegistry(options.registryPath);
  const task = request.task;
  const budgetMode = request.budgetMode || policy.default_budget_mode || "cheap";
  const requiredCapabilities = request.requiredCapabilities || [];
  const warnings = [];

  let candidates = routeCandidates(policy, task, budgetMode);
  if (candidates.length === 0) {
    const defaultModel = getDefaultModelForTask(registry, task, requiredCapabilities);
    if (defaultModel) {
      candidates = [{ provider: defaultModel.provider, model: defaultModel.id }];
      warnings.push("policy_route_missing_using_registry_default");
    }
  }

  const candidateDetails = candidates.map((candidate) => {
    const providerInfo = findProvider(registry, candidate.provider);
    const modelInfo = findModel(registry, candidate.provider, candidate.model);
    return {
      provider: candidate.provider,
      model: candidate.model,
      providerInfo,
      modelInfo,
      dynamic: Boolean(providerInfo && providerInfo.dynamic_models),
      supportsCapabilities: modelInfo
        ? modelSupportsCapabilities(modelInfo, requiredCapabilities)
        : Boolean(providerInfo && providerInfo.dynamic_models)
    };
  });

  const selected = candidateDetails.find((candidate) => candidate.supportsCapabilities);
  if (!selected) {
    throw new Error(`No LLM route available for task ${task}`);
  }

  const route = {
    task,
    budgetMode,
    provider: selected.provider,
    model: selected.model,
    maxOutputTokens: maxOutputTokensForTask(policy, task, request.maxOutputTokens),
    fallbackRoutes: candidateDetails
      .slice(1)
      .filter((candidate) => candidate.supportsCapabilities)
      .map((candidate) => ({ provider: candidate.provider, model: candidate.model })),
    warnings
  };

  const approvalReasons = approvalReasonsForRoute(policy, route, {
    modelInfo: selected.modelInfo,
    estimatedCostUsd: options.estimatedCostUsd,
    requireApprovalForHighCost: request.requireApprovalForHighCost
  });

  return {
    ...route,
    requiresApproval: approvalReasons.length > 0,
    approvalReasons
  };
}

module.exports = {
  DEFAULT_POLICY_PATH,
  loadLlmPolicy,
  routeCandidates,
  maxOutputTokensForTask,
  approvalReasonsForRoute,
  selectLlmRoute
};
