"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, "../../../config/provider-registry.json");

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadProviderRegistry(filePath = DEFAULT_REGISTRY_PATH) {
  return normalizeProviderRegistry(loadJsonFile(filePath));
}

function normalizeProviderRegistry(registry) {
  const providers = Array.isArray(registry && registry.providers) ? registry.providers : [];
  return {
    ...registry,
    providers: providers.map((provider) => ({
      ...provider,
      models: Array.isArray(provider.models) ? provider.models : []
    }))
  };
}

function findProvider(registry, providerId) {
  const normalized = normalizeProviderRegistry(registry);
  return normalized.providers.find((provider) => provider.id === providerId) || null;
}

function findModel(registry, providerId, modelId) {
  const provider = findProvider(registry, providerId);
  if (!provider) return null;
  return provider.models.find((model) => model.id === modelId) || null;
}

function listModels(registry, filter = {}) {
  const normalized = normalizeProviderRegistry(registry);
  const requiredCapabilities = filter.requiredCapabilities || [];

  return normalized.providers.flatMap((provider) => {
    return provider.models
      .filter((model) => modelSupportsCapabilities(model, requiredCapabilities))
      .filter((model) => !filter.task || (model.default_for || []).includes(filter.task))
      .map((model) => ({
        provider: provider.id,
        providerName: provider.name,
        ...model
      }));
  });
}

function modelSupportsCapabilities(model, requiredCapabilities = []) {
  const capabilities = model && Array.isArray(model.capabilities) ? model.capabilities : [];
  return requiredCapabilities.every((capability) => capabilities.includes(capability));
}

function providerSupportsCapabilities(registry, providerId, modelId, requiredCapabilities = []) {
  const model = findModel(registry, providerId, modelId);
  if (!model) return false;
  return modelSupportsCapabilities(model, requiredCapabilities);
}

function getDefaultModelForTask(registry, task, requiredCapabilities = []) {
  const models = listModels(registry, { task, requiredCapabilities });
  return models[0] || null;
}

function resolveProviderBaseUrl(provider, env = process.env) {
  if (!provider) return null;
  if (provider.base_url_env && env[provider.base_url_env]) return env[provider.base_url_env];
  return provider.base_url || null;
}

function resolveProviderApiKey(provider, env = process.env) {
  if (!provider || !provider.api_key_env) return null;
  return env[provider.api_key_env] || null;
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  loadProviderRegistry,
  normalizeProviderRegistry,
  findProvider,
  findModel,
  listModels,
  modelSupportsCapabilities,
  providerSupportsCapabilities,
  getDefaultModelForTask,
  resolveProviderBaseUrl,
  resolveProviderApiKey
};
