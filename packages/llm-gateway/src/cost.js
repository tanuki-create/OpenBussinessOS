"use strict";

const DEFAULT_PRICING = {
  "deepseek-v4-flash": { inputPerMTok: 0.07, outputPerMTok: 0.28 },
  "deepseek-v4-pro": { inputPerMTok: 0.55, outputPerMTok: 2.19 },
  "sample-local": { inputPerMTok: 0, outputPerMTok: 0 }
};

function estimateTokens(text) {
  if (text === undefined || text === null) return 0;
  const normalized = typeof text === "string" ? text : JSON.stringify(text);
  return Math.max(1, Math.ceil(normalized.length / 4));
}

function estimateCost({ model = "sample-local", inputTokens = 0, outputTokens = 0, pricing = DEFAULT_PRICING } = {}) {
  const profile = pricing[model] || pricing;
  const inputPrice = profile.inputPerMTok ?? profile.inputPerMillion ?? DEFAULT_PRICING["deepseek-v4-flash"].inputPerMTok;
  const outputPrice = profile.outputPerMTok ?? profile.outputPerMillion ?? DEFAULT_PRICING["deepseek-v4-flash"].outputPerMTok;
  const cachePrice = profile.cacheHitPerMTok ?? profile.cacheHitPerMillion ?? 0;
  const cacheHitTokens = Math.max(0, Number(arguments[0]?.cacheHitTokens || 0));
  const billableInputTokens = Math.max(0, Number(inputTokens) - cacheHitTokens);
  return Number(((
    (billableInputTokens / 1_000_000) * inputPrice +
    (Number(outputTokens) / 1_000_000) * outputPrice +
    (cacheHitTokens / 1_000_000) * cachePrice
  )).toFixed(6));
}

function estimateRunCost({ model = "sample-local", input, output } = {}) {
  const inputTokens = estimateTokens(input);
  const outputTokens = estimateTokens(output);
  return {
    inputTokens,
    outputTokens,
    cacheHitTokens: 0,
    estimatedCostUsd: estimateCost({ model, inputTokens, outputTokens })
  };
}

module.exports = {
  DEFAULT_PRICING,
  estimateCost,
  estimateRunCost,
  estimateTokens
};
