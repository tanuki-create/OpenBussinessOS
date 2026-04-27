"use strict";

const { JsonStore } = require("../store");
const { createJsonRepositories } = require("./json");
const { createPostgresPool, ensurePostgresSchema } = require("./postgres");

async function createJsonStore(options = {}) {
  const store = await new JsonStore(options.dataPath).init();
  store.repositoryMode = "json";
  store.repositoriesFor = (data = store.snapshot) => createJsonRepositories(data);
  return store;
}

async function createStore(options = {}) {
  const mode = options.mode || process.env.OPEN_BUSINESS_OS_STORE || "json";
  if (mode === "postgres") {
    const pool = await createPostgresPool({ databaseUrl: options.databaseUrl });
    if (options.ensureSchema ?? process.env.OPEN_BUSINESS_OS_INIT_DB === "1") {
      await ensurePostgresSchema(pool, options.schemaPath);
    }
    const error = new Error(
      "PostgreSQL connection is configured, but the runtime repositories are not enabled yet. Use OPEN_BUSINESS_OS_STORE=json for the current MVP."
    );
    error.code = "POSTGRES_REPOSITORY_NOT_ENABLED";
    error.details = { mode: "postgres" };
    await pool.end();
    throw error;
  }
  return createJsonStore(options);
}

module.exports = {
  createJsonRepositories,
  createJsonStore,
  createStore
};
