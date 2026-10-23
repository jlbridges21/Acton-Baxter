-- Sam Operations: configurable HR / administration / legal workflows for Acton Construction
-- and Acton ADU (leadership brief, 22 Oct 2026).
--
-- Additive only. Existing objects touched:
--   * ai_approval_requests gains payload_hash, ops_action_id, invalidated_at
--   * report_jobs.job_type check gains 'sam_operations_sweep'
--
-- Every consequential action is an ops_actions row that needs a CEO/COO approval bound to its
-- exact payload hash (unless leadership explicitly enables autonomy for that action type).
-- All tables have RLS on with no browser policies: server routes authorize every request.

-- ---------------------------------------------------------------------------
-- Organization & leadership decisions
-- ---------------------------------------------------------------------------
create table if not exists public.ops_entities (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name text not null,
  confirmed boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- The brief's open decisions and setup inputs, tracked in the UI (never in code comments).
create table if not exists public.ops_decisions (
  key text primary key,
  section text not null,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open', 'confirmed', 'not_applicable')),
  value jsonb,
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  note text,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Leadership-enabled autonomy. No rows = every action needs approval.
create table if not exists public.ops_autonomy_rules (
  id uuid primary key default gen_random_uuid(),
  action_type text not null,
  workflow_key text,
  entity_id uuid references public.ops_entities (id) on delete cascade,
  enabled boolean not null default false,
  enabled_by uuid references public.profiles (id) on delete set null,
  enabled_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- People (employee register for workflows; BambooHR remains authoritative)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_people (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  full_name text not null,
  work_email text,
  personal_email text,
  position text,
  department text,
  status text not null default 'candidate' check (status in ('candidate', 'pre_hire', 'active', 'offboarding', 'former')),
  start_date date,
  end_date date,
  bamboohr_id text,
  profile_id uuid references public.profiles (id) on delete set null,
  manager_profile_id uuid references public.profiles (id) on delete set null,
  test_record boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Workflow templates (versioned) and instances (pinned to a version)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_workflow_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,60}$'),
  name text not null,
  category text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  official boolean not null default false,
  published_version_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ops_workflow_templates (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  definition jsonb not null,
  change_summary text,
  created_by uuid references public.profiles (id) on delete set null,
  published_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_workflow_versions_unique unique (template_id, version)
);

create table if not exists public.ops_workflow_instances (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ops_workflow_templates (id) on delete restrict,
  version_id uuid not null references public.ops_workflow_versions (id) on delete restrict,
  entity_id uuid references public.ops_entities (id) on delete set null,
  person_id uuid references public.ops_people (id) on delete set null,
  subject_label text not null,
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'active', 'paused', 'completed', 'cancelled', 'failed')),
  mode text not null default 'live' check (mode in ('live', 'test')),
  inputs jsonb not null default '{}'::jsonb,
  start_approval_id uuid references public.ai_approval_requests (id) on delete set null,
  started_by uuid references public.profiles (id) on delete set null,
  idempotency_key text unique,
  processing_until timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists ops_workflow_instances_status_idx on public.ops_workflow_instances (status, updated_at desc);

create table if not exists public.ops_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.ops_workflow_instances (id) on delete cascade,
  step_key text not null,
  position integer not null,
  title text not null,
  type text not null,
  stage text,
  config jsonb not null default '{}'::jsonb,
  depends_on text[] not null default '{}',
  status text not null default 'blocked'
    check (status in ('blocked', 'ready', 'in_progress', 'awaiting_approval', 'waiting', 'completed', 'skipped', 'failed', 'cancelled')),
  assignee_profile_id uuid references public.profiles (id) on delete set null,
  assignee_role text,
  due_at timestamptz,
  next_run_at timestamptz,
  last_reminded_at timestamptz,
  attempts integer not null default 0,
  last_error text,
  data jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  override_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_workflow_steps_unique unique (instance_id, step_key)
);
create index if not exists ops_workflow_steps_assignee_idx on public.ops_workflow_steps (assignee_profile_id, status);
create index if not exists ops_workflow_steps_due_idx on public.ops_workflow_steps (status, next_run_at);

-- ---------------------------------------------------------------------------
-- Actions: every consequential side effect, approval-bound and idempotent
-- ---------------------------------------------------------------------------
create table if not exists public.ops_actions (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid references public.ops_workflow_instances (id) on delete cascade,
  step_id uuid references public.ops_workflow_steps (id) on delete cascade,
  entity_id uuid references public.ops_entities (id) on delete set null,
  action_type text not null,
  title text not null,
  summary text not null default '',
  payload jsonb not null,
  payload_hash text not null,
  risk text not null default 'medium' check (risk in ('low', 'medium', 'high')),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'rejected', 'executing', 'succeeded', 'failed', 'cancelled', 'superseded', 'manual_required')),
  mode text not null default 'live' check (mode in ('live', 'test')),
  approval_request_id uuid references public.ai_approval_requests (id) on delete set null,
  approved_via text,
  idempotency_key text not null unique,
  attempts integer not null default 0,
  last_error text,
  result jsonb,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_by_label text,
  executed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists ops_actions_status_idx on public.ops_actions (status, created_at desc);

