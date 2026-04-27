"use strict";

const { createId, nowIso } = require("../store");

function matchesWhere(row, where = {}) {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

class CollectionRepository {
  constructor(data, collectionName) {
    this.data = data;
    this.collectionName = collectionName;
  }

  get collection() {
    if (!Array.isArray(this.data[this.collectionName])) {
      this.data[this.collectionName] = [];
    }
    return this.data[this.collectionName];
  }

  all() {
    return this.collection;
  }

  findById(id) {
    return this.collection.find((row) => row.id === id) || null;
  }

  findWhere(where) {
    return this.collection.filter((row) => matchesWhere(row, where));
  }

  firstWhere(where) {
    return this.collection.find((row) => matchesWhere(row, where)) || null;
  }

  insert(record) {
    const now = nowIso();
    const row = {
      id: record.id || createId(),
      created_at: record.created_at || now,
      ...record,
      updated_at: record.updated_at || record.created_at || now
    };
    this.collection.push(row);
    return row;
  }

  update(id, patch) {
    const row = this.findById(id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: patch.updated_at || nowIso() });
    return row;
  }

  upsert(where, record) {
    const existing = this.firstWhere(where);
    if (!existing) return this.insert({ ...where, ...record });
    Object.assign(existing, record, { updated_at: record.updated_at || nowIso() });
    return existing;
  }
}

class WorkspaceRepository extends CollectionRepository {
  constructor(data) {
    super(data, "workspaces");
  }

  memberships(workspaceId) {
    return this.data.workspace_memberships.filter((membership) => membership.workspace_id === workspaceId);
  }

  roleForUser(workspaceId, userId) {
    return this.memberships(workspaceId).find((membership) => membership.user_id === userId)?.role || null;
  }
}

class ProjectRepository extends CollectionRepository {
  constructor(data) {
    super(data, "projects");
  }

  listByWorkspace(workspaceId) {
    return this.collection.filter((project) => project.workspace_id === workspaceId);
  }

  snapshot(projectId) {
    const project = this.findById(projectId);
    if (!project) return null;
    return {
      project,
      businessMap: this.data.business_maps.find((item) => item.project_id === projectId)?.output || null,
      metrics: this.data.metrics.filter((item) => item.project_id === projectId),
      assumptions: this.data.assumptions.filter((item) => item.project_id === projectId),
      initiatives: this.data.initiatives.filter((item) => item.project_id === projectId),
      workItems: this.data.work_items.filter((item) => item.project_id === projectId),
      reviews: this.data.reviews.filter((item) => item.project_id === projectId)
    };
  }
}

class MemoryRepository {
  constructor(data) {
    this.data = data;
    this.nodes = new CollectionRepository(data, "memory_nodes");
    this.edges = new CollectionRepository(data, "memory_edges");
    this.summaries = new CollectionRepository(data, "project_memory_summaries");
  }

  nodesForProject(projectId) {
    return this.data.memory_nodes.filter((node) => node.project_id === projectId);
  }

  edgesForProject(projectId) {
    const nodeIds = new Set(this.nodesForProject(projectId).map((node) => node.id));
    return this.data.memory_edges.filter(
      (edge) => edge.project_id === projectId || (nodeIds.has(edge.from_node_id) && nodeIds.has(edge.to_node_id))
    );
  }

  graphForProject(projectId) {
    return {
      nodes: this.nodesForProject(projectId),
      edges: this.edgesForProject(projectId)
    };
  }

  upsertNode(input) {
    const where = input.source_entity_type && input.source_entity_id
      ? {
          project_id: input.project_id,
          source_entity_type: input.source_entity_type,
          source_entity_id: input.source_entity_id
        }
      : { project_id: input.project_id, node_type: input.node_type, title: input.title };
    return this.nodes.upsert(where, {
      workspace_id: input.workspace_id,
      project_id: input.project_id,
      node_type: input.node_type,
      source_entity_type: input.source_entity_type || null,
      source_entity_id: input.source_entity_id || null,
      title: input.title,
      body: input.body || "",
      status: input.status || "active",
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.5,
      metadata: input.metadata || {},
      created_by: input.created_by || null
    });
  }

  upsertEdge(input) {
    return this.edges.upsert(
      {
        from_node_id: input.from_node_id,
        to_node_id: input.to_node_id,
        relation_type: input.relation_type
      },
      {
        workspace_id: input.workspace_id,
        project_id: input.project_id || null,
        strength: input.strength ?? 0.5,
        metadata: input.metadata || {},
        created_by: input.created_by || null
      }
    );
  }

  latestSummary(projectId, summaryType = "llm_context") {
    return this.data.project_memory_summaries
      .filter((summary) => summary.project_id === projectId && summary.summary_type === summaryType)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  }
}

class CostRepository {
  constructor(data) {
    this.data = data;
    this.ledger = new CollectionRepository(data, "cost_ledger");
  }

  monthLedger(workspaceId, monthPrefix = new Date().toISOString().slice(0, 7)) {
    return this.data.cost_ledger.filter(
      (entry) => entry.workspace_id === workspaceId && String(entry.created_at || "").startsWith(monthPrefix)
    );
  }
}

function createJsonRepositories(data) {
  return {
    workspaces: new WorkspaceRepository(data),
    projects: new ProjectRepository(data),
    memory: new MemoryRepository(data),
    playbookRuns: new CollectionRepository(data, "playbook_runs"),
    costs: new CostRepository(data),
    toolActions: new CollectionRepository(data, "tool_actions")
  };
}

module.exports = {
  CollectionRepository,
  CostRepository,
  MemoryRepository,
  ProjectRepository,
  WorkspaceRepository,
  createJsonRepositories
};
