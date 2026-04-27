"use strict";

const { randomUUID } = require("node:crypto");
const { redactObject } = require("./redaction");

function createAuditEvent(input = {}) {
  return {
    id: input.id || randomUUID(),
    workspace_id: input.workspaceId || input.workspace_id || null,
    actor_user_id: input.actorUserId || input.actor_user_id || null,
    action: input.action,
    entity_type: input.entityType || input.entity_type || null,
    entity_id: input.entityId || input.entity_id || null,
    metadata: redactObject(input.metadata || {}),
    ip_address: input.ipAddress || input.ip_address || null,
    user_agent: input.userAgent || input.user_agent || null,
    created_at: input.createdAt || new Date().toISOString()
  };
}

module.exports = {
  createAuditEvent
};
