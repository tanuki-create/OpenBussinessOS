"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_DATA_PATH = path.resolve(
  __dirname,
  "../../../data/open-business-os.json",
);

const DEFAULT_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

const COLLECTIONS = [
  "users",
  "workspaces",
  "workspace_memberships",
  "projects",
  "visions",
  "metrics",
  "assumptions",
  "evidence",
  "assumption_evidence",
  "decisions",
  "initiatives",
  "work_items",
  "reviews",
  "playbook_runs",
  "ai_runs",
  "api_keys",
  "budgets",
  "cost_ledger",
  "tool_actions",
  "audit_logs",
  "business_maps",
  "memory_nodes",
  "memory_edges",
  "project_memory_summaries",
];

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function createDefaultData() {
  const now = nowIso();

  return {
    schema_version: 1,
    users: [
      {
        id: DEFAULT_USER_ID,
        email: "local@open-business-os.dev",
        name: "Local User",
        created_at: now,
        updated_at: now,
      },
    ],
    workspaces: [
      {
        id: DEFAULT_WORKSPACE_ID,
        name: "Local Workspace",
        slug: "local",
        owner_user_id: DEFAULT_USER_ID,
        default_budget_mode: "cheap",
        monthly_budget_usd: 5,
        created_at: now,
        updated_at: now,
      },
    ],
    workspace_memberships: [
      {
        workspace_id: DEFAULT_WORKSPACE_ID,
        user_id: DEFAULT_USER_ID,
        role: "owner",
        created_at: now,
      },
    ],
    projects: [],
    visions: [],
    metrics: [],
    assumptions: [],
    evidence: [],
    assumption_evidence: [],
    decisions: [],
    initiatives: [],
    work_items: [],
    reviews: [],
    playbook_runs: [],
    ai_runs: [],
    api_keys: [],
    budgets: [
      {
        id: createId(),
        workspace_id: DEFAULT_WORKSPACE_ID,
        scope: "workspace",
        scope_id: DEFAULT_WORKSPACE_ID,
        limit_usd: 5,
        period: "monthly",
        hard_limit: false,
        created_at: now,
      },
    ],
    cost_ledger: [],
    tool_actions: [],
    audit_logs: [],
    business_maps: [],
    memory_nodes: [],
    memory_edges: [],
    project_memory_summaries: [],
  };
}

function normalizeData(data) {
  const normalized = data && typeof data === "object" ? data : createDefaultData();
  normalized.schema_version = normalized.schema_version || 1;

  for (const collection of COLLECTIONS) {
    if (!Array.isArray(normalized[collection])) {
      normalized[collection] = [];
    }
  }

  if (normalized.users.length === 0) {
    const defaults = createDefaultData();
    normalized.users.push(...defaults.users);
    normalized.workspaces.push(...defaults.workspaces);
    normalized.workspace_memberships.push(...defaults.workspace_memberships);
    normalized.budgets.push(...defaults.budgets);
  }

  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class JsonStore {
  constructor(filePath = DEFAULT_DATA_PATH) {
    this.filePath = filePath;
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.data = normalizeData(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.data = createDefaultData();
      await this.save();
    }

    return this;
  }

  get snapshot() {
    if (!this.data) {
      throw new Error("Store has not been initialized.");
    }
    return this.data;
  }

  async save() {
    if (!this.data) {
      throw new Error("Store has not been initialized.");
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async transaction(mutator) {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const before = clone(this.snapshot);
      try {
        const result = await mutator(this.snapshot);
        await this.save();
        return result;
      } catch (error) {
        this.data = before;
        throw error;
      }
    });

    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

function publicApiKey(apiKey) {
  return {
    id: apiKey.id,
    workspace_id: apiKey.workspace_id,
    provider: apiKey.provider,
    key_hint: apiKey.key_hint,
    status: apiKey.status,
    created_by: apiKey.created_by,
    created_at: apiKey.created_at,
    updated_at: apiKey.updated_at,
  };
}

function createAuditLog({
  workspaceId,
  actorUserId = DEFAULT_USER_ID,
  action,
  entityType,
  entityId,
  metadata = {},
  request,
}) {
  return {
    id: createId(),
    workspace_id: workspaceId || null,
    actor_user_id: actorUserId || null,
    action,
    entity_type: entityType || null,
    entity_id: entityId || null,
    metadata,
    ip_address:
      request?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      request?.socket?.remoteAddress ||
      null,
    user_agent: request?.headers?.["user-agent"] || null,
    created_at: nowIso(),
  };
}

module.exports = {
  COLLECTIONS,
  DEFAULT_DATA_PATH,
  DEFAULT_USER_ID,
  DEFAULT_WORKSPACE_ID,
  JsonStore,
  createAuditLog,
  createDefaultData,
  createId,
  nowIso,
  publicApiKey,
};
