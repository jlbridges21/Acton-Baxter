-- Dexter data pipeline: per-entity JobTread Sync Manager, chunked/resumable runs, new
-- reporting-cache entities, and admin value mappings (regions, business names).
--
-- Additive only. No existing table, report, report version, or report group is changed.
-- JobTread stays read-only: these tables are Baxter's own cache and bookkeeping.
--
-- Safety model
--   * Every cache row carries synced_at. A run records its generation (start time) and soft-
--     removes rows (removed_at) not seen since that generation ONLY after the final page
--     succeeds. Failed or partial runs never remove or overwrite rows they did not fetch.
--   * Cursors are checkpointed per page, so an interrupted run resumes where it stopped.
--   * Sensitive entities (contacts, daily logs, files, payments, time entries) ship disabled.
--     Contact emails/phones, file contents, and daily-log photos are never requested.
-- All tables have RLS on with no browser policies (server routes authorize every call).

-- ---------------------------------------------------------------------------
-- Sync Manager bookkeeping
-- ---------------------------------------------------------------------------
create table if not exists public.jt_sync_settings (
  id text primary key default 'default' check (id = 'default'),
  daily_enabled boolean not null default true,
  daily_hour_utc integer not null default 10 check (daily_hour_utc between 0 and 23),
  last_daily_enqueued_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.jt_sync_settings (id) values ('default') on conflict (id) do nothing;

create table if not exists public.jt_sync_entities (
  entity text primary key check (entity ~ '^[a-z_]{2,40}$'),
  enabled boolean not null default false,
  schedule text not null default 'daily' check (schedule in ('daily', 'manual')),
  status text not null default 'ready'
    check (status in ('ready', 'queued', 'running', 'completed', 'failed', 'partial', 'disabled', 'permission_blocked')),
  last_run_id uuid,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  -- Only set when a run completed every page; "last good data" for freshness warnings.
  last_success_at timestamptz,
  last_error text,
  last_error_code text,
  records_cached integer,
  -- Fields JobTread said don't exist for this grant (dropped from queries, never guessed).
  dropped_fields jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.jt_sync_entities (entity, enabled) values
  ('custom_fields', true),
  ('jobs', true),
  ('documents', true),
  ('catalog_models', true),
  ('cost_items', true),
  ('tasks', true),
  ('accounts', true),
  ('users', true),
  ('contacts', false),
  ('daily_logs', false),
  ('files', false),
  ('payments', false),
  ('time_entries', false)
on conflict (entity) do nothing;

create table if not exists public.jt_sync_entity_runs (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  batch_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'partial', 'cancelled', 'permission_blocked')),
  triggered_by text not null default 'schedule',
  job_id uuid,
  -- Pave page token for the next page; null before the first page and after the last.
  cursor text,
  -- Rows with synced_at before this are considered missing once the run completes.
  generation timestamptz,
  resumed_from uuid,
  -- Worker lease: a run is advanced only by the worker holding this id (no double paging).
  lease_id uuid,
  pages integer not null default 0,
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  records_removed integer not null default 0,
  api_requests integer not null default 0,
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  error text,
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists jt_sync_entity_runs_entity_idx on public.jt_sync_entity_runs (entity, created_at desc);
create index if not exists jt_sync_entity_runs_batch_idx on public.jt_sync_entity_runs (batch_id);
create index if not exists jt_sync_entity_runs_active_idx on public.jt_sync_entity_runs (status)
  where status in ('queued', 'running');

-- ---------------------------------------------------------------------------
-- Reporting cache: new entities (ids are JobTread's stable ids)
-- ---------------------------------------------------------------------------

-- Budget and catalog lines. Values are exactly what JobTread returns; null when absent.
create table if not exists public.jt_cost_items (
  id text primary key,
  scope text not null check (scope in ('job', 'catalog')),
  job_id text,
  cost_group_id text,
  cost_group_name text,
  name text,
  description text,
  quantity numeric,
  unit_cost numeric,
  unit_price numeric,
  cost numeric,
  price numeric,
  is_selected boolean,
  cost_code_id text,
  cost_code_name text,
  cost_type_id text,
  cost_type_name text,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_cost_items_job_idx on public.jt_cost_items (job_id) where removed_at is null;
create index if not exists jt_cost_items_group_idx on public.jt_cost_items (cost_group_id) where removed_at is null;
create index if not exists jt_cost_items_synced_idx on public.jt_cost_items (synced_at);

create table if not exists public.jt_tasks (
  id text primary key,
  job_id text,
  name text,
  start_date date,
  end_date date,
  progress numeric,
  completed numeric,
  is_group boolean,
  is_to_do boolean,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_tasks_job_idx on public.jt_tasks (job_id) where removed_at is null;
create index if not exists jt_tasks_synced_idx on public.jt_tasks (synced_at);

-- Customer and vendor accounts: names/types plus admin-allowed custom field values only.
create table if not exists public.jt_accounts (
  id text primary key,
  name text,
  type text,
  fields jsonb not null default '{}'::jsonb,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_accounts_synced_idx on public.jt_accounts (synced_at);

-- Contacts: name and title only. Emails and phone numbers are never requested.
create table if not exists public.jt_contacts (
  id text primary key,
  account_id text,
  name text,
  title text,
  fields jsonb not null default '{}'::jsonb,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_contacts_synced_idx on public.jt_contacts (synced_at);

-- JobTread organization members (names for assignee/author lookups; no credentials).
create table if not exists public.jt_users (
  id text primary key,
  user_id text,
  name text,
  role_name text,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_users_synced_idx on public.jt_users (synced_at);

-- Daily logs: dates, authors, and notes text (internal; disabled by default). No photos.
create table if not exists public.jt_daily_logs (
  id text primary key,
  job_id text,
  user_id text,
  log_date date,
  notes text,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_daily_logs_job_idx on public.jt_daily_logs (job_id) where removed_at is null;
create index if not exists jt_daily_logs_synced_idx on public.jt_daily_logs (synced_at);

-- File metadata only (name, folder, type, size). File contents and URLs are never stored.
create table if not exists public.jt_files (
  id text primary key,
  job_id text,
  name text,
  folder text,
  content_type text,
  size_bytes bigint,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_files_job_idx on public.jt_files (job_id) where removed_at is null;
create index if not exists jt_files_synced_idx on public.jt_files (synced_at);

create table if not exists public.jt_payments (
  id text primary key,
  job_id text,
  document_id text,
  amount numeric,
  paid_on date,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_payments_synced_idx on public.jt_payments (synced_at);

create table if not exists public.jt_time_entries (
  id text primary key,
  job_id text,
  user_id text,
  started_at timestamptz,
  ended_at timestamptz,
  minutes numeric,
  cost_code_name text,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_time_entries_job_idx on public.jt_time_entries (job_id) where removed_at is null;
create index if not exists jt_time_entries_synced_idx on public.jt_time_entries (synced_at);

-- ---------------------------------------------------------------------------
-- Admin value mappings (e.g. model name prefix "LA -" → region "Los Angeles")
-- ---------------------------------------------------------------------------
create table if not exists public.bi_value_mappings (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('region')),
  source_field text not null check (char_length(source_field) between 2 and 80),
  match_type text not null default 'prefix' check (match_type in ('prefix', 'exact', 'contains')),
  pattern text not null check (char_length(pattern) between 1 and 120),
  value text not null check (char_length(value) between 1 and 120),
  priority integer not null default 100,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bi_value_mappings_unique unique (kind, source_field, match_type, pattern)
);

-- ---------------------------------------------------------------------------
-- RLS: on everywhere, no browser policies (server routes only).
-- ---------------------------------------------------------------------------
alter table public.jt_sync_settings enable row level security;
alter table public.jt_sync_entities enable row level security;
alter table public.jt_sync_entity_runs enable row level security;
alter table public.jt_cost_items enable row level security;
alter table public.jt_tasks enable row level security;
alter table public.jt_accounts enable row level security;
alter table public.jt_contacts enable row level security;
alter table public.jt_users enable row level security;
alter table public.jt_daily_logs enable row level security;
alter table public.jt_files enable row level security;
alter table public.jt_payments enable row level security;
alter table public.jt_time_entries enable row level security;
alter table public.bi_value_mappings enable row level security;
