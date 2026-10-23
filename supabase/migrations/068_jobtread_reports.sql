-- Phase 2: JobTread data platform + Dexter + Reports.
--
-- Additive only. Existing objects touched:
--   * report_jobs.job_type check gains 'jobtread_sync'
--   * ai_agent_access_policies.access_level check gains 'customer_data' and 'financial_data'
--
-- JobTread remains the source of truth. jt_* tables are a reporting cache of the
-- fields Reports needs (no contacts, emails, phones, files, or line items), refreshed by
-- full reconciliation. All tables have RLS on with no browser policies: every read goes
-- through server routes that apply Reports authorization (src/lib/reports/access.ts).

-- ---------------------------------------------------------------------------
-- Connection + sync bookkeeping
-- ---------------------------------------------------------------------------
create table if not exists public.jt_connection (
  id text primary key default 'default' check (id = 'default'),
  organization_id text,
  organization_name text,
  grant_name text,
  grant_expires_at timestamptz,
  grant_is_unrestricted boolean,
  status text not null default 'unknown' check (status in ('unknown', 'connected', 'error', 'not_configured')),
  last_tested_at timestamptz,
  last_error text,
  sync_interval_minutes integer not null default 60 check (sync_interval_minutes between 15 and 1440),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.jt_connection (id) values ('default') on conflict (id) do nothing;

create table if not exists public.jt_sync_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('metadata', 'jobs', 'catalog', 'full')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  triggered_by text not null default 'schedule',
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  api_requests integer not null default 0,
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  records_removed integer not null default 0,
  duration_ms integer,
  error text
);

create index if not exists jt_sync_runs_started_idx on public.jt_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Metadata: custom field definitions (keyed by stable JobTread ids)
-- ---------------------------------------------------------------------------
create table if not exists public.jt_custom_fields (
  id text primary key,
  name text not null,
  type text not null,
  target_type text not null,
  options jsonb not null default '[]'::jsonb,
  position text,
  -- Admin-controlled presentation + access. category decides who may see values.
  display_name text,
  description text,
  category text not null default 'general'
    check (category in ('general', 'customer', 'financial', 'internal', 'excluded')),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);

create index if not exists jt_custom_fields_target_idx on public.jt_custom_fields (target_type);

-- Business vocabulary → source field (e.g. "Recommended BR Model" → customer field 22Pg…).
create table if not exists public.jt_semantic_fields (
  key text primary key check (key ~ '^[a-z0-9_]{2,60}$'),
  label text not null,
  description text,
  custom_field_id text references public.jt_custom_fields (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Reporting cache
-- ---------------------------------------------------------------------------
create table if not exists public.jt_jobs (
  id text primary key,
  number text,
  name text not null,
  source_created_at timestamptz,
  closed_on date,
  location_id text,
  location_name text,
  address text,
  city text,
  state text,
  postal_code text,
  customer_id text,
  customer_name text,
  projected_price numeric(14, 2),
  projected_cost numeric(14, 2),
  task_start date,
  task_end date,
  task_progress numeric(6, 4),
  -- { "<customFieldId>": ["value", ...] } for job, location, and customer fields.
  job_fields jsonb not null default '{}'::jsonb,
  location_fields jsonb not null default '{}'::jsonb,
  customer_fields jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);

create index if not exists jt_jobs_active_idx on public.jt_jobs (removed_at) where removed_at is null;
create index if not exists jt_jobs_job_fields_gin on public.jt_jobs using gin (job_fields);

-- Product Library: catalog cost groups at the top level (ADU models) with server-side totals.
create table if not exists public.jt_catalog_models (
  id text primary key,
  name text not null,
  description text,
  item_count integer not null default 0,
  total_cost numeric(14, 2),
  total_price numeric(14, 2),
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  owner_id uuid references public.profiles (id) on delete set null,
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'company')),
  is_template boolean not null default false,
  template_key text,
  status text not null default 'active' check (status in ('active', 'archived')),
  spec jsonb not null,
  version integer not null default 1 check (version >= 1),
  created_by_agent boolean not null default false,
  last_data_refresh_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists reports_template_key_unique on public.reports (template_key) where template_key is not null;
create index if not exists reports_owner_idx on public.reports (owner_id, updated_at desc);
create index if not exists reports_visibility_idx on public.reports (visibility, status);

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
  before update on public.reports
  for each row execute function public.set_updated_at();

create table if not exists public.report_revisions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  version integer not null,
  spec jsonb not null,
  title text not null,
  change_summary text,
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null default 'user' check (author_kind in ('user', 'dexter', 'system')),
  task_id uuid references public.ai_tasks (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint report_revisions_unique unique (report_id, version)
);

create table if not exists public.report_shares (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  principal_type text not null check (principal_type in ('user', 'department', 'role')),
  principal_value text not null,
  permission text not null check (permission in ('view', 'edit')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  constraint report_shares_unique unique (report_id, principal_type, principal_value)
);

create table if not exists public.report_views (
  report_id uuid not null references public.reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  viewed_at timestamptz not null default timezone('utc', now()),
  primary key (report_id, user_id)
);

-- Personal pins (each user pins their own reports).
create table if not exists public.report_pins (
  report_id uuid not null references public.reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (report_id, user_id)
);

create table if not exists public.report_chat_messages (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'dexter')),
  content text not null,
  task_id uuid references public.ai_tasks (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists report_chat_messages_thread_idx
  on public.report_chat_messages (user_id, report_id, created_at);

create table if not exists public.report_executions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.reports (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null default 'view' check (kind in ('view', 'drilldown', 'export', 'dexter_tool')),
  rows_scanned integer not null default 0,
  live_api_requests integer not null default 0,
  duration_ms integer not null default 0,
  restricted_widgets integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists report_executions_created_idx on public.report_executions (created_at desc);

-- ---------------------------------------------------------------------------
-- Extend existing checks (additive)
-- ---------------------------------------------------------------------------
alter table public.ai_agent_access_policies
  drop constraint if exists ai_agent_access_policies_access_level_check;
alter table public.ai_agent_access_policies
  add constraint ai_agent_access_policies_access_level_check
  check (access_level in (
    'use_via_baxter', 'direct_chat', 'restricted_data', 'view_activity', 'approve', 'manage',
    'customer_data', 'financial_data'
  ));

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
    'ai_agent_task',
    'jobtread_sync'
  ));

-- ---------------------------------------------------------------------------
-- RLS: on everywhere, no browser policies (server routes only).
-- ---------------------------------------------------------------------------
alter table public.jt_connection enable row level security;
alter table public.jt_sync_runs enable row level security;
alter table public.jt_custom_fields enable row level security;
alter table public.jt_semantic_fields enable row level security;
alter table public.jt_jobs enable row level security;
alter table public.jt_catalog_models enable row level security;
alter table public.reports enable row level security;
alter table public.report_revisions enable row level security;
alter table public.report_shares enable row level security;
alter table public.report_views enable row level security;
alter table public.report_pins enable row level security;
alter table public.report_chat_messages enable row level security;
alter table public.report_executions enable row level security;
