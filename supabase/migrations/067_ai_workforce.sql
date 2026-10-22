-- AI Workforce (Phase 1): Baxter (AI CEO) + Sam (HR / Admin / Legal specialist).
--
-- Additive only: no existing table is altered except the report_jobs job_type
-- check constraint, which gains 'ai_agent_task'.
--
-- Access model: every table has RLS enabled. Writes happen server-side with the
-- service role after the app's own authorization checks (src/lib/agents/permissions.ts).
-- Browser sessions may only read the non-sensitive runtime status table (for the
-- AI Office realtime feed) and the workspace/agent directory metadata. HR documents,
-- chunks, tasks, approvals, and audit rows are never readable by browser sessions.
--
-- Agents, departments, configuration versions, and the placeholder onboarding
-- template are seeded idempotently by application code (src/lib/agents/seed.ts) so
-- the typed defaults live in one place.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- Workspace departments (AI office areas; separate from human `departments`)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_departments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  color text not null default '#1e3a5f',
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists ai_departments_set_updated_at on public.ai_departments;
create trigger ai_departments_set_updated_at
  before update on public.ai_departments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Agents
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{1,62}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  title text not null default '',
  description text not null default '',
  kind text not null default 'specialist' check (kind in ('orchestrator', 'specialist')),
  department_id uuid references public.ai_departments (id) on delete set null,
  manager_agent_id uuid references public.ai_agents (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  -- Canonical avatar reference: a /public path (e.g. /baxter/avatar.png) or a
  -- Supabase Storage public URL for runtime uploads.
  avatar_url text,
  avatar_storage_path text,
  desk jsonb not null default '{}'::jsonb,
  status_label text,
  published_version_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ai_agents_no_self_manager check (manager_agent_id is null or manager_agent_id <> id)
);

create index if not exists ai_agents_status_idx on public.ai_agents (status);
create index if not exists ai_agents_manager_idx on public.ai_agents (manager_agent_id);

drop trigger if exists ai_agents_set_updated_at on public.ai_agents;
create trigger ai_agents_set_updated_at
  before update on public.ai_agents
  for each row execute function public.set_updated_at();

-- Prevent circular reporting relationships (A -> B -> A).
create or replace function public.ai_agents_prevent_reporting_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.manager_agent_id;
  depth integer := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Circular reporting relationship' using errcode = '23514';
    end if;
    depth := depth + 1;
    if depth > 32 then
      raise exception 'Reporting chain too deep' using errcode = '23514';
    end if;
    select manager_agent_id into cursor_id from public.ai_agents where id = cursor_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists ai_agents_reporting_cycle_check on public.ai_agents;
create trigger ai_agents_reporting_cycle_check
  before insert or update of manager_agent_id on public.ai_agents
  for each row execute function public.ai_agents_prevent_reporting_cycle();

-- ---------------------------------------------------------------------------
-- Versioned configuration (instructions, model, delegation, tools, limits)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agent_config_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.ai_agents (id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  config jsonb not null,
  change_summary text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  constraint ai_agent_config_versions_unique unique (agent_id, version_number)
);

-- At most one draft and one published version per agent.
create unique index if not exists ai_agent_config_one_draft
  on public.ai_agent_config_versions (agent_id) where status = 'draft';
create unique index if not exists ai_agent_config_one_published
  on public.ai_agent_config_versions (agent_id) where status = 'published';

alter table public.ai_agents
  drop constraint if exists ai_agents_published_version_fk;
alter table public.ai_agents
  add constraint ai_agents_published_version_fk
  foreign key (published_version_id) references public.ai_agent_config_versions (id)
  on delete set null;

-- Atomic publish: supersede the live version and promote the given version in one
-- transaction, so an agent is never left without a published configuration.
create or replace function public.publish_ai_agent_config(
  p_agent_id uuid,
  p_version_id uuid,
  p_published_by uuid
)
returns void
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.ai_agent_config_versions
    where id = p_version_id and agent_id = p_agent_id and status = 'draft'
  ) then
    raise exception 'Version is not a draft of this agent' using errcode = '22023';
  end if;
  update public.ai_agent_config_versions
    set status = 'superseded'
    where agent_id = p_agent_id and status = 'published';
  update public.ai_agent_config_versions
    set status = 'published', published_by = p_published_by, published_at = timezone('utc', now())
    where id = p_version_id;
  update public.ai_agents set published_version_id = p_version_id where id = p_agent_id;
