"use strict";

const { JsonStore } = require("../store");
const { createJsonRepositories } = require("./json");
const { createPostgresStore } = require("./postgres");

async function createJsonStore(options = {}) {
  const store = await new JsonStore(options.dataPath).init();
  store.repositoryMode = "json";
  store.repositoriesFor = (data = store.snapshot) => createJsonRepositories(data);
  return store;
}

async function createStore(options = {}) {
  const mode = options.mode || process.env.OPEN_BUSINESS_OS_STORE || "json";
  if (mode === "postgres") {
    return createPostgresStore(options);
  }
  return createJsonStore(options);
}

module.exports = {
  createJsonRepositories,
  createJsonStore,
  createStore
};
