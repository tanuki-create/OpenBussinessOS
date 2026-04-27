import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

const SECURITY_SECRET_MODULES = [
  "packages/security/src/secrets.mjs",
  "packages/security/src/secrets.js",
  "packages/security/src/index.mjs",
  "packages/security/src/index.js",
  "packages/core/src/security/secrets.mjs",
  "packages/core/src/security/secrets.js",
  "src/security/secrets.mjs",
  "src/security/secrets.js",
  "apps/api/src/security.js"
];

const SECURITY_REDACTION_MODULES = [
  "packages/security/src/redaction.mjs",
  "packages/security/src/redaction.js",
  "packages/security/src/secrets.mjs",
  "packages/security/src/secrets.js",
  "packages/security/src/index.mjs",
  "packages/security/src/index.js",
  "packages/core/src/security/redaction.mjs",
  "packages/core/src/security/redaction.js",
  "src/security/redaction.mjs",
  "src/security/redaction.js",
  "apps/api/src/security.js"
];

const RBAC_MODULES = [
  "packages/security/src/rbac.mjs",
  "packages/security/src/rbac.js",
  "packages/security/src/index.mjs",
  "packages/security/src/index.js",
  "packages/core/src/security/rbac.mjs",
  "packages/core/src/security/rbac.js",
  "src/security/rbac.mjs",
  "src/security/rbac.js"
];

const BUSINESS_MAP_SCHEMA_MODULES = [
  "packages/schemas/src/business-map.mjs",
  "packages/schemas/src/business-map.js",
  "packages/schemas/src/index.mjs",
  "packages/schemas/src/index.js",
  "packages/core/src/schema/business-map.mjs",
  "packages/core/src/schema/business-map.js",
  "src/schema/business-map.mjs",
  "src/schema/business-map.js"
];

const INITIATIVE_SCHEMA_MODULES = [
  "packages/schemas/src/initiative.mjs",
  "packages/schemas/src/initiative.js",
  "packages/schemas/src/index.mjs",
  "packages/schemas/src/index.js",
  "packages/core/src/schema/initiative.mjs",
  "packages/core/src/schema/initiative.js",
  "src/schema/initiative.mjs",
  "src/schema/initiative.js"
];

const COST_MODULES = [
  "packages/llm-gateway/src/cost.mjs",
  "packages/llm-gateway/src/cost.js",
  "packages/llm-gateway/src/cost-estimator.mjs",
  "packages/llm-gateway/src/cost-estimator.js",
  "packages/llm-gateway/src/cost/index.mjs",
  "packages/llm-gateway/src/cost/index.js",
  "packages/llm-gateway/src/index.mjs",
  "packages/llm-gateway/src/index.js",
  "packages/core/src/llm/cost.mjs",
  "packages/core/src/llm/cost.js",
  "packages/core/src/llm/cost-estimator.mjs",
  "packages/core/src/llm/cost-estimator.js",
  "src/llm/cost.mjs",
  "src/llm/cost.js",
  "src/llm/cost-estimator.mjs",
  "src/llm/cost-estimator.js"
];

const STRUCTURED_OUTPUT_MODULES = [
  "packages/llm-gateway/src/structured-output.mjs",
  "packages/llm-gateway/src/structured-output.js",
  "packages/llm-gateway/src/index.mjs",
  "packages/llm-gateway/src/index.js"
];

const GITHUB_CONNECTOR_MODULES = [
  "apps/api/src/connectors/github.mjs",
  "apps/api/src/connectors/github.js"
];

async function importFirst(label, candidates) {
  const checked = [];
  for (const candidate of candidates) {
    const absolute = path.resolve(ROOT, candidate);
    checked.push(candidate);
    try {
      await access(absolute);
    } catch {
      continue;
    }

    try {
      return await import(pathToFileURL(absolute).href);
    } catch (error) {
      assert.fail(`Found ${candidate} for ${label}, but importing it failed: ${error.message}`);
    }
  }

  assert.fail(`Missing ${label}. Expected one of:\n${checked.map((entry) => `- ${entry}`).join("\n")}`);
}

