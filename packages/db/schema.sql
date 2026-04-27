-- Open Business OS initial PostgreSQL schema.
-- This schema is the target source of truth for the MVP after JSON Store.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  owner_user_id uuid not null references users(id),
  default_budget_mode text not null default 'cheap'
    check (default_budget_mode in ('ultra_cheap','cheap','balanced','high_quality')),
  monthly_budget_usd numeric(12,4) not null default 5.0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer','external_advisor')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  one_liner text,
  business_type text,
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists visions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  concept text not null,
  target_market text,
  target_users jsonb not null default '[]'::jsonb,
  ideal_state text,
  success_horizon text,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  source text not null default 'ai' check (source in ('user','ai','imported')),
  created_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text,
  metric_type text not null check (
    metric_type in ('north_star','okr_objective','okr_key_result','kpi','engineering','ux','sales','marketing','operations','cost')
  ),
  unit text,
  target_value numeric,
  current_value numeric,
  target_date date,
  parent_metric_id uuid references metrics(id),
  status text not null default 'active' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists assumptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  statement text not null,
  assumption_type text not null check (
    assumption_type in ('customer','problem','solution','market','pricing','technical','gtm','security','operations')
  ),
  evidence_level text not null default 'none' check (evidence_level in ('none','weak','medium','strong')),
  status text not null default 'unverified'
    check (status in ('unverified','supported','rejected','needs_more_evidence','archived')),
  risk_level text not null default 'medium' check (risk_level in ('low','medium','high','critical')),
  related_metric_id uuid references metrics(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, statement)
);

create table if not exists evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  evidence_type text not null check (
    evidence_type in ('customer_interview','usage_log','sales_note','poc_result','technical_eval','cost_measurement','security_review','user_test','document','manual_note')
  ),
  summary text,
  body text,
  source_url text,
  file_id uuid,
  strength text not null default 'weak' check (strength in ('weak','medium','strong')),
  captured_at timestamptz default now(),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  decision text not null,
  rationale text,
  alternatives jsonb not null default '[]'::jsonb,
  decided_by uuid references users(id),
  decided_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('draft','active','superseded','archived')),
  created_at timestamptz not null default now()
);

create table if not exists initiatives (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  description text,
  initiative_type text not null check (
    initiative_type in ('product','engineering','marketing','sales','security','operations','research','customer_success')
  ),
  hypothesis text,
  success_criteria text,
  start_date date,
  due_date date,
  status text not null default 'draft'
    check (status in ('draft','planned','in_progress','done','cancelled','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  related_metric_id uuid references metrics(id),
  related_assumption_id uuid references assumptions(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists work_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  initiative_id uuid references initiatives(id) on delete set null,
  title text not null,
  description text,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  work_type text not null check (work_type in ('issue','task','bug','research','design','security','ops','sales','marketing')),
  status text not null default 'draft'
    check (status in ('draft','todo','in_progress','blocked','done','cancelled','archived')),
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  assignee_user_id uuid references users(id),
  external_provider text,
  external_id text,
  external_url text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  review_type text not null check (review_type in ('weekly','biweekly','monthly','poc','incident','initiative')),
  period_start date,
  period_end date,
  summary text,
  learnings jsonb not null default '[]'::jsonb,
  next_actions jsonb not null default '[]'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists playbook_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  playbook_id text not null,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed','cancelled','user_reviewing','approved','applied')),
  created_by uuid references users(id),
  started_at timestamptz,
  completed_at timestamptz,
  approved_by uuid references users(id),
  approved_at timestamptz,
  applied_at timestamptz,
  memory_summary_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  playbook_run_id uuid references playbook_runs(id) on delete set null,
  task text not null,
  provider text not null,
  model text not null,
  budget_mode text not null,
  prompt_hash text,
  input_tokens integer,
  output_tokens integer,
  cache_hit_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  status text not null check (status in ('success','failed','cancelled')),
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  encrypted_key bytea not null,
  key_hint text,
  status text not null default 'active' check (status in ('active','disabled','revoked')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  scope text not null check (scope in ('workspace','project','user','task','provider','model')),
  scope_id text,
  limit_usd numeric(12,4) not null,
  period text not null check (period in ('daily','weekly','monthly')),
  hard_limit boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists cost_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  ai_run_id uuid references ai_runs(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_hit_tokens integer not null default 0,
  estimated_cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists tool_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  tool_provider text not null,
  action_type text not null,
  payload jsonb not null,
  preview text,
  status text not null default 'draft'
    check (status in ('draft','pending_approval','approved','executing','completed','failed','cancelled')),
  requested_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  actor_user_id uuid references users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists business_maps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','approved','archived')),
  output jsonb not null,
  created_by uuid references users(id),
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memory_nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  node_type text not null check (
    node_type in ('vision','metric','assumption','evidence','decision','initiative','work_item','review','risk','constraint','preference','lesson','tool_action','ai_run')
  ),
  source_entity_type text,
  source_entity_id uuid,
  title text not null,
  body text,
  status text not null default 'draft'
    check (status in ('draft','active','approved','supported','rejected','superseded','archived')),
  importance numeric(6,4) not null default 0.5 check (importance >= 0 and importance <= 1),
  confidence numeric(6,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  valid_from timestamptz,
  valid_until timestamptz,
  last_accessed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists memory_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  from_node_id uuid not null references memory_nodes(id) on delete cascade,
  to_node_id uuid not null references memory_nodes(id) on delete cascade,
  relation_type text not null check (
    relation_type in ('supports','supported_by','contradicts','caused_by','derived_from','replaced_by','blocks','implements','implemented_by','validated_by','rejected_because','depends_on','measured_by','similar_to','mentions','updates')
  ),
  strength numeric(6,4) not null default 0.5 check (strength >= 0 and strength <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (from_node_id, to_node_id, relation_type)
);

create table if not exists project_memory_summaries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  summary_type text not null check (summary_type in ('core','metrics','assumptions','evidence','decisions','recent_activity','llm_context')),
  body text not null,
  source_node_ids uuid[] not null default '{}',
  source_edge_ids uuid[] not null default '{}',
  token_estimate integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_workspace on projects(workspace_id);
create index if not exists idx_assumptions_project on assumptions(project_id);
create index if not exists idx_initiatives_project on initiatives(project_id);
create index if not exists idx_work_items_project on work_items(project_id);
create index if not exists idx_reviews_project on reviews(project_id);
create index if not exists idx_ai_runs_workspace_created on ai_runs(workspace_id, created_at desc);
create index if not exists idx_cost_ledger_workspace_created on cost_ledger(workspace_id, created_at desc);
create index if not exists idx_tool_actions_project_status on tool_actions(project_id, status);
create index if not exists idx_audit_logs_workspace_created on audit_logs(workspace_id, created_at desc);
create index if not exists idx_memory_nodes_project_type_status on memory_nodes(project_id, node_type, status);
create index if not exists idx_memory_nodes_source_entity on memory_nodes(source_entity_type, source_entity_id);
create index if not exists idx_memory_edges_from_relation on memory_edges(from_node_id, relation_type);
create index if not exists idx_memory_edges_to_relation on memory_edges(to_node_id, relation_type);
create index if not exists idx_project_memory_summaries_project_type on project_memory_summaries(project_id, summary_type, created_at desc);
