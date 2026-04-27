"use strict";

const v = require("./validation");

function makeApiError(code, message, details) {
  return {
    error: {
      code,
      message,
      details: details || {}
    }
  };
}

function validateApiError(value) {
  const ctx = v.createContext();
  v.expectObject(ctx, "$", value, (root) => {
    v.expectObject(ctx, "$.error", root.error, (error) => {
      v.expectString(ctx, "$.error.code", error.code, { nonEmpty: true });
      v.expectString(ctx, "$.error.message", error.message, { nonEmpty: true });
      v.expectOptionalObject(ctx, "$.error.details", error.details, () => {});
    });
  });
  return v.makeValidationResult("ApiError", value, ctx.errors);
}

module.exports = {
  makeApiError,
  validateApiError
};