function exported(moduleNamespace, names, label) {
  for (const name of names) {
    const value = moduleNamespace[name] ?? moduleNamespace.default?.[name];
    if (value !== undefined) return value;
  }
  assert.fail(`${label} must export one of: ${names.join(", ")}`);
}

async function callOne(label, attempts) {
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      errors.push(error?.message ?? String(error));
    }
  }
  assert.fail(`${label} did not support the expected call signatures:\n${errors.join("\n")}`);
}

function serialize(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

test("security: encrypts and decrypts API keys without leaking plaintext", async () => {
  const moduleNamespace = await importFirst("secret encryption helper", SECURITY_SECRET_MODULES);
  const encryptSecret = exported(
    moduleNamespace,
    ["encryptSecret", "encryptApiKey", "encryptProviderApiKey"],
    "secret encryption helper"
  );
  const decryptSecret = exported(
    moduleNamespace,
    ["decryptSecret", "decryptApiKey", "decryptProviderApiKey"],
    "secret decryption helper"
  );

  const plaintext = "sk-deepseek-unit-secret-1234567890";
  const context = {
    masterKey: "0123456789abcdef0123456789abcdef",
    workspaceId: "ws_unit_security"
  };

  const encrypted = await callOne("encryptSecret", [
    () => encryptSecret(plaintext, context),
    () => encryptSecret(plaintext, context.masterKey),
    () => encryptSecret({ plaintext, value: plaintext, secret: plaintext, ...context })
  ]);

  assert.notEqual(encrypted, plaintext);
  assert.ok(!serialize(encrypted).includes(plaintext), "encrypted payload must not contain plaintext");

  const decrypted = await callOne("decryptSecret", [
    () => decryptSecret(encrypted, context),
    () => decryptSecret(encrypted, context.masterKey),
    () => decryptSecret({ encrypted, ciphertext: encrypted, payload: encrypted, ...context })
  ]);

  assert.equal(decrypted, plaintext);
});

test("security: redacts provider keys and bearer tokens from logs", async () => {
  const moduleNamespace = await importFirst("redaction helper", SECURITY_REDACTION_MODULES);
  const redactSensitive = exported(
    moduleNamespace,
    ["redactSensitive", "redactSecrets", "redactForLog"],
    "redaction helper"
  );

  const secret = "sk-deepseek-unit-secret-abcdef";
  const payload = {
    provider: "deepseek_direct",
    apiKey: secret,
    headers: { authorization: `Bearer ${secret}` },
    nested: [{ note: `do not log ${secret}` }]
  };

  const redacted = await redactSensitive(payload);
  const serialized = serialize(redacted);

  assert.ok(!serialized.includes(secret), "redacted output must not contain the raw secret");
  assert.match(serialized, /redact|\*{3,}|\[REDACTED\]/i);
});

function buildValidator(moduleNamespace, functionNames, schemaNames, label) {
  for (const name of functionNames) {
    const fn = moduleNamespace[name] ?? moduleNamespace.default?.[name];
    if (typeof fn === "function") return fn;
  }

  for (const name of schemaNames) {
    const schema = moduleNamespace[name] ?? moduleNamespace.default?.[name];
    if (schema?.safeParse) {
      return (input) => {
        const result = schema.safeParse(input);
        if (!result.success) throw new Error(JSON.stringify(result.error));
        return result.data;
      };
    }
    if (schema?.parse) {
      return (input) => schema.parse(input);
    }
  }

  assert.fail(`${label} must export a validator function or schema object`);
}

async function expectValid(validator, sample, label) {
  const result = await validator(sample);
  if (result && typeof result === "object" && "success" in result) {
    assert.equal(result.success, true, `${label} should be valid`);
  } else if (result && typeof result === "object" && "ok" in result) {
    assert.equal(result.ok, true, `${label} should be valid`);
  } else {
    assert.notEqual(result, false, `${label} should be valid`);
  }
}

async function expectInvalid(validator, sample, label) {
  let rejected = false;
  try {
    const result = await validator(sample);
    rejected = result === false || result?.success === false || result?.ok === false;
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, `${label} should be rejected`);
}

test("schema: validates BusinessMapOutput shape and enums", async () => {
  const moduleNamespace = await importFirst("BusinessMapOutput schema", BUSINESS_MAP_SCHEMA_MODULES);
  const validateBusinessMap = buildValidator(
    moduleNamespace,
    ["validateBusinessMapOutput", "validateBusinessMap"],
    ["BusinessMapOutputSchema", "businessMapOutputSchema"],
    "BusinessMapOutput schema"
  );

  const validBusinessMap = {
    concept: {
      title: "Open Business OS",
      oneLiner: "A mobile-first strategy-to-execution OS for AI product teams.",
      description: "Turns a vague idea into validated assumptions, initiatives, and work items.",
      businessType: "b2b_saas"
    },
    targetUsers: [
      {
        name: "Founder",
        description: "Runs early customer discovery and MVP planning.",
        painPoints: ["Planning is scattered across chat, docs, and task tools."],
        currentAlternatives: ["Ad hoc docs", "Spreadsheets"]
      }
    ],
    idealState: {
      description: "A user can produce a traceable two-week plan from one sentence.",
      horizon: "2 weeks",
      observableOutcomes: ["Business map exported as Markdown"]
    },
    northStarMetric: {
      name: "Validated plans exported",
      definition: "Number of approved plans exported per workspace per month.",
      whyItMatters: "Export shows the user reached a reusable planning artifact.",
      caveats: ["Export alone does not prove execution quality."]
    },
    assumptions: [
      {
        statement: "Users will accept a guided flow instead of a long business-plan form.",
        type: "problem",
        riskLevel: "high",
        evidenceLevel: "weak",
        validationMethod: "Run three moderated setup tests."
      }
    ],
    risks: [
      {
        title: "AI output looks confident without evidence.",
        description: "Recommendations can be mistaken for facts.",
        severity: "high",
        mitigation: "Separate facts, assumptions, and decisions in the schema."
      }
    ],
    nextQuestions: [
      {
        question: "Who is the first user?",
        reason: "Target users drive metrics and workflow choices.",
        inputType: "short_text"
      }
    ]
  };

  await expectValid(validateBusinessMap, validBusinessMap, "valid BusinessMapOutput");
  await expectInvalid(
    validateBusinessMap,
    {
      ...validBusinessMap,
      assumptions: [{ ...validBusinessMap.assumptions[0], riskLevel: "urgent" }]
    },
    "BusinessMapOutput with invalid riskLevel"
  );
});

test("schema: validates InitiativeGenerationOutput work item traceability", async () => {
  const moduleNamespace = await importFirst(
    "InitiativeGenerationOutput schema",
    INITIATIVE_SCHEMA_MODULES
  );
  const validateInitiatives = buildValidator(
    moduleNamespace,
    ["validateInitiativeGenerationOutput", "validateInitiatives"],
    ["InitiativeGenerationOutputSchema", "initiativeGenerationOutputSchema"],
    "InitiativeGenerationOutput schema"
  );

  const validOutput = {
    initiatives: [
      {
        title: "Validate first value in 10 minutes",
        description: "Run a two-week experiment with five target users.",
        initiativeType: "product",
        relatedAssumption: "Users need structured planning more than another chat log.",
        relatedMetric: "Validated plans exported",
        hypothesis: "A guided flow increases first-session completion.",
        successCriteria: "Three of five users export a plan without support.",
        timeboxDays: 14,
        priority: "high",
        workItems: [
          {
            title: "Implement Markdown export endpoint",
            description: "Expose the traceable plan for review and sharing.",
            workType: "issue",
            acceptanceCriteria: ["Export includes assumptions, initiatives, and work items."],
            priority: "high"
          }
        ]
      }
    ]
  };

  await expectValid(validateInitiatives, validOutput, "valid InitiativeGenerationOutput");
  await expectInvalid(
    validateInitiatives,
    {
      initiatives: [
        {
          ...validOutput.initiatives[0],
          timeboxDays: 45
        }
      ]
    },
    "InitiativeGenerationOutput with out-of-range timebox"
  );
});

function costValue(result) {
  if (typeof result === "number") return result;
  for (const key of ["estimatedCostUsd", "estimated_cost_usd", "totalUsd", "total_usd", "costUsd"]) {
    const value = result?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  }
  assert.fail(`cost estimator must return a number or an object with an estimated cost field`);
}

async function estimate(estimator, input) {
  return callOne("cost estimator", [
    () => estimator(input),
    () =>
      estimator(input.inputTokens, input.outputTokens, {
        provider: input.provider,
        model: input.model,
        cacheHitTokens: input.cacheHitTokens,
        pricing: input.pricing
      })
  ]);
}

test("llm: estimates cost from token usage and model pricing", async () => {
  const moduleNamespace = await importFirst("LLM cost estimator", COST_MODULES);
  const estimateLlmCost = exported(
    moduleNamespace,
    ["estimateLlmCost", "estimateCost", "estimateProviderCost"],
    "LLM cost estimator"
  );

  const baseInput = {
    provider: "deepseek_direct",
    model: "deepseek-v4-flash",
    inputTokens: 1_000,
    outputTokens: 500,
    cacheHitTokens: 0,
    pricing: {
      inputPerMillion: 0.07,
      outputPerMillion: 0.27,
      cacheHitPerMillion: 0.014
    }
  };

  const low = costValue(await estimate(estimateLlmCost, baseInput));
  const high = costValue(
    await estimate(estimateLlmCost, {
      ...baseInput,
      inputTokens: 2_000,
      outputTokens: 1_000
    })
  );

  assert.ok(low > 0, "estimated cost must be positive for non-zero tokens");
  assert.ok(high > low, "estimated cost must increase with token usage");
});

test("llm: parses repairable JSON and builds repair prompts", async () => {
  const moduleNamespace = await importFirst("structured LLM output helper", STRUCTURED_OUTPUT_MODULES);
  const parseStructuredJson = exported(
    moduleNamespace,
    ["parseStructuredJson"],
    "structured LLM output helper"
  );
  const buildJsonRepairChatRequest = exported(
    moduleNamespace,
    ["buildJsonRepairChatRequest"],
    "structured LLM output helper"
  );

  const parsed = parseStructuredJson("```json\n{\"ok\":true,\"items\":[1]}\n```");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.ok, true);

  const invalid = parseStructuredJson("{not valid json");
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /JSON/i);

  const repairRequest = buildJsonRepairChatRequest({
    model: "deepseek-v4-flash",
    task: "business_map_generation",
    input: { one_liner: "Turn invalid JSON into a reviewable business map." },
    invalidContent: "{not valid json",
    parseError: invalid.error,
    validationErrors: [{ path: "$.concept", message: "Expected object" }]
  });

  assert.equal(repairRequest.model, "deepseek-v4-flash");
  assert.deepEqual(repairRequest.response_format, { type: "json_object" });
  assert.match(repairRequest.messages[1].content, /business_map_generation/);
  assert.match(repairRequest.messages[1].content, /validation_errors/);
});

