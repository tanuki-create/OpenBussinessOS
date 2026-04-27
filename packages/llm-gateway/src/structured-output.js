"use strict";

const { buildDeepSeekChatRequest } = require("./deepseek");

function truncateText(value, maxLength = 8000) {
  const text = String(value ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function stripJsonFence(text) {
  const trimmed = String(text || "").trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function balancedJsonCandidate(text) {
  const trimmed = stripJsonFence(text);
  if (!trimmed) return "";

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");

  const objectCandidate = objectStart !== -1 && objectEnd > objectStart
    ? trimmed.slice(objectStart, objectEnd + 1)
    : "";
  const arrayCandidate = arrayStart !== -1 && arrayEnd > arrayStart
    ? trimmed.slice(arrayStart, arrayEnd + 1)
    : "";

  if (!objectCandidate) return arrayCandidate || trimmed;
  if (!arrayCandidate) return objectCandidate || trimmed;
  return objectStart < arrayStart ? objectCandidate : arrayCandidate;
}

function parseStructuredJson(content) {
  const candidate = balancedJsonCandidate(content);
  try {
    return {
      ok: true,
      value: JSON.parse(candidate),
      candidate
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      candidate
    };
  }
}

function buildJsonRepairChatRequest({
  model,
  task,
  input,
  invalidContent,
  parseError = null,
  validationErrors = null,
  maxOutputTokens = 2200
} = {}) {
  return buildDeepSeekChatRequest({
    model,
    system: [
      "You repair structured LLM output for Open Business OS.",
      "Return only one valid JSON object that satisfies the requested task schema.",
      "Do not add Markdown fences, comments, explanations, or extra text."
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          task,
          input,
          parse_error: parseError,
          validation_errors: validationErrors,
          invalid_output: truncateText(invalidContent, 8000)
        })
      }
    ],
    responseFormat: "json",
    maxOutputTokens
  });
}

module.exports = {
  balancedJsonCandidate,
  buildJsonRepairChatRequest,
  parseStructuredJson,
  stripJsonFence,
  truncateText
};
