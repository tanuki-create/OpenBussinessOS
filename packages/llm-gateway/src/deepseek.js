"use strict";

function buildDeepSeekChatRequest({ model, system, messages, responseFormat = "json", maxOutputTokens = 1600 }) {
  const body = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...(messages || [])
    ],
    max_tokens: maxOutputTokens,
    temperature: 0.2
  };

  if (responseFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  return body;
}

async function callDeepSeek({ apiKey, baseUrl, request, timeoutMs = 45000 }) {
  if (!apiKey) throw new Error("DeepSeek API key is required.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl || "https://api.deepseek.com"}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error?.message || `DeepSeek request failed with ${response.status}`);
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildDeepSeekChatRequest,
  callDeepSeek
};