end;
$$;

revoke all on function public.publish_ai_agent_config(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Access policies (who may use / chat with / review / manage each agent)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agent_access_policies (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.ai_agents (id) on delete cascade,
  principal_type text not null check (principal_type in ('role', 'user', 'department')),
  principal_value text not null check (char_length(principal_value) between 1 and 200),
  access_level text not null check (access_level in (
    'use_via_baxter', 'direct_chat', 'restricted_data', 'view_activity', 'approve', 'manage'
  )),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ai_agent_access_policies_unique unique (agent_id, principal_type, principal_value, access_level)
);

create index if not exists ai_agent_access_policies_agent_idx
  on public.ai_agent_access_policies (agent_id);

-- ---------------------------------------------------------------------------
-- Tasks (delegated assignments) + execution events
-- ---------------------------------------------------------------------------
create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  parent_task_id uuid references public.ai_tasks (id) on delete set null,
  initiating_user_id uuid references public.profiles (id) on delete set null,
  initiating_user_label text,
  channel text not null check (channel in ('web', 'slack', 'office', 'direct', 'sandbox')),
  conversation_id uuid,
  assigning_agent_id uuid references public.ai_agents (id) on delete set null,
  assigned_agent_id uuid not null references public.ai_agents (id) on delete restrict,
  config_version_id uuid references public.ai_agent_config_versions (id) on delete set null,
  task_type text not null default 'request',
  title text not null default '',
  instructions text not null,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'cancelled'
  )),
  delegation_depth integer not null default 1 check (delegation_depth between 0 and 3),
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  lease_expires_at timestamptz,
  routing jsonb not null default '{}'::jsonb,
  allowed_context jsonb not null default '{}'::jsonb,
  result jsonb,
  error_code text,
  error_message text,
  approval_state text not null default 'none' check (approval_state in ('none', 'pending', 'approved', 'rejected')),
  model_provider text,
  model_name text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(12, 6) not null default 0,
  sensitivity text not null default 'internal' check (sensitivity in ('internal', 'confidential')),
  cancel_requested boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_tasks_status_idx on public.ai_tasks (status, created_at desc);
create index if not exists ai_tasks_agent_idx on public.ai_tasks (assigned_agent_id, created_at desc);
create index if not exists ai_tasks_user_idx on public.ai_tasks (initiating_user_id, created_at desc);
create index if not exists ai_tasks_created_idx on public.ai_tasks (created_at desc);

