"use strict";

class SchemaValidationError extends Error {
  constructor(schemaName, errors) {
    super(`${schemaName} validation failed`);
    this.name = "SchemaValidationError";
    this.schemaName = schemaName;
    this.errors = errors;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function childPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  if (path === "$") return `$.${key}`;
  return `${path}.${key}`;
}

function addError(ctx, path, message, code) {
  ctx.errors.push({ path, message, code: code || "invalid_type" });
}

function expectObject(ctx, path, value, validate) {
  if (!isPlainObject(value)) {
    addError(ctx, path, "Expected object");
    return;
  }
  validate(value);
}

function expectArray(ctx, path, value, validateItem, options = {}) {
  if (!Array.isArray(value)) {
    addError(ctx, path, "Expected array");
    return;
  }
  if (options.minLength !== undefined && value.length < options.minLength) {
    addError(ctx, path, `Expected at least ${options.minLength} items`, "too_small");
  }
  value.forEach((item, index) => validateItem(item, childPath(path, index)));
}

function expectString(ctx, path, value, options = {}) {
  if (typeof value !== "string") {
    addError(ctx, path, "Expected string");
    return;
  }
  if (options.nonEmpty && value.trim() === "") {
    addError(ctx, path, "Expected non-empty string", "too_small");
  }
}

function expectOptionalString(ctx, path, value, options = {}) {
  if (value === undefined || value === null) return;
  expectString(ctx, path, value, options);
}

function expectNumber(ctx, path, value, options = {}) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    addError(ctx, path, "Expected number");
    return;
  }
  if (options.integer && !Number.isInteger(value)) {
    addError(ctx, path, "Expected integer", "invalid_number");
  }
  if (options.min !== undefined && value < options.min) {
    addError(ctx, path, `Expected number >= ${options.min}`, "too_small");
  }
  if (options.max !== undefined && value > options.max) {
    addError(ctx, path, `Expected number <= ${options.max}`, "too_big");
  }
}

function expectEnum(ctx, path, value, allowed) {
  if (!allowed.includes(value)) {
    addError(ctx, path, `Expected one of: ${allowed.join(", ")}`, "invalid_enum");
  }
}

function expectOptionalObject(ctx, path, value, validate) {
  if (value === undefined || value === null) return;
  expectObject(ctx, path, value, validate);
}

function makeValidationResult(schemaName, value, errors) {
  return {
    ok: errors.length === 0,
    schemaName,
    value: errors.length === 0 ? value : undefined,
    errors
  };
}

function assertValidation(result) {
  if (!result.ok) {
    throw new SchemaValidationError(result.schemaName, result.errors);
  }
  return result.value;
}

function createContext() {
  return { errors: [] };
}

module.exports = {
  SchemaValidationError,
  isPlainObject,
  childPath,
  addError,
  expectObject,
  expectArray,
  expectString,
  expectOptionalString,
  expectNumber,
  expectEnum,
  expectOptionalObject,
  makeValidationResult,
  assertValidation,
  createContext
};
