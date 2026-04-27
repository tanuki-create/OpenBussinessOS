"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

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

module.exports = {
  createPostgresPool,
  ensurePostgresSchema,
  loadPg
};
