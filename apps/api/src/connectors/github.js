"use strict";

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const label = cleanString(value);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

function githubTokenFromEnv(env = process.env) {
  return cleanString(
    env.OPEN_BUSINESS_OS_GITHUB_TOKEN ||
      env.OPEN_BUSINESS_OS_GITHUB_PAT
  );
}

function parseRepository(value) {
  const text = cleanString(value);
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(text);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

function githubRepositoryFromEnv(env = process.env) {
  const owner = cleanString(env.OPEN_BUSINESS_OS_GITHUB_OWNER || env.GITHUB_OWNER);
  const repo = cleanString(env.OPEN_BUSINESS_OS_GITHUB_REPO || env.GITHUB_REPO);
  if (owner && repo) return { owner, repo };

  return parseRepository(env.OPEN_BUSINESS_OS_GITHUB_REPOSITORY || env.GITHUB_REPOSITORY);
}

function githubRepositoryFromPayload(payload = {}) {
  const owner = cleanString(payload.owner);
  const repo = cleanString(payload.repo);
  if (owner && repo) return { owner, repo };
  return parseRepository(payload.repository);
}

function resolveGitHubRepository(payload = {}, env = process.env) {
  return githubRepositoryFromPayload(payload) || githubRepositoryFromEnv(env);
}

function validateGitHubIssuePayload(payload = {}) {
  const title = cleanString(payload.title);
  if (!title) {
    const error = new Error("GitHub issue title is required.");
    error.code = "VALIDATION_ERROR";
    error.details = { field: "payload.title" };
    throw error;
  }

  if (payload.labels !== undefined && !Array.isArray(payload.labels)) {
    const error = new Error("GitHub issue labels must be an array.");
    error.code = "VALIDATION_ERROR";
    error.details = { field: "payload.labels" };
    throw error;
  }

  if (payload.assignees !== undefined && !Array.isArray(payload.assignees)) {
    const error = new Error("GitHub issue assignees must be an array.");
    error.code = "VALIDATION_ERROR";
    error.details = { field: "payload.assignees" };
    throw error;
  }

  return {
    title,
    body: typeof payload.body === "string" ? payload.body : "",
    labels: uniqueStrings(payload.labels || []),
    assignees: uniqueStrings(payload.assignees || []),
    source_work_item_id: payload.source_work_item_id || payload.sourceWorkItemId || null,
    source_initiative_id: payload.source_initiative_id || payload.sourceInitiativeId || null
  };
}

function publicIssueDraft(issue) {
  return {
    title: issue.title,
    body: issue.body,
    labels: issue.labels,
    assignees: issue.assignees
  };
}

function issueIdFromResponse(body = {}) {
  if (body.node_id) return String(body.node_id);
  if (body.id !== undefined && body.id !== null) return String(body.id);
  if (body.number !== undefined && body.number !== null) return String(body.number);
  return null;
}

function issueSummaryFromResponse(body = {}) {
  return {
    id: body.id === undefined || body.id === null ? null : String(body.id),
    node_id: body.node_id || null,
    number: body.number || null,
    title: body.title || null,
    state: body.state || null,
    html_url: body.html_url || null,
    labels: Array.isArray(body.labels)
      ? body.labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
      : []
  };
}

async function readGitHubResponseBody(response) {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 500) };
  }
}

async function executeGitHubIssueAction(action = {}, options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const payload = validateGitHubIssuePayload(action.payload || {});
  const repository = resolveGitHubRepository(action.payload || {}, env);
  const token = githubTokenFromEnv(env);

  if (!token) {
    return {
      ok: true,
      provider: "github",
      operation: "issue_create",
      mode: "dry_run",
      repository: repository ? `${repository.owner}/${repository.repo}` : null,
      issue: publicIssueDraft(payload),
      source_work_item_id: payload.source_work_item_id,
      message: "No GitHub token is configured; issue creation was dry-run only."
    };
  }

  if (!repository) {
    return {
      ok: false,
      provider: "github",
      operation: "issue_create",
      mode: "real",
      errorCode: "GITHUB_REPOSITORY_REQUIRED",
      message:
        "Set OPEN_BUSINESS_OS_GITHUB_OWNER and OPEN_BUSINESS_OS_GITHUB_REPO, or OPEN_BUSINESS_OS_GITHUB_REPOSITORY, before executing GitHub issue actions."
    };
  }

  const apiBaseUrl = cleanString(env.OPEN_BUSINESS_OS_GITHUB_API_BASE_URL) || DEFAULT_GITHUB_API_BASE_URL;
  const url = `${apiBaseUrl.replace(/\/+$/, "")}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/issues`;
  const requestBody = {
    title: payload.title,
    body: payload.body,
    labels: payload.labels
  };
  if (payload.assignees.length) requestBody.assignees = payload.assignees;

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "open-business-os",
        "x-github-api-version": "2022-11-28"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    return {
      ok: false,
      provider: "github",
      operation: "issue_create",
      mode: "real",
      repository: `${repository.owner}/${repository.repo}`,
      errorCode: "GITHUB_NETWORK_ERROR",
      message: error.message || "GitHub request failed before receiving a response."
    };
  }

  const body = await readGitHubResponseBody(response);
  if (!response.ok) {
    return {
      ok: false,
      provider: "github",
      operation: "issue_create",
      mode: "real",
      repository: `${repository.owner}/${repository.repo}`,
      status: response.status,
      errorCode: "GITHUB_API_ERROR",
      message: body.message || `GitHub request failed with ${response.status}.`,
      details: body.errors ? { errors: body.errors } : {}
    };
  }

  return {
    ok: true,
    provider: "github",
    operation: "issue_create",
    mode: "real",
    repository: `${repository.owner}/${repository.repo}`,
    externalProvider: "github",
    externalId: issueIdFromResponse(body),
    externalUrl: body.html_url || null,
    issue: issueSummaryFromResponse(body),
    source_work_item_id: payload.source_work_item_id
  };
}

module.exports = {
  executeGitHubIssueAction,
  githubRepositoryFromEnv,
  githubTokenFromEnv,
  parseRepository,
  resolveGitHubRepository,
  validateGitHubIssuePayload
};
