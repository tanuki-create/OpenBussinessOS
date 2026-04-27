"use strict";

const { findModel, loadProviderRegistry } = require("./provider-registry");

function estimateTokensFromText(text) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function estimateTokensFromValue(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return estimateTokensFromText(value);
  return estimateTokensFromText(JSON.stringify(value));
}

function estimateMessageTokens(messages = []) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((total, message) => {
    return total + 4 + estimateTokensFromValue(message.role) + estimateTokensFromValue(message.content);
  }, 0);
}

function estimateRequestTokens(request = {}) {
  return (
    estimateTokensFromValue(request.system) +
    estimateMessageTokens(request.messages) +
    estimateTokensFromValue(request.outputSchemaName)
  );
}

function normalizePricing(pricing) {
  if (!pricing) return null;
  return {
    input: pricing.input ?? pricing.inputPerMillion ?? pricing.input_per_million ?? 0,
    output: pricing.output ?? pricing.outputPerMillion ?? pricing.output_per_million ?? 0,
    cache_hit: pricing.cache_hit ?? pricing.cacheHitPerMillion ?? pricing.cache_hit_per_million ?? 0,
    is_estimate: Boolean(pricing.is_estimate)
  };
}

function costFromPricing(pricing, inputTokens, outputTokens, cacheHitTokens) {
  if (!pricing) return 0;
  const normalized = normalizePricing(pricing);
  const billableInputTokens = Math.max(0, inputTokens - cacheHitTokens);
  const inputCost = (billableInputTokens / 1000000) * Number(normalized.input || 0);
  const outputCost = (outputTokens / 1000000) * Number(normalized.output || 0);
  const cacheCost = (cacheHitTokens / 1000000) * Number(normalized.cache_hit || 0);
  return inputCost + outputCost + cacheCost;
}

function estimateCostForModel(input = {}) {
  const registry = input.registry || loadProviderRegistry(input.registryPath);
  const model = input.modelInfo || findModel(registry, input.provider, input.model);
  const inputTokens = Math.max(0, Number(input.inputTokens || 0));
  const outputTokens = Math.max(0, Number(input.outputTokens || 0));
  const cacheHitTokens = Math.max(0, Number(input.cacheHitTokens || 0));
  const pricing = normalizePricing(input.pricing || (model && model.pricing_usd_per_1m_tokens));
  const warnings = [];

  if (!model) warnings.push("model_not_found");
  if (!pricing) warnings.push("model_pricing_missing");
  if (pricing && pricing.is_estimate) warnings.push("model_pricing_is_estimate");

  return {
    provider: input.provider,
    model: input.model,
    inputTokens,
    outputTokens,
    cacheHitTokens,
    estimatedCostUsd: Number(costFromPricing(pricing, inputTokens, outputTokens, cacheHitTokens).toFixed(8)),
    pricing,
    warnings
  };
}

function estimateLlmCost(inputOrInputTokens = {}, outputTokens, options = {}) {
  if (typeof inputOrInputTokens === "number") {
    return estimateCostForModel({
      provider: options.provider,
      model: options.model,
      inputTokens: inputOrInputTokens,
      outputTokens,
      cacheHitTokens: options.cacheHitTokens || 0,
      pricing: options.pricing,
      registry: options.registry,
      registryPath: options.registryPath
    });
  }

  return estimateCostForModel(inputOrInputTokens);
}

function estimateLlmRunCost(request = {}, route = {}, options = {}) {
  const inputTokens = options.inputTokens === undefined
    ? estimateRequestTokens(request)
    : options.inputTokens;
  const outputTokens = options.outputTokens === undefined
    ? (request.maxOutputTokens || route.maxOutputTokens || 1200)
    : options.outputTokens;

  return estimateCostForModel({
    registry: options.registry,
    registryPath: options.registryPath,
    provider: route.provider,
    model: route.model,
    inputTokens,
    outputTokens,
    cacheHitTokens: options.cacheHitTokens || 0
  });
}

module.exports = {
  estimateTokensFromText,
  estimateTokensFromValue,
  estimateMessageTokens,
  estimateRequestTokens,
  normalizePricing,
  costFromPricing,
  estimateCostForModel,
  estimateLlmCost,
  estimateCost: estimateLlmCost,
  estimateProviderCost: estimateLlmCost,
  estimateLlmRunCost
};
