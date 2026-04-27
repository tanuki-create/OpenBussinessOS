"use strict";

const v = require("./validation");

const AREAS = ["accuracy", "speed", "cost", "ui_ux", "security", "operations"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const EFFORTS = ["low", "medium", "high"];

function validateEngineeringStateAnalysisOutput(value) {
  const ctx = v.createContext();

  v.expectObject(ctx, "$", value, (root) => {
    v.expectString(ctx, "$.summary", root.summary, { nonEmpty: true });
    v.expectArray(ctx, "$.currentCapabilities", root.currentCapabilities, (item, path) => {
      v.expectString(ctx, path, item, { nonEmpty: true });
    });
    v.expectArray(ctx, "$.limitations", root.limitations, (item, path) => {
      v.expectObject(ctx, path, item, (limitation) => {
        v.expectEnum(ctx, `${path}.area`, limitation.area, AREAS);
        v.expectString(ctx, `${path}.description`, limitation.description, { nonEmpty: true });
        v.expectString(ctx, `${path}.businessImpact`, limitation.businessImpact, { nonEmpty: true });
        v.expectEnum(ctx, `${path}.severity`, limitation.severity, SEVERITIES);
      });
    });
    v.expectObject(ctx, "$.recommendedPositioning", root.recommendedPositioning, (positioning) => {
      v.expectArray(ctx, "$.recommendedPositioning.shouldPromise", positioning.shouldPromise, (item, path) => {
        v.expectString(ctx, path, item, { nonEmpty: true });
      });
      v.expectArray(ctx, "$.recommendedPositioning.shouldNotPromise", positioning.shouldNotPromise, (item, path) => {
        v.expectString(ctx, path, item, { nonEmpty: true });
      });
      v.expectString(ctx, "$.recommendedPositioning.suggestedWording", positioning.suggestedWording, { nonEmpty: true });
    });
    v.expectArray(ctx, "$.nextEngineeringPriorities", root.nextEngineeringPriorities, (item, path) => {
      v.expectObject(ctx, path, item, (priority) => {
        v.expectString(ctx, `${path}.title`, priority.title, { nonEmpty: true });
        v.expectString(ctx, `${path}.rationale`, priority.rationale, { nonEmpty: true });
        v.expectString(ctx, `${path}.expectedImpact`, priority.expectedImpact, { nonEmpty: true });
        v.expectEnum(ctx, `${path}.effort`, priority.effort, EFFORTS);
      });
    });
  });

  return v.makeValidationResult("EngineeringStateAnalysisOutput", value, ctx.errors);
}

module.exports = {
  validateEngineeringStateAnalysisOutput
};