drop trigger if exists ai_tasks_set_updated_at on public.ai_tasks;
create trigger ai_tasks_set_updated_at
  before update on public.ai_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.ai_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks (id) on delete cascade,
  event_type text not null,
  message text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_task_events_task_idx on public.ai_task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Runtime status (non-sensitive; feeds the AI Office via Realtime)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_agent_runtime_status (
  agent_id uuid primary key references public.ai_agents (id) on delete cascade,
  state text not null default 'idle' check (state in (
    'idle', 'receiving', 'working', 'awaiting_result', 'awaiting_approval', 'completed', 'blocked', 'failed'
  )),
  active_task_count integer not null default 0,
  current_task_id uuid references public.ai_tasks (id) on delete set null,
  last_completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Approval requests (human review of proposed actions, incl. communication drafts)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_approval_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ai_tasks (id) on delete set null,
  agent_id uuid not null references public.ai_agents (id) on delete cascade,
  action_type text not null,
  title text not null,
  summary text not null default '',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_for_user_id uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_approval_requests_status_idx
  on public.ai_approval_requests (status, created_at desc);

drop trigger if exists ai_approval_requests_set_updated_at on public.ai_approval_requests;
create trigger ai_approval_requests_set_updated_at
  before update on public.ai_approval_requests
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Agent knowledge hub (isolated from Baxter's general knowledge_entries)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 300),
  description text,
  category text not null default 'general',
  sensitivity text not null default 'internal' check (sensitivity in ('internal', 'confidential', 'restricted')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed', 'archived')),
  filename text,
  mime_type text,
  size_bytes integer,
  storage_path text,
  content_hash text,
  chunk_count integer not null default 0,
  index_error text,
  indexed_at timestamptz,
  version integer not null default 1,
  replaces_document_id uuid references public.ai_knowledge_documents (id) on delete set null,
  uploaded_by uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_knowledge_documents_status_idx on public.ai_knowledge_documents (status);

drop trigger if exists ai_knowledge_documents_set_updated_at on public.ai_knowledge_documents;
create trigger ai_knowledge_documents_set_updated_at
  before update on public.ai_knowledge_documents
  for each row execute function public.set_updated_at();

create table if not exists public.ai_knowledge_document_agents (
  document_id uuid not null references public.ai_knowledge_documents (id) on delete cascade,
  agent_id uuid not null references public.ai_agents (id) on delete cascade,
  primary key (document_id, agent_id)
);

create index if not exists ai_knowledge_document_agents_agent_idx
  on public.ai_knowledge_document_agents (agent_id);

create table if not exists public.ai_knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.ai_knowledge_documents (id) on delete cascade,
  ordinal integer not null,
  heading text,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_knowledge_chunks_document_idx on public.ai_knowledge_chunks (document_id, ordinal);
create index if not exists ai_knowledge_chunks_fts_idx on public.ai_knowledge_chunks
  using gin (to_tsvector('english', coalesce(heading, '') || ' ' || content));

-- Semantic search restricted to an explicit, pre-authorized document id list.
create or replace function public.match_ai_knowledge_chunks(
  query_embedding vector(1536),
  allowed_document_ids uuid[],
  match_count integer default 8
)
returns table (
  id uuid,
  document_id uuid,
  ordinal integer,
  heading text,
  content text,
  similarity float
)
language sql
stable
as $$
  select c.id, c.document_id, c.ordinal, c.heading, c.content,
         (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.ai_knowledge_chunks c
  where c.embedding is not null
    and c.document_id = any (allowed_document_ids)
  order by c.embedding <=> query_embedding
  limit greatest(least(match_count, 50), 1);
$$;

revoke all on function public.match_ai_knowledge_chunks(vector, uuid[], integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Onboarding workflows (templates + instances; synthetic data only in dev/tests)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_onboarding_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  is_placeholder boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists ai_onboarding_templates_set_updated_at on public.ai_onboarding_templates;
create trigger ai_onboarding_templates_set_updated_at
  before update on public.ai_onboarding_templates
  for each row execute function public.set_updated_at();

create table if not exists public.ai_onboarding_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ai_onboarding_templates (id) on delete cascade,
  position integer not null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  responsible_label text,
  due_offset_days integer not null default 0 check (due_offset_days between -365 and 365),
  required_document text,
  completion_requirement text,
  depends_on_step_id uuid references public.ai_onboarding_template_steps (id) on delete set null,
  notification_template text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_onboarding_template_steps_template_idx
  on public.ai_onboarding_template_steps (template_id, position);

create table if not exists public.ai_onboarding_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.ai_onboarding_templates (id) on delete set null,
  template_name text not null,
  -- Data minimization: a display name and role/title only. No SSN, pay, or contact data.
  employee_display_name text not null check (char_length(employee_display_name) between 1 and 120),
  employee_role text,
  start_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  owner_user_id uuid references public.profiles (id) on delete set null,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists ai_onboarding_instances_set_updated_at on public.ai_onboarding_instances;
create trigger ai_onboarding_instances_set_updated_at
  before update on public.ai_onboarding_instances
  for each row execute function public.set_updated_at();

create table if not exists public.ai_onboarding_instance_steps (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.ai_onboarding_instances (id) on delete cascade,
  template_step_id uuid,
  position integer not null,
  title text not null,
  description text,
  responsible_label text,
  due_date date,
  required_document text,
  completion_requirement text,
  depends_on_position integer,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'skipped', 'blocked')),
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_onboarding_instance_steps_instance_idx
  on public.ai_onboarding_instance_steps (instance_id, position);

drop trigger if exists ai_onboarding_instance_steps_set_updated_at on public.ai_onboarding_instance_steps;
create trigger ai_onboarding_instance_steps_set_updated_at
  before update on public.ai_onboarding_instance_steps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Workspace settings (singleton) + audit log
-- ---------------------------------------------------------------------------
create table if not exists public.ai_workspace_settings (
  id text primary key default 'default' check (id = 'default'),
  layout_preset text not null default 'studio' check (layout_preset in ('studio', 'campus', 'compact')),
  theme text not null default 'daylight' check (theme in ('daylight', 'evening', 'blueprint')),
  show_meeting_area boolean not null default true,
  show_future_space boolean not null default true,
  area_labels jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.ai_workspace_settings (id) values ('default') on conflict (id) do nothing;

create table if not exists public.ai_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_label text,
  action text not null,
  target_type text not null,
  target_id text,
  summary text not null default '',
  -- Never store document bodies, HR record content, or secrets here.
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_audit_log_created_idx on public.ai_audit_log (created_at desc);
create index if not exists ai_audit_log_target_idx on public.ai_audit_log (target_type, target_id);

-- ---------------------------------------------------------------------------
-- Durable job type for resumable agent tasks
-- ---------------------------------------------------------------------------
alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply',
    'baxter_monitor_sweep',
    'baxter_alert_delivery',
    'slack_monitoring_reaction',
    'pem_neat_generate',
    'project_setup',
    'knowledge_drive_ingest',
    'expense_jobs_sync',
    'site_inspection_ai',
    'site_inspection_pdf_export',
    'site_inspection_street_view_backfill',
    'inventory_order_import',
    'ai_agent_task'
  ));

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.ai_departments enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_agent_config_versions enable row level security;
alter table public.ai_agent_access_policies enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.ai_task_events enable row level security;
alter table public.ai_agent_runtime_status enable row level security;
alter table public.ai_approval_requests enable row level security;
alter table public.ai_knowledge_documents enable row level security;
alter table public.ai_knowledge_document_agents enable row level security;
alter table public.ai_knowledge_chunks enable row level security;
alter table public.ai_onboarding_templates enable row level security;
alter table public.ai_onboarding_template_steps enable row level security;
alter table public.ai_onboarding_instances enable row level security;
alter table public.ai_onboarding_instance_steps enable row level security;
alter table public.ai_workspace_settings enable row level security;
alter table public.ai_audit_log enable row level security;

-- Directory metadata + runtime state: readable by app-access users (AI Office).
-- No instructions, knowledge, task content, or results are exposed by these policies.
drop policy if exists "App users read AI departments" on public.ai_departments;
create policy "App users read AI departments"
  on public.ai_departments for select to authenticated
  using (public.is_app_access());

drop policy if exists "App users read AI agent directory" on public.ai_agents;
create policy "App users read AI agent directory"
  on public.ai_agents for select to authenticated
  using (public.is_app_access() and status <> 'archived');

drop policy if exists "App users read AI runtime status" on public.ai_agent_runtime_status;
create policy "App users read AI runtime status"
  on public.ai_agent_runtime_status for select to authenticated
  using (public.is_app_access());

drop policy if exists "App users read AI workspace settings" on public.ai_workspace_settings;
create policy "App users read AI workspace settings"
  on public.ai_workspace_settings for select to authenticated
  using (public.is_app_access());

-- Every other ai_* table: no browser policies (deny by default). Server routes
-- authorize per agent policy and use the service role.

-- Realtime: publish only the non-sensitive runtime status table.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_agent_runtime_status'
    ) then
      execute 'alter publication supabase_realtime add table public.ai_agent_runtime_status';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------
-- Avatars are non-sensitive portraits: public read, server-side writes only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-agent-avatars', 'ai-agent-avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Agent knowledge files: private. Downloads only via short-lived signed URLs
-- issued after server-side authorization.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ai-agent-knowledge', 'ai-agent-knowledge', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "No client writes to AI avatars" on storage.objects;
create policy "No client writes to AI avatars"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ai-agent-avatars' and false);

drop policy if exists "No client access to AI knowledge files" on storage.objects;
create policy "No client access to AI knowledge files"
  on storage.objects for select to authenticated
  using (bucket_id = 'ai-agent-knowledge' and false);