test("github connector: dry-runs without token and creates issues with configured token", async () => {
  const moduleNamespace = await importFirst("GitHub connector", GITHUB_CONNECTOR_MODULES);
  const executeGitHubIssueAction = exported(
    moduleNamespace,
    ["executeGitHubIssueAction"],
    "GitHub connector"
  );

  const action = {
    payload: {
      title: "Create production-ready issue",
      body: "## Why\nKeep approved tool execution traceable.",
      labels: ["open-business-os", "open-business-os", "mvp"],
      source_work_item_id: "wi_unit_github"
    }
  };

  const dryRun = await executeGitHubIssueAction(action, {
    env: {},
    fetchImpl: async () => assert.fail("dry-run must not call fetch")
  });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.mode, "dry_run");
  assert.equal(dryRun.issue.labels.length, 2);
  assert.equal(dryRun.source_work_item_id, "wi_unit_github");

  let requestUrl = null;
  let requestOptions = null;
  const realRun = await executeGitHubIssueAction(action, {
    env: {
      OPEN_BUSINESS_OS_GITHUB_TOKEN: "ghp_unit_secret",
      OPEN_BUSINESS_OS_GITHUB_REPOSITORY: "open-business-os/unit"
    },
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(
        JSON.stringify({
          id: 123,
          node_id: "I_kwDOUnit",
          number: 42,
          html_url: "https://github.com/open-business-os/unit/issues/42",
          title: "Create production-ready issue",
          state: "open",
          labels: [{ name: "open-business-os" }, { name: "mvp" }]
        }),
        { status: 201, headers: { "content-type": "application/json" } }
      );
    }
  });

  assert.equal(requestUrl, "https://api.github.com/repos/open-business-os/unit/issues");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.authorization, "Bearer ghp_unit_secret");
  assert.deepEqual(JSON.parse(requestOptions.body).labels, ["open-business-os", "mvp"]);
  assert.equal(realRun.ok, true);
  assert.equal(realRun.mode, "real");
  assert.equal(realRun.externalProvider, "github");
  assert.equal(realRun.externalId, "I_kwDOUnit");
  assert.equal(realRun.externalUrl, "https://github.com/open-business-os/unit/issues/42");
  assert.ok(!JSON.stringify(realRun).includes("ghp_unit_secret"), "connector result must not leak token");
});

