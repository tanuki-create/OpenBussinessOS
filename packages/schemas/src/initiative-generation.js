"use strict";

const v = require("./validation");

const INITIATIVE_TYPES = ["product", "engineering", "marketing", "sales", "security", "operations", "research", "customer_success"];
const WORK_TYPES = ["issue", "task", "bug", "research", "design", "security", "ops", "sales", "marketing"];
const PRIORITIES = ["low", "medium", "high", "critical"];

function validateInitiativeGenerationOutput(value) {
  const ctx = v.createContext();

  v.expectObject(ctx, "$", value, (root) => {
    v.expectArray(ctx, "$.initiatives", root.initiatives, (item, path) => {
      v.expectObject(ctx, path, item, (initiative) => {
        v.expectString(ctx, `${path}.title`, initiative.title, { nonEmpty: true });
        v.expectString(ctx, `${path}.description`, initiative.description, { nonEmpty: true });
        v.expectEnum(ctx, `${path}.initiativeType`, initiative.initiativeType, INITIATIVE_TYPES);
        v.expectString(ctx, `${path}.relatedAssumption`, initiative.relatedAssumption, { nonEmpty: true });
        v.expectOptionalString(ctx, `${path}.relatedMetric`, initiative.relatedMetric);
        v.expectString(ctx, `${path}.hypothesis`, initiative.hypothesis, { nonEmpty: true });
        v.expectString(ctx, `${path}.successCriteria`, initiative.successCriteria, { nonEmpty: true });
        v.expectNumber(ctx, `${path}.timeboxDays`, initiative.timeboxDays, { integer: true, min: 1, max: 30 });
        v.expectEnum(ctx, `${path}.priority`, initiative.priority, PRIORITIES);
        v.expectArray(ctx, `${path}.workItems`, initiative.workItems, (workItem, workPath) => {
          v.expectObject(ctx, workPath, workItem, (work) => {
            v.expectString(ctx, `${workPath}.title`, work.title, { nonEmpty: true });
            v.expectString(ctx, `${workPath}.description`, work.description, { nonEmpty: true });
            v.expectEnum(ctx, `${workPath}.workType`, work.workType, WORK_TYPES);
            v.expectArray(ctx, `${workPath}.acceptanceCriteria`, work.acceptanceCriteria, (criterion, criterionPath) => {
              v.expectString(ctx, criterionPath, criterion, { nonEmpty: true });
            });
            v.expectEnum(ctx, `${workPath}.priority`, work.priority, PRIORITIES);
          });
        }, { minLength: 1 });
      });
    }, { minLength: 1 });
  });

  return v.makeValidationResult("InitiativeGenerationOutput", value, ctx.errors);
}

module.exports = {
  validateInitiativeGenerationOutput
};
