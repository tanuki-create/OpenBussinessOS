"use strict";

const v = require("./validation");

const ASSUMPTION_TYPES = [
  "customer",
  "problem",
  "solution",
  "market",
  "pricing",
  "technical",
  "gtm",
  "security",
  "operations"
];
const RISK_LEVELS = ["low", "medium", "high", "critical"];
const EVIDENCE_LEVELS = ["none", "weak", "medium", "strong"];
const INPUT_TYPES = ["short_text", "long_text", "single_select", "multi_select"];

function validateBusinessMapOutput(value) {
  const ctx = v.createContext();

  v.expectObject(ctx, "$", value, (root) => {
    v.expectObject(ctx, "$.concept", root.concept, (concept) => {
      v.expectString(ctx, "$.concept.title", concept.title, { nonEmpty: true });
      v.expectString(ctx, "$.concept.oneLiner", concept.oneLiner, { nonEmpty: true });
      v.expectString(ctx, "$.concept.description", concept.description, { nonEmpty: true });
      v.expectString(ctx, "$.concept.businessType", concept.businessType, { nonEmpty: true });
    });

    v.expectArray(ctx, "$.targetUsers", root.targetUsers, (user, path) => {
      v.expectObject(ctx, path, user, (targetUser) => {
        v.expectString(ctx, `${path}.name`, targetUser.name, { nonEmpty: true });
        v.expectString(ctx, `${path}.description`, targetUser.description, { nonEmpty: true });
        v.expectArray(ctx, `${path}.painPoints`, targetUser.painPoints, (item, itemPath) => {
          v.expectString(ctx, itemPath, item, { nonEmpty: true });
        });
        v.expectArray(ctx, `${path}.currentAlternatives`, targetUser.currentAlternatives, (item, itemPath) => {
          v.expectString(ctx, itemPath, item, { nonEmpty: true });
        });
      });
    }, { minLength: 1 });

    v.expectObject(ctx, "$.idealState", root.idealState, (ideal) => {
      v.expectString(ctx, "$.idealState.description", ideal.description, { nonEmpty: true });
      v.expectString(ctx, "$.idealState.horizon", ideal.horizon, { nonEmpty: true });
      v.expectArray(ctx, "$.idealState.observableOutcomes", ideal.observableOutcomes, (item, path) => {
        v.expectString(ctx, path, item, { nonEmpty: true });
      });
    });

    v.expectObject(ctx, "$.northStarMetric", root.northStarMetric, (metric) => {
      v.expectString(ctx, "$.northStarMetric.name", metric.name, { nonEmpty: true });
      v.expectString(ctx, "$.northStarMetric.definition", metric.definition, { nonEmpty: true });
      v.expectString(ctx, "$.northStarMetric.whyItMatters", metric.whyItMatters, { nonEmpty: true });
      v.expectArray(ctx, "$.northStarMetric.caveats", metric.caveats, (item, path) => {
        v.expectString(ctx, path, item, { nonEmpty: true });
      });
    });

    v.expectArray(ctx, "$.assumptions", root.assumptions, (item, path) => {
      v.expectObject(ctx, path, item, (assumption) => {
        v.expectString(ctx, `${path}.statement`, assumption.statement, { nonEmpty: true });
        v.expectEnum(ctx, `${path}.type`, assumption.type, ASSUMPTION_TYPES);
        v.expectEnum(ctx, `${path}.riskLevel`, assumption.riskLevel, RISK_LEVELS);
        v.expectEnum(ctx, `${path}.evidenceLevel`, assumption.evidenceLevel, EVIDENCE_LEVELS);
        v.expectString(ctx, `${path}.validationMethod`, assumption.validationMethod, { nonEmpty: true });
      });
    }, { minLength: 1 });

    v.expectArray(ctx, "$.risks", root.risks, (item, path) => {
      v.expectObject(ctx, path, item, (risk) => {
        v.expectString(ctx, `${path}.title`, risk.title, { nonEmpty: true });
        v.expectString(ctx, `${path}.description`, risk.description, { nonEmpty: true });
        v.expectEnum(ctx, `${path}.severity`, risk.severity, RISK_LEVELS);
        v.expectString(ctx, `${path}.mitigation`, risk.mitigation, { nonEmpty: true });
      });
    });

    v.expectArray(ctx, "$.nextQuestions", root.nextQuestions || [], (item, path) => {
      v.expectObject(ctx, path, item, (question) => {
        v.expectString(ctx, `${path}.question`, question.question, { nonEmpty: true });
        v.expectString(ctx, `${path}.reason`, question.reason, { nonEmpty: true });
        v.expectEnum(ctx, `${path}.inputType`, question.inputType, INPUT_TYPES);
      });
    });
  });

  return v.makeValidationResult("BusinessMapOutput", value, ctx.errors);
}

module.exports = {
  validateBusinessMapOutput
};
