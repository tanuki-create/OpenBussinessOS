"use strict";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /(?:api[_-]?key|token|secret)\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{8,})["']?/gi,
  /Bearer\s+[A-Za-z0-9_./+=-]{8,}/gi
];

function redactText(value) {
  if (typeof value !== "string") return value;
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, (match) => {
      if (/Bearer\s+/i.test(match)) return "Bearer [REDACTED]";
      if (/^sk-[A-Za-z0-9_-]+$/.test(match)) return "[REDACTED]";
      return match.replace(/([:=]\s*["']?)(.+?)(["']?)$/i, "$1[REDACTED]$3");
    }),
    value
  );
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== "object") return redactText(value);

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (/api.?key|token|secret|password/i.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactObject(child);
    }
  }
  return result;
}

module.exports = {
  redactForLog: redactObject,
  redactObject,
  redactSecrets: redactObject,
  redactSensitive: redactObject,
  redactText
};
