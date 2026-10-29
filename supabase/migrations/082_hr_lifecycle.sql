-- HR lifecycle coordinator for Sam (leadership "Acton ADU Staff Lifecycle Checklist", Oct 28, 2026).
--
-- Extends Sam Operations (071) instead of adding a parallel workflow system:
--   * ops_workflow_steps.status gains 'external_verification' and 'not_applicable'
--   * ops_workflow_instances gains a nullable lifecycle summary (no names or contact details)
--   * ops_reminders gains lifecycle/compliance reference types and in-app reminder columns
-- New tables: checklist source versions, per-task history, the legal verification register,
-- the software access register (platforms + grants), the recurring compliance calendar, and
-- versioned communication templates.
--
-- Additive only. RLS on with no browser policies: server routes authorize every request.
-- Apply before deploying the code that uses it.

-- ---------------------------------------------------------------------------
-- Existing Sam Operations tables
-- ---------------------------------------------------------------------------
alter table public.ops_workflow_steps drop constraint if exists ops_workflow_steps_status_check;
alter table public.ops_workflow_steps
  add constraint ops_workflow_steps_status_check
  check (status in (
    'blocked', 'ready', 'in_progress', 'awaiting_approval', 'waiting', 'completed', 'skipped',
    'failed', 'cancelled', 'external_verification', 'not_applicable'
  ));

alter table public.ops_workflow_instances add column if not exists lifecycle jsonb;

alter table public.ops_reminders drop constraint if exists ops_reminders_ref_type_check;
alter table public.ops_reminders
  add constraint ops_reminders_ref_type_check
  check (ref_type in ('contract', 'insurance', 'step', 'timecard', 'survey', 'lifecycle_step', 'compliance'));
alter table public.ops_reminders add column if not exists recipient_profile_id uuid references public.profiles (id) on delete set null;
alter table public.ops_reminders add column if not exists channel text not null default 'in_app';
alter table public.ops_reminders add column if not exists message text;
alter table public.ops_reminders add column if not exists acknowledged_at timestamptz;

-- ---------------------------------------------------------------------------
-- Checklist source document versions (the file itself lives in the Knowledge Hub)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_lifecycle_sources (
  id uuid primary key default gen_random_uuid(),
  document_key text not null,
  version_label text not null,
  title text not null,
  document_date text,
  filename text,
  content_hash text not null,
  knowledge_document_id uuid references public.ai_knowledge_documents (id) on delete set null,
  status text not null default 'current' check (status in ('current', 'superseded')),
  supersedes_id uuid references public.ops_lifecycle_sources (id) on delete set null,
  item_count integer not null default 0,
  reconciliation jsonb not null default '{}'::jsonb,
  note text not null default '',
  imported_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_lifecycle_sources_version_unique unique (document_key, version_label),
  constraint ops_lifecycle_sources_hash_unique unique (document_key, content_hash)
);

-- ---------------------------------------------------------------------------
-- Per-task history (status changes, notes, evidence, owner changes)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.ops_workflow_instances (id) on delete cascade,
  step_id uuid references public.ops_workflow_steps (id) on delete cascade,
  item_id text,
  event text not null,
  from_status text,
  to_status text,
  note text,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_label text,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists ops_lifecycle_events_instance_idx on public.ops_lifecycle_events (instance_id, created_at);

-- ---------------------------------------------------------------------------
-- Legal verification register: unverified until a named reviewer checks the official source.
-- The document's original wording is kept; discrepancies are recorded, never overwritten.
-- ---------------------------------------------------------------------------
create table if not exists public.ops_compliance_verifications (
  id uuid primary key default gen_random_uuid(),
  item_id text not null,
  document_key text not null,
  document_version text not null,
  original_text text not null,
  citation text not null,
  authority text not null,
  status text not null default 'unverified' check (status in ('unverified', 'verified', 'discrepancy')),
  reviewer_profile_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  official_source_url text,
  official_source_title text,
  official_text text,
  discrepancy text,
  note text not null default '',
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_compliance_verifications_unique unique (item_id, citation, document_version)
);

-- ---------------------------------------------------------------------------
-- Software access register
-- ---------------------------------------------------------------------------
create table if not exists public.ops_software_platforms (
  key text primary key,
  label text not null,
  licensed_seat boolean not null default false,
  seats_total integer check (seats_total is null or seats_total >= 0),
  seats_used integer check (seats_used is null or seats_used >= 0),
  -- Entered by a person from an invoice or admin console; never estimated.
  seat_cost text,
  seat_cost_source text,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  notes text not null default '',
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_software_platforms_cost_source check (seat_cost is null or seat_cost_source is not null)
);

create table if not exists public.ops_access_grants (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.ops_people (id) on delete cascade,
  platform text not null,
  role text not null,
  privileged boolean not null default false,
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_on date not null,
  approver_profile_id uuid not null references public.profiles (id) on delete restrict,
  approval_note text not null default '',
  instance_id uuid references public.ops_workflow_instances (id) on delete set null,
  step_id uuid references public.ops_workflow_steps (id) on delete set null,
  revoked_on date,
  revoked_by uuid references public.profiles (id) on delete set null,
  revocation_verified_at timestamptz,
  revocation_verified_by uuid references public.profiles (id) on delete set null,
  notes text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists ops_access_grants_person_idx on public.ops_access_grants (person_id, status);

-- ---------------------------------------------------------------------------
-- Recurring compliance calendar
-- ---------------------------------------------------------------------------
create table if not exists public.ops_compliance_calendar (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  item text not null,
  when_text text not null,
  requirement text not null,
  tags text[] not null default '{}',
  cadence jsonb not null,
  -- Verified dates entered by a reviewer (e.g. the EDD EITC schedule), as MM-DD strings.
  verified_dates text[] not null default '{}',
  owner_role text not null default 'hr_admin',
  owner_profile_id uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ops_compliance_occurrences (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.ops_compliance_calendar (id) on delete cascade,
  period_key text not null,
  person_id uuid references public.ops_people (id) on delete cascade,
  due_date date,
  status text not null default 'open' check (status in ('open', 'completed', 'not_applicable')),
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  evidence text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_compliance_occurrences_unique unique (calendar_id, period_key)
);

-- ---------------------------------------------------------------------------
-- Versioned communication templates (drafts only; nothing is sent from these)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_comm_templates (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  version integer not null check (version >= 1),
  status text not null default 'active' check (status in ('active', 'superseded')),
  name text not null,
  channel text not null check (channel in ('email', 'slack')),
  subject text not null default '',
  body text not null,
  change_summary text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint ops_comm_templates_unique unique (key, version)
);

-- ---------------------------------------------------------------------------
-- updated_at triggers + RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'ops_lifecycle_sources', 'ops_compliance_verifications', 'ops_software_platforms',
    'ops_access_grants', 'ops_compliance_calendar', 'ops_compliance_occurrences', 'ops_comm_templates'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
  foreach t in array array[
    'ops_lifecycle_sources', 'ops_lifecycle_events', 'ops_compliance_verifications',
    'ops_software_platforms', 'ops_access_grants', 'ops_compliance_calendar',
    'ops_compliance_occurrences', 'ops_comm_templates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
