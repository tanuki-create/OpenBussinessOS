"use strict";

const DEFAULT_POLICY = {
  default_budget_mode: "cheap",
  approval: {
    require_for_cost_over_usd: 0.05,
    require_for_budget_mode: "high_quality",
    require_for_tasks: ["security_review", "critical_strategy_review"]
  },
  routing: {
    default: {
      ultra_cheap: [{ provider: "deepseek_direct", model: "deepseek-v4-flash" }],
      cheap: [{ provider: "deepseek_direct", model: "deepseek-v4-flash" }],
      balanced: [{ provider: "deepseek_direct", model: "deepseek-v4-flash" }],
      high_quality: [{ provider: "deepseek_direct", model: "deepseek-v4-pro" }]
    }
  }
};

function selectModel({ task = "default", budgetMode = "cheap", policy = DEFAULT_POLICY } = {}) {
  const routes = policy.routing?.[task] || policy.routing?.default || DEFAULT_POLICY.routing.default;
  const chain = routes[budgetMode] || routes[policy.default_budget_mode] || routes.cheap || DEFAULT_POLICY.routing.default.cheap;
  return chain[0];
}

function requiresApproval({ task, budgetMode, estimatedCostUsd = 0, policy = DEFAULT_POLICY } = {}) {
  const approval = policy.approval || DEFAULT_POLICY.approval;
  return (
    estimatedCostUsd > approval.require_for_cost_over_usd ||
    budgetMode === approval.require_for_budget_mode ||
    (approval.require_for_tasks || []).includes(task)
  );
}

module.exports = {
  DEFAULT_POLICY,
  requiresApproval,
  selectModel
};