async function permissionResult(fn, role, action) {
  const result = await callOne(`permission check for ${role} ${action}`, [
    () => fn(role, action),
    () => fn({ role, action }),
    () => fn({ user: { role }, action }),
    () => fn({ membership: { role }, action })
  ]);

  if (typeof result === "boolean") return result;
  if (typeof result?.allowed === "boolean") return result.allowed;
  if (typeof result?.ok === "boolean") return result.ok;
  assert.fail("RBAC helper must return a boolean or an object with allowed/ok");
}

function withEnv(patch, run) {
  const previous = new Map();
  for (const key of Object.keys(patch)) {
    previous.set(key, process.env[key]);
    if (patch[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = patch[key];
    }
  }

  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function createMemoryApiStore(data, createJsonRepositories) {
  return {
    get snapshot() {
      return data;
    },
    repositoriesFor(snapshot = data) {
      return createJsonRepositories(snapshot);
    },
    async transaction(mutator) {
      return mutator(data);
    }
  };
}

function apiAuthFixture(createDefaultData) {
  const now = new Date().toISOString();
  const workspaceId = "ws_auth_unit";
  const ownerId = "user_owner_unit";
  const memberId = "user_member_unit";
  const viewerId = "user_viewer_unit";
  const data = createDefaultData();

  data.users.push(
    { id: ownerId, email: "owner@example.test", name: "Owner User", created_at: now, updated_at: now },
    { id: memberId, email: "member@example.test", name: "Member User", created_at: now, updated_at: now },
    { id: viewerId, email: "viewer@example.test", name: "Viewer User", created_at: now, updated_at: now }
  );
  data.workspaces.push({
    id: workspaceId,
    name: "Auth Unit Workspace",
    slug: "auth-unit",
    owner_user_id: ownerId,
    default_budget_mode: "cheap",
    monthly_budget_usd: 5,
    created_at: now,
    updated_at: now
  });
  data.workspace_memberships.push(
    { workspace_id: workspaceId, user_id: ownerId, role: "owner", created_at: now },
    { workspace_id: workspaceId, user_id: memberId, role: "member", created_at: now },
    { workspace_id: workspaceId, user_id: viewerId, role: "viewer", created_at: now }
  );

  return { data, workspaceId, ownerId, memberId, viewerId };
}

async function callApi(handleApi, store, method, path, { body, headers = {} } = {}) {
  const request = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  request.method = method;
  request.headers = normalizeHeaders(headers);
  request.socket = { remoteAddress: "127.0.0.1" };

  const chunks = [];
  const response = {
    statusCode: null,
    headers: {},
    writeHead(statusCode, responseHeaders = {}) {
      this.statusCode = statusCode;
      this.headers = responseHeaders;
    },
    end(chunk = "") {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
    }
  };

  try {
    await handleApi(store, request, response, new URL(`/api/v1${path}`, "http://localhost"));
  } catch (error) {
    const statuses = {
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401
    };
    response.statusCode = statuses[error.code] || 500;
    response.headers = { "content-type": "application/json; charset=utf-8" };
    chunks.length = 0;
    chunks.push(Buffer.from(JSON.stringify({ error: { code: error.code || "INTERNAL_ERROR", message: error.message, details: error.details || {} } })));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    text,
    data: text ? JSON.parse(text) : {}
  };
}

test("security: enforces MVP RBAC boundaries", async () => {
  const moduleNamespace = await importFirst("RBAC helper", RBAC_MODULES);
  const can = exported(
    moduleNamespace,
    ["hasPermission", "can", "canAccess", "isAllowed"],
    "RBAC helper"
  );

  assert.equal(await permissionResult(can, "owner", "api_key:create"), true);
  assert.equal(await permissionResult(can, "admin", "api_key:create"), false);
  assert.equal(await permissionResult(can, "member", "work_item:create"), true);
  assert.equal(await permissionResult(can, "viewer", "work_item:create"), false);
  assert.equal(await permissionResult(can, "external_advisor", "audit_log:read"), false);
});

test("api auth: token mode resolves /me from bearer and session tokens", async () => {
  const serverModule = await import(pathToFileURL(path.resolve(ROOT, "apps/api/src/server.js")).href);
  const storeModule = await import(pathToFileURL(path.resolve(ROOT, "apps/api/src/store.js")).href);
  const repositoryModule = await import(
    pathToFileURL(path.resolve(ROOT, "apps/api/src/repositories/json.js")).href
  );
  const handleApi = exported(serverModule, ["handleApi"], "API handler");
  const createDefaultData = exported(storeModule, ["createDefaultData"], "default data factory");
  const createJsonRepositories = exported(repositoryModule, ["createJsonRepositories"], "JSON repository factory");
  const { data, ownerId } = apiAuthFixture(createDefaultData);
  const store = createMemoryApiStore(data, createJsonRepositories);

  await withEnv(
    {
      OPEN_BUSINESS_OS_AUTH_MODE: "token",
      OPEN_BUSINESS_OS_AUTH_TOKENS: JSON.stringify({
        "owner-token": { userId: ownerId }
      }),
      OPEN_BUSINESS_OS_API_TOKEN: undefined,
      OPEN_BUSINESS_OS_SESSION_TOKEN: undefined,
      OPEN_BUSINESS_OS_DEV_TOKEN: undefined,
      API_TOKEN: undefined,
      SMOKE_AUTH_TOKEN: undefined
    },
    async () => {
      const missing = await callApi(handleApi, store, "GET", "/me");
      assert.equal(missing.statusCode, 401);
      assert.equal(missing.data.error?.code, "UNAUTHORIZED");

      const bearer = await callApi(handleApi, store, "GET", "/me", {
        headers: { authorization: "Bearer owner-token" }
      });
      assert.equal(bearer.statusCode, 200);
      assert.equal(bearer.data.user.id, ownerId);
      assert.equal(bearer.data.memberships.some((membership) => membership.role === "owner"), true);

      const session = await callApi(handleApi, store, "GET", "/me", {
        headers: { cookie: "obos_session=owner-token" }
      });
      assert.equal(session.statusCode, 200);
      assert.equal(session.data.user.id, ownerId);
      assert.match(session.data.auth.tokenSource, /^cookie:/);
    }
  );
});

test("api auth: workspace membership gates owner, member, viewer, and unauthenticated writes", async () => {
  const serverModule = await import(pathToFileURL(path.resolve(ROOT, "apps/api/src/server.js")).href);
  const storeModule = await import(pathToFileURL(path.resolve(ROOT, "apps/api/src/store.js")).href);
  const repositoryModule = await import(
    pathToFileURL(path.resolve(ROOT, "apps/api/src/repositories/json.js")).href
  );
  const handleApi = exported(serverModule, ["handleApi"], "API handler");
  const createDefaultData = exported(storeModule, ["createDefaultData"], "default data factory");
  const createJsonRepositories = exported(repositoryModule, ["createJsonRepositories"], "JSON repository factory");
  const { data, workspaceId, ownerId, memberId, viewerId } = apiAuthFixture(createDefaultData);
  const store = createMemoryApiStore(data, createJsonRepositories);
  const tokenConfig = {
    "owner-token": { userId: ownerId },
    "member-token": { userId: memberId },
    "viewer-token": { userId: viewerId }
  };

  await withEnv(
    {
      OPEN_BUSINESS_OS_AUTH_MODE: "token",
      OPEN_BUSINESS_OS_AUTH_TOKENS: JSON.stringify(tokenConfig),
      OPEN_BUSINESS_OS_API_TOKEN: undefined,
      OPEN_BUSINESS_OS_SESSION_TOKEN: undefined,
      OPEN_BUSINESS_OS_DEV_TOKEN: undefined,
      API_TOKEN: undefined,
      SMOKE_AUTH_TOKEN: undefined
    },
    async () => {
      const ownerApiKey = await callApi(handleApi, store, "POST", `/workspaces/${workspaceId}/api-keys`, {
        headers: { authorization: "Bearer owner-token" },
        body: { provider: "deepseek_direct", apiKey: "sk-auth-unit-owner-secret" }
      });
      assert.equal(ownerApiKey.statusCode, 201);
      assert.equal(ownerApiKey.data.apiKey.created_by ?? ownerApiKey.data.apiKey.createdBy, ownerId);

      const memberApiKey = await callApi(handleApi, store, "POST", `/workspaces/${workspaceId}/api-keys`, {
        headers: { authorization: "Bearer member-token" },
        body: { provider: "deepseek_direct", apiKey: "sk-auth-unit-member-secret" }
      });
      assert.equal(memberApiKey.statusCode, 403);
      assert.equal(memberApiKey.data.error?.code, "FORBIDDEN");

      const memberProject = await callApi(handleApi, store, "POST", "/projects", {
        headers: { authorization: "Bearer member-token" },
        body: {
          workspaceId,
          name: "Member-created project",
          oneLiner: "Membership should allow project creation for members."
        }
      });
      assert.equal(memberProject.statusCode, 201);
      assert.equal(memberProject.data.project.created_by ?? memberProject.data.project.createdBy, memberId);

      const viewerRead = await callApi(handleApi, store, "GET", `/workspaces/${workspaceId}`, {
        headers: { authorization: "Bearer viewer-token" }
      });
      assert.equal(viewerRead.statusCode, 200);

      const viewerProject = await callApi(handleApi, store, "POST", "/projects", {
        headers: { authorization: "Bearer viewer-token" },
        body: {
          workspaceId,
          name: "Viewer-created project",
          oneLiner: "Viewers must not write."
        }
      });
      assert.equal(viewerProject.statusCode, 403);
      assert.equal(viewerProject.data.error?.code, "FORBIDDEN");

      const unauthenticatedProject = await callApi(handleApi, store, "POST", "/projects", {
        body: {
          workspaceId,
          name: "Unauthenticated project",
          oneLiner: "Missing tokens must not write."
        }
      });
      assert.equal(unauthenticatedProject.statusCode, 401);
      assert.equal(unauthenticatedProject.data.error?.code, "UNAUTHORIZED");
    }
  );
});

test("repositories: JSON repository exposes project memory graph boundary", async () => {
  const storeModule = await import(pathToFileURL(path.resolve(ROOT, "apps/api/src/store.js")).href);
  const repositoryModule = await import(
    pathToFileURL(path.resolve(ROOT, "apps/api/src/repositories/json.js")).href
  );
  const createDefaultData = exported(storeModule, ["createDefaultData"], "default data factory");
  const DEFAULT_WORKSPACE_ID = exported(storeModule, ["DEFAULT_WORKSPACE_ID"], "default workspace id");
  const createJsonRepositories = exported(
    repositoryModule,
    ["createJsonRepositories"],
    "JSON repository factory"
  );

  const data = createDefaultData();
  const repos = createJsonRepositories(data);
  const project = repos.projects.insert({
    workspace_id: DEFAULT_WORKSPACE_ID,
    name: "Repository boundary",
    one_liner: "Keep JSON and PostgreSQL stores behind the same API.",
    status: "active"
  });
  const assumption = repos.memory.upsertNode({
    workspace_id: DEFAULT_WORKSPACE_ID,
    project_id: project.id,
    node_type: "assumption",
    source_entity_type: "assumption",
    source_entity_id: "00000000-0000-4000-8000-000000000100",
    title: "Repository boundary is useful",
    body: "The API can keep moving while storage changes.",
    status: "active"
  });
  const metric = repos.memory.upsertNode({
    workspace_id: DEFAULT_WORKSPACE_ID,
    project_id: project.id,
    node_type: "metric",
    source_entity_type: "metric",
    source_entity_id: "00000000-0000-4000-8000-000000000101",
    title: "Smoke test pass rate",
    status: "active"
  });
  const edge = repos.memory.upsertEdge({
    workspace_id: DEFAULT_WORKSPACE_ID,
    project_id: project.id,
    from_node_id: assumption.id,
    to_node_id: metric.id,
    relation_type: "measured_by"
  });
  const graph = repos.memory.graphForProject(project.id);

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(edge.relation_type, "measured_by");
  assert.equal(repos.projects.snapshot(project.id).project.id, project.id);
});

test("repositories: PostgreSQL table mapping covers store collections", async () => {
  const storeModule = await import(pathToFileURL(path.resolve(ROOT, "apps/api/src/store.js")).href);
  const repositoryModule = await import(
    pathToFileURL(path.resolve(ROOT, "apps/api/src/repositories/postgres.js")).href
  );
  const COLLECTIONS = exported(storeModule, ["COLLECTIONS"], "store collections");
  const TABLES = exported(repositoryModule, ["TABLES"], "PostgreSQL table mapping");
  const mapped = new Set(TABLES.map((table) => table.collection));

  for (const collection of COLLECTIONS) {
    assert.ok(mapped.has(collection), `PostgreSQL table mapping must include ${collection}`);
  }

  const apiKeys = TABLES.find((table) => table.collection === "api_keys");
  assert.ok(apiKeys.columns.includes("encrypted_key"), "api_keys mapping must persist encrypted keys");

  const memoryNodes = TABLES.find((table) => table.collection === "memory_nodes");
  assert.ok(memoryNodes.columns.includes("source_entity_id"), "memory node mapping must keep source trace");
});
