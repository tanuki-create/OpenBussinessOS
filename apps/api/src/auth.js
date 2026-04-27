"use strict";

const crypto = require("node:crypto");

const { DEFAULT_USER_ID } = require("./store");
const { can } = require("../../../packages/security/src");

const LOCAL_AUTH_MODE = "local";
const TOKEN_ENV_NAMES = [
  "OPEN_BUSINESS_OS_API_TOKEN",
  "OPEN_BUSINESS_OS_SESSION_TOKEN",
  "OPEN_BUSINESS_OS_DEV_TOKEN",
  "API_TOKEN",
  "SMOKE_AUTH_TOKEN"
];
const TOKEN_HEADER_NAMES = [
  "x-open-business-os-token",
  "x-api-token"
];
const SESSION_COOKIE_NAMES = [
  "obos_session",
  "open_business_os_session"
];

function authMode() {
  return String(process.env.OPEN_BUSINESS_OS_AUTH_MODE || LOCAL_AUTH_MODE).trim().toLowerCase() || LOCAL_AUTH_MODE;
}

function isLocalAuthMode(mode = authMode()) {
  return mode === LOCAL_AUTH_MODE;
}

function getHeader(headers, name) {
  return headers?.[name] || headers?.[name.toLowerCase()] || headers?.[name.toUpperCase()] || "";
}

function parseCookies(cookieHeader = "") {
  const cookies = new Map();
  for (const part of String(cookieHeader).split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const rawValue = part.slice(index + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    if (key) cookies.set(key, value);
  }
  return cookies;
}

function extractAuthToken(request) {
  const authorization = getHeader(request.headers, "authorization");
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(String(authorization || "").trim());
  if (bearerMatch) {
    return { token: bearerMatch[1].trim(), source: "authorization" };
  }

  for (const headerName of TOKEN_HEADER_NAMES) {
    const token = String(getHeader(request.headers, headerName) || "").trim();
    if (token) return { token, source: headerName };
  }

  const cookies = parseCookies(getHeader(request.headers, "cookie"));
  for (const cookieName of SESSION_COOKIE_NAMES) {
    const token = cookies.get(cookieName);
    if (token) return { token, source: `cookie:${cookieName}` };
  }

  return null;
}

function safeTokenEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function tokenSpec(token, input = {}, source = "env") {
  if (!token) return null;
  const spec = typeof input === "string" ? { userId: input } : (input || {});
  return {
    token: String(token),
    userId: spec.userId || spec.user_id || spec.sub || spec.id || DEFAULT_USER_ID,
    email: spec.email || null,
    name: spec.name || null,
    source
  };
}

function tokenSpecFromDelimitedEntry(entry) {
  const trimmed = String(entry || "").trim();
  if (!trimmed) return null;

  const separator = trimmed.includes("=") ? "=" : trimmed.includes(":") ? ":" : null;
  if (!separator) return tokenSpec(trimmed, { userId: DEFAULT_USER_ID }, "OPEN_BUSINESS_OS_AUTH_TOKENS");

  const index = trimmed.indexOf(separator);
  const token = trimmed.slice(0, index).trim();
  const userId = trimmed.slice(index + 1).trim() || DEFAULT_USER_ID;
  return tokenSpec(token, { userId }, "OPEN_BUSINESS_OS_AUTH_TOKENS");
}

function tokenSpecsFromJson(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (typeof item === "string") return tokenSpec(item, { userId: DEFAULT_USER_ID }, "OPEN_BUSINESS_OS_AUTH_TOKENS");
        return tokenSpec(item.token || item.value, item, "OPEN_BUSINESS_OS_AUTH_TOKENS");
      })
      .filter(Boolean);
  }

  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed)
      .map(([token, value]) => tokenSpec(token, value, "OPEN_BUSINESS_OS_AUTH_TOKENS"))
      .filter(Boolean);
  }

  return [];
}

function configuredTokenSpecs() {
  const specs = [];

  for (const envName of TOKEN_ENV_NAMES) {
    const token = String(process.env[envName] || "").trim();
    if (token) specs.push(tokenSpec(token, { userId: DEFAULT_USER_ID }, envName));
  }

  const rawTokens = String(process.env.OPEN_BUSINESS_OS_AUTH_TOKENS || "").trim();
  if (rawTokens) {
    if (rawTokens.startsWith("{") || rawTokens.startsWith("[")) {
      try {
        specs.push(...tokenSpecsFromJson(rawTokens));
      } catch {
        return specs;
      }
    } else {
      specs.push(...rawTokens.split(/[\n,;]/).map(tokenSpecFromDelimitedEntry).filter(Boolean));
    }
  }

  return specs;
}

