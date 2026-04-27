"use strict";

const {
  assertValidation,
  childPath,
  createContext,
  expectArray,
  expectEnum,
  expectObject,
  expectString,
  makeValidationResult
} = require("./validation");

const LIMITATION_AREAS = ["accuracy", "speed", "cost", "ui_ux", "security", "operations"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const EFFORTS = ["low", "medium", "high"];

function validateStringArray(ctx, path, value) {
  expectArray(ctx, path, value, (item, itemPath) => {
    expectString(ctx, itemPath, item, { nonEmpty: true });
  });
}

function validateEngineeringStateAnalysisOutput(value) {
  const ctx = createContext();

  expectObject(ctx, "$", value, (root) => {
    expectString(ctx, "$.summary", root.summary, { nonEmpty: true });
    validateStringArray(ctx, "$.currentCapabilities", root.currentCapabilities);

    expectArray(ctx, "$.limitations", root.limitations, (limitation, path) => {
      expectObject(ctx, path, limitation, (item) => {
        expectEnum(ctx, childPath(path, "area"), item.area, LIMITATION_AREAS);
        expectString(ctx, childPath(path, "description"), item.description, { nonEmpty: true });
        expectString(ctx, childPath(path, "businessImpact"), item.businessImpact, { nonEmpty: true });
        expectEnum(ctx, childPath(path, "severity"), item.severity, SEVERITIES);
      });
    });

    expectObject(ctx, "$.recommendedPositioning", root.recommendedPositioning, (positioning) => {
      validateStringArray(ctx, "$.recommendedPositioning.shouldPromise", positioning.shouldPromise);
      validateStringArray(ctx, "$.recommendedPositioning.shouldNotPromise", positioning.shouldNotPromise);
      expectString(ctx, "$.recommendedPositioning.suggestedWording", positioning.suggestedWording, {
        nonEmpty: true
      });
    });

    expectArray(ctx, "$.nextEngineeringPriorities", root.nextEngineeringPriorities, (priority, path) => {
      expectObject(ctx, path, priority, (item) => {
        expectString(ctx, childPath(path, "title"), item.title, { nonEmpty: true });
        expectString(ctx, childPath(path, "rationale"), item.rationale, { nonEmpty: true });
        expectString(ctx, childPath(path, "expectedImpact"), item.expectedImpact, { nonEmpty: true });
        expectEnum(ctx, childPath(path, "effort"), item.effort, EFFORTS);
      });
    });
  });

  return makeValidationResult("EngineeringStateAnalysisOutput", value, ctx.errors);
}

function assertEngineeringStateAnalysisOutput(value) {
  return assertValidation(validateEngineeringStateAnalysisOutput(value));
}

module.exports = {
  LIMITATION_AREAS,
  SEVERITIES,
  EFFORTS,
  validateEngineeringStateAnalysisOutput,
  assertEngineeringStateAnalysisOutput
};
