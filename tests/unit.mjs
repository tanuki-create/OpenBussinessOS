import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
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