function userForTokenSpec(data, spec) {
  const user = data.users.find((item) => item.id === spec.userId || item.email === spec.userId);
  if (user) return user;

  return {
    id: spec.userId,
    email: spec.email || null,
    name: spec.name || "Authenticated User"
  };
}

function identityForToken(data, token) {
  const spec = configuredTokenSpecs().find((candidate) => safeTokenEqual(candidate.token, token));
  if (!spec) return null;
  const user = userForTokenSpec(data, spec);
  return {
    authenticated: true,
    tokenSource: spec.source,
    user,
    userId: user.id
  };
}

function authenticateRequest(data, request) {
  const mode = authMode();
  if (isLocalAuthMode(mode)) {
    const user = data.users.find((item) => item.id === DEFAULT_USER_ID) || {
      id: DEFAULT_USER_ID,
      email: "local@open-business-os.dev",
      name: "Local User"
    };
    return {
      authenticated: true,
      mode,
      tokenSource: "local",
      user,
      userId: user.id
    };
  }

  const extracted = extractAuthToken(request);
  if (!extracted?.token) {
    return {
      authenticated: false,
      mode,
      tokenSource: null,
      user: null,
      userId: null,
      error: "Authentication is required."
    };
  }

  const identity = identityForToken(data, extracted.token);
  if (!identity) {
    return {
      authenticated: false,
      mode,
      tokenSource: extracted.source,
      user: null,
      userId: null,
      error: "Authentication token is invalid."
    };
  }

  return {
    ...identity,
    mode,
    tokenSource: extracted.source
  };
}

function authenticationError(message = "Authentication is required.") {
  const error = new Error(message);
  error.code = "UNAUTHORIZED";
  return error;
}

function requireAuthenticated(request) {
  if (request.auth?.authenticated) return request.auth;
  throw authenticationError(request.auth?.error);
}

function currentUserId(request) {
  return request.auth?.userId || DEFAULT_USER_ID;
}

function devRoleOverride(request) {
  if (!isLocalAuthMode(request.auth?.mode)) return null;
  const role = getHeader(request.headers, "x-open-business-os-role");
  return role ? String(role).toLowerCase() : null;
}

function membershipsForCurrentUser(data, request) {
  const auth = requireAuthenticated(request);
  return data.workspace_memberships.filter((membership) => membership.user_id === auth.userId);
}

function membershipForWorkspace(data, request, workspaceId) {
  const roleOverride = devRoleOverride(request);
  if (roleOverride) {
    return {
      workspace_id: workspaceId,
      user_id: currentUserId(request),
      role: roleOverride,
      source: "x-open-business-os-role"
    };
  }

  return data.workspace_memberships.find(
    (membership) => membership.workspace_id === workspaceId && membership.user_id === currentUserId(request)
  ) || null;
}

function roleForWorkspace(data, request, workspaceId) {
  return membershipForWorkspace(data, request, workspaceId)?.role || null;
}

function forbiddenError(workspaceId, action, role) {
  const error = new Error(`Role ${role || "none"} cannot perform ${action}.`);
  error.code = "FORBIDDEN";
  error.details = { workspaceId, action, role: role || null };
  return error;
}

function requireWorkspacePermission(data, request, workspaceId, action) {
  requireAuthenticated(request);
  const role = roleForWorkspace(data, request, workspaceId);
  if (!can(role, action)) {
    throw forbiddenError(workspaceId, action, role);
  }
  return role;
}

function requireWorkspaceRead(data, request, workspaceId) {
  return requireWorkspacePermission(data, request, workspaceId, "read");
}

module.exports = {
  authenticateRequest,
  authMode,
  configuredTokenSpecs,
  currentUserId,
  extractAuthToken,
  isLocalAuthMode,
  membershipForWorkspace,
  membershipsForCurrentUser,
  requireAuthenticated,
  requireWorkspacePermission,
  requireWorkspaceRead,
  roleForWorkspace
};