alter table public.ai_approval_requests add column if not exists payload_hash text;
alter table public.ai_approval_requests add column if not exists ops_action_id uuid;
alter table public.ai_approval_requests add column if not exists invalidated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Documents (private storage; associated with entity + person or contract)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  person_id uuid references public.ops_people (id) on delete set null,
  contract_id uuid,
  instance_id uuid references public.ops_workflow_instances (id) on delete set null,
  step_id uuid references public.ops_workflow_steps (id) on delete set null,
  category text not null,
  title text not null,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  storage_path text,
  signed boolean not null default false,
  status text not null default 'received' check (status in ('received', 'verified', 'rejected', 'filed', 'archived')),
  version integer not null default 1,
  supersedes_id uuid references public.ops_documents (id) on delete set null,
  drive_file_id text,
  extracted_text text,
  restricted boolean not null default true,
  retention_until date,
  uploaded_by uuid references public.profiles (id) on delete set null,
  verified_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists ops_documents_person_idx on public.ops_documents (person_id, category);

insert into storage.buckets (id, name, public, file_size_limit)
values ('ops-documents', 'ops-documents', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "No client access to ops documents" on storage.objects;
create policy "No client access to ops documents"
  on storage.objects for select to authenticated
  using (bucket_id = 'ops-documents' and false);

-- ---------------------------------------------------------------------------
-- Contracts, templates, insurance, surveys, recruiting, timecards
-- ---------------------------------------------------------------------------
create table if not exists public.ops_contract_templates (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  contract_type text not null,
  name text not null,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved', 'inactive')),
  document_id uuid references public.ops_documents (id) on delete set null,
  drive_file_id text,
  merge_fields text[] not null default '{}',
  body text,
  review_owner_profile_id uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_contracts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  contract_type text not null,
  title text not null,
  counterparty text not null,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'out_for_signature', 'signed', 'active', 'expired', 'terminated', 'archived')),
  template_id uuid references public.ops_contract_templates (id) on delete set null,
  document_id uuid references public.ops_documents (id) on delete set null,
  effective_date date,
  expiration_date date,
  renewal_date date,
  notice_days integer,
  dates_verified boolean not null default false,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  signature_status text,
  docusign_envelope_id text,
  review jsonb,
  reminder_days integer[] not null default '{}',
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  policy_number text,
  insurer text not null,
  category text not null,
  effective_date date,
  renewal_date date,
  expiration_date date,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'renewing', 'renewed', 'expired', 'cancelled')),
  reminder_days integer[] not null default '{}',
  document_id uuid references public.ops_documents (id) on delete set null,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Reminders actually raised (dedup key prevents repeats for the same threshold).
create table if not exists public.ops_reminders (
  id uuid primary key default gen_random_uuid(),
  ref_type text not null check (ref_type in ('contract', 'insurance', 'step', 'timecard', 'survey')),
  ref_id uuid not null,
  threshold text not null,
  action_id uuid references public.ops_actions (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ops_reminders_unique unique (ref_type, ref_id, threshold)
);

create table if not exists public.ops_surveys (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  title text not null,
  purpose text not null default '',
  audience text not null default '',
  questions jsonb not null default '[]'::jsonb,
  schedule text,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  confidentiality text not null default 'anonymous' check (confidentiality in ('anonymous', 'confidential', 'identified')),
  min_group_size integer not null default 5 check (min_group_size >= 1),
  delivery text not null default 'manual' check (delivery in ('bamboohr', 'manual')),
  status text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'in_progress', 'closed')),
  invited_count integer,
  completed_count integer,
  results jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_vacancies (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.ops_entities (id) on delete set null,
  title text not null,
  department text,
  location text,
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'published', 'closed')),
  publication_method text not null default 'manual' check (publication_method in ('betterteam_api', 'manual')),
  posting_url text,
  published_at timestamptz,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_interviews (
  id uuid primary key default gen_random_uuid(),
  vacancy_id uuid references public.ops_vacancies (id) on delete set null,
  candidate_name text not null,
  candidate_email text,
  selected_by uuid references public.profiles (id) on delete set null,
  interviewer_profile_ids uuid[] not null default '{}',
  timezone text not null default 'America/Los_Angeles',
  proposed_slots jsonb not null default '[]'::jsonb,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  status text not null default 'requested'
    check (status in ('requested', 'proposed', 'pending_approval', 'scheduled', 'rescheduling', 'cancelled', 'completed')),
  calendar_event_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_timecard_checks (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('unavailable', 'complete', 'incomplete', 'manual')),
  source text not null,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint ops_timecard_checks_unique unique (period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- Integration settings (non-secret configuration only — secrets stay in env vars)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_integration_settings (
  key text primary key,
  config jsonb not null default '{}'::jsonb,
  last_tested_at timestamptz,
  last_status text,
  last_error text,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Durable sweep job type
-- ---------------------------------------------------------------------------
alter table public.report_jobs drop constraint if exists report_jobs_job_type_check;
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
    'ai_agent_task',
    'jobtread_sync',
    'sam_operations_sweep'
  ));

-- ---------------------------------------------------------------------------
-- updated_at triggers + RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ops_entities', 'ops_people', 'ops_workflow_templates', 'ops_workflow_versions', 'ops_workflow_instances',
    'ops_workflow_steps', 'ops_actions', 'ops_documents', 'ops_contract_templates', 'ops_contracts',
    'ops_insurance_policies', 'ops_surveys', 'ops_vacancies', 'ops_interviews'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array[
    'ops_entities', 'ops_decisions', 'ops_autonomy_rules', 'ops_people', 'ops_workflow_templates',
    'ops_workflow_versions', 'ops_workflow_instances', 'ops_workflow_steps', 'ops_actions', 'ops_documents',
    'ops_contract_templates', 'ops_contracts', 'ops_insurance_policies', 'ops_reminders', 'ops_surveys',
    'ops_vacancies', 'ops_interviews', 'ops_timecard_checks', 'ops_integration_settings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
