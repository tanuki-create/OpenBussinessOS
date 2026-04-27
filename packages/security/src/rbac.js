"use strict";

const ROLE_RANK = {
  viewer: 10,
  external_advisor: 15,
  member: 20,
  admin: 30,
  owner: 40
};

const ACTION_MIN_ROLE = {
  "workspace.delete": "owner",
  "api_key.write": "owner",
  "api_key:create": "owner",
  "api_key:delete": "owner",
  "budget.write": "owner",
  "member.write": "owner",
  "connector.write": "admin",
  "project.delete": "admin",
  "project.write": "member",
  "project:create": "member",
  "ai.run": "member",
  "work_item.write": "member",
  "work_item:create": "member",
  "work_item:update": "member",
  "review.write": "member",
  "review:create": "member",
  "audit_log:read": "owner",
  "read": "viewer"
};

function roleAtLeast(role, requiredRole) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[requiredRole] || 0);
}

function permissionInput(roleOrInput, action) {
  if (roleOrInput && typeof roleOrInput === "object") {
    return {
      role: roleOrInput.role ||
        (roleOrInput.user && roleOrInput.user.role) ||
        (roleOrInput.membership && roleOrInput.membership.role),
      action: roleOrInput.action || action
    };
  }
  return { role: roleOrInput, action };
}

function can(roleOrInput, action) {
  const input = permissionInput(roleOrInput, action);
  const requiredRole = ACTION_MIN_ROLE[input.action] || "owner";
  return roleAtLeast(input.role, requiredRole);
}

function requireRole(role, action) {
  if (!can(role, action)) {
    const error = new Error(`Role ${role || "none"} cannot perform ${action}.`);
    error.code = "FORBIDDEN";
    throw error;
  }
  return true;
}

module.exports = {
  ACTION_MIN_ROLE,
  ROLE_RANK,
  can,
  hasPermission: can,
  canAccess: can,
  isAllowed: can,
  permissionInput,
  requireRole,
  requirePermission: requireRole,
  roleAtLeast
};
