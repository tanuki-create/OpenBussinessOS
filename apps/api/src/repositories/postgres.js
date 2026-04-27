"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { COLLECTIONS, createDefaultData, normalizeData } = require("../store");
const { createJsonRepositories } = require("./json");

const TABLES = [
  {
    collection: "users",
    table: "users",
    columns: ["id", "email", "name", "created_at", "updated_at"]
  },
  {
    collection: "workspaces",
    table: "workspaces",
    columns: ["id", "name", "slug", "owner_user_id", "default_budget_mode", "monthly_budget_usd", "created_at", "updated_at"]
  },
  {
    collection: "workspace_memberships",
    table: "workspace_memberships",
    columns: ["workspace_id", "user_id", "role", "created_at"]
  },
  {
    collection: "projects",
    table: "projects",
    columns: ["id", "workspace_id", "name", "one_liner", "business_type", "status", "created_by", "created_at", "updated_at"]
  },
  {
    collection: "budgets",
    table: "budgets",
    columns: ["id", "workspace_id", "scope", "scope_id", "limit_usd", "period", "hard_limit", "created_at"]
  },
  {
    collection: "visions",
    table: "visions",
    columns: ["id", "project_id", "title", "concept", "target_market", "target_users", "ideal_state", "success_horizon", "status", "source", "created_by", "approved_by", "approved_at", "created_at", "updated_at"]
  },
  {
    collection: "metrics",
    table: "metrics",
    columns: ["id", "project_id", "name", "description", "metric_type", "unit", "target_value", "current_value", "target_date", "parent_metric_id", "status", "created_at", "updated_at"]
  },
  {
    collection: "assumptions",
    table: "assumptions",
    columns: ["id", "project_id", "statement", "assumption_type", "evidence_level", "status", "risk_level", "related_metric_id", "created_by", "created_at", "updated_at"]
  },
  {
    collection: "evidence",
    table: "evidence",
    columns: ["id", "project_id", "title", "evidence_type", "summary", "body", "source_url", "file_id", "strength", "captured_at", "created_by", "created_at"]
  },
  {
    collection: "assumption_evidence",
    table: "assumption_evidence",
    columns: ["assumption_id", "evidence_id", "relation_type", "created_at"]
  },
  {
    collection: "decisions",
    table: "decisions",
    columns: ["id", "project_id", "title", "decision", "rationale", "alternatives", "decided_by", "decided_at", "status", "created_at"]
  },
  {
    collection: "initiatives",
    table: "initiatives",
    columns: ["id", "project_id", "title", "description", "initiative_type", "hypothesis", "success_criteria", "start_date", "due_date", "status", "priority", "related_metric_id", "related_assumption_id", "created_by", "created_at", "updated_at"]
  },
  {
    collection: "work_items",
    table: "work_items",
    columns: ["id", "project_id", "initiative_id", "title", "description", "acceptance_criteria", "work_type", "status", "priority", "assignee_user_id", "external_provider", "external_id", "external_url", "created_by", "created_at", "updated_at"]
  },
  {
    collection: "reviews",
    table: "reviews",
    columns: ["id", "project_id", "title", "review_type", "period_start", "period_end", "summary", "learnings", "next_actions", "created_by", "created_at"]
  },
  {
    collection: "playbook_runs",
    table: "playbook_runs",
    columns: ["id", "workspace_id", "project_id", "playbook_id", "input", "output", "status", "created_by", "started_at", "completed_at", "approved_by", "approved_at", "applied_at", "memory_summary_id", "created_at"]
  },
  {
    collection: "ai_runs",
    table: "ai_runs",
    columns: ["id", "workspace_id", "project_id", "playbook_run_id", "task", "provider", "model", "budget_mode", "prompt_hash", "input_tokens", "output_tokens", "cache_hit_tokens", "estimated_cost_usd", "latency_ms", "status", "error", "created_by", "created_at"]
  },
  {
    collection: "api_keys",
    table: "api_keys",
    columns: ["id", "workspace_id", "provider", "encrypted_key", "key_hint", "status", "created_by", "created_at", "updated_at"]
  },
  {
    collection: "cost_ledger",
    table: "cost_ledger",
    columns: ["id", "workspace_id", "project_id", "ai_run_id", "provider", "model", "input_tokens", "output_tokens", "cache_hit_tokens", "estimated_cost_usd", "created_at"]
  },
  {
    collection: "tool_actions",
    table: "tool_actions",
    columns: ["id", "workspace_id", "project_id", "tool_provider", "action_type", "payload", "preview", "status", "requested_by", "approved_by", "approved_at", "executed_at", "result", "created_at"]
  },
  {
    collection: "audit_logs",
    table: "audit_logs",
    columns: ["id", "workspace_id", "actor_user_id", "action", "entity_type", "entity_id", "metadata", "ip_address", "user_agent", "created_at"]
  },
  {
    collection: "business_maps",
    table: "business_maps",
    columns: ["id", "project_id", "status", "output", "created_by", "approved_by", "approved_at", "created_at", "updated_at"]
  },
  {
    collection: "memory_nodes",
    table: "memory_nodes",
    columns: ["id", "workspace_id", "project_id", "node_type", "source_entity_type", "source_entity_id", "title", "body", "status", "importance", "confidence", "valid_from", "valid_until", "last_accessed_at", "metadata", "created_by", "created_at", "updated_at"]
  },
  {
    collection: "memory_edges",
    table: "memory_edges",
    columns: ["id", "workspace_id", "project_id", "from_node_id", "to_node_id", "relation_type", "strength", "metadata", "created_by", "created_at"]
  },
  {
    collection: "project_memory_summaries",
    table: "project_memory_summaries",
    columns: ["id", "workspace_id", "project_id", "summary_type", "body", "source_node_ids", "source_edge_ids", "token_estimate", "version", "created_at"]
  }
];

const JSON_COLUMNS = new Set([
  "target_users",
  "alternatives",
  "acceptance_criteria",
  "learnings",
  "next_actions",
  "input",
  "output",
  "payload",
  "result",
  "metadata"
]);

function toDbValue(column, value) {
  if (value === undefined) return null;
  if (JSON_COLUMNS.has(column)) {
    return value === null ? null : JSON.stringify(value);
  }
  return value;
}

function rowForLoad(row) {
  return { ...row };
}

function loadPg() {
  try {
    return require("pg");
  } catch (error) {
    const wrapped = new Error(
      "PostgreSQL mode requires the optional pg package. Run npm install pg before setting OPEN_BUSINESS_OS_STORE=postgres."
    );
    wrapped.code = "POSTGRES_DRIVER_NOT_CONFIGURED";
    wrapped.cause = error;
    throw wrapped;
  }
}

async function createPostgresPool({ databaseUrl = process.env.DATABASE_URL } = {}) {
  if (!databaseUrl) {
    const error = new Error("DATABASE_URL is required for PostgreSQL store mode.");
    error.code = "POSTGRES_DATABASE_URL_REQUIRED";
    throw error;
  }
  const { Pool } = loadPg();
  return new Pool({ connectionString: databaseUrl });
}

async function ensurePostgresSchema(pool, schemaPath = path.resolve(__dirname, "../../../../packages/db/schema.sql")) {
  const sql = await fs.readFile(schemaPath, "utf8");
  await pool.query(sql);
}

class PostgresStore {
  constructor(pool) {
    this.pool = pool;
    this.data = null;
    this.writeQueue = Promise.resolve();
    this.repositoryMode = "postgres";
  }

  async init() {
    this.data = normalizeData(await this.load());
    if (this.data.users.length === 0) {
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

  repositoriesFor(data = this.snapshot) {
    return createJsonRepositories(data);
  }

  async load() {
    const data = { schema_version: 1 };
    for (const collection of COLLECTIONS) {
      data[collection] = [];
    }
    for (const config of TABLES) {
      const columns = config.columns.map((column) => `"${column}"`).join(", ");
      const result = await this.pool.query(`select ${columns} from ${config.table}`);
      data[config.collection] = result.rows.map(rowForLoad);
    }
    return data;
  }

  async save(client = this.pool) {
    const reverseTables = TABLES.slice().reverse();
    for (const config of reverseTables) {
      await client.query(`delete from ${config.table}`);
    }
    for (const config of TABLES) {
      const rows = this.snapshot[config.collection] || [];
      for (const row of rows) {
        await insertRow(client, config, row);
      }
    }
  }

  async transaction(mutator) {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const before = JSON.parse(JSON.stringify(this.snapshot));
      const client = await this.pool.connect();
      try {
        await client.query("begin");
        const result = await mutator(this.snapshot);
        await this.save(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        this.data = before;
        throw error;
      } finally {
        client.release();
      }
    });

    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async close() {
    await this.pool.end();
  }
}

async function insertRow(client, config, row) {
  const columns = config.columns.filter((column) => row[column] !== undefined);
  if (columns.length === 0) return;
  const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  const values = columns.map((column) => toDbValue(column, row[column]));
  await client.query(`insert into ${config.table} (${quotedColumns}) values (${placeholders})`, values);
}

async function createPostgresStore(options = {}) {
  const pool = options.pool || await createPostgresPool({ databaseUrl: options.databaseUrl });
  if (options.ensureSchema ?? process.env.OPEN_BUSINESS_OS_INIT_DB !== "0") {
    await ensurePostgresSchema(pool, options.schemaPath);
  }
  return new PostgresStore(pool).init();
}

module.exports = {
  PostgresStore,
  TABLES,
  createPostgresStore,
  createPostgresPool,
  ensurePostgresSchema,
  loadPg
};
