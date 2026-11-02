-- 084: JobTread financial reporting — invoice-level documents, payments, tasks, PP# milestone
-- mapping, weekly snapshots, and configurable alerts.
--
-- Additive only: new nullable columns, new tables, new indexes. Nothing is backfilled or
-- deleted. JobTread is the only source (no QuickBooks). Code tolerates this migration being
-- unapplied: sync writes drop the new columns until they exist, and features that need the new
-- tables report "requires migration 084" instead of failing.

-- ---------------------------------------------------------------------------
-- Financial documents: invoice-level fields + indexes for a primary report source
-- ---------------------------------------------------------------------------
alter table public.jt_documents add column if not exists source_updated_at timestamptz;
-- Customer as JobTread returns it on the document (verified per grant; see entity catalog).
alter table public.jt_documents add column if not exists account_id text;
alter table public.jt_documents add column if not exists account_name text;
-- Document custom field values the admin allowed (category <> excluded), { fieldId: [values] }.
alter table public.jt_documents add column if not exists fields jsonb not null default '{}'::jsonb;

create index if not exists jt_documents_type_status_idx
  on public.jt_documents (type, status) where removed_at is null;
create index if not exists jt_documents_issue_idx
  on public.jt_documents (issue_date) where removed_at is null;
create index if not exists jt_documents_due_idx
  on public.jt_documents (due_date) where removed_at is null and type = 'customerInvoice';
create index if not exists jt_documents_number_idx on public.jt_documents (number);

-- ---------------------------------------------------------------------------
-- Payments: stable joins to documents and jobs; refunds/reversals kept as their own rows
-- ---------------------------------------------------------------------------
alter table public.jt_payments add column if not exists account_id text;
-- JobTread's payment type when the grant exposes it (e.g. a refund). Never payment methods.
alter table public.jt_payments add column if not exists payment_type text;
create index if not exists jt_payments_document_idx
  on public.jt_payments (document_id) where removed_at is null;
create index if not exists jt_payments_job_idx
  on public.jt_payments (job_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Tasks: parent link (milestone group → task) when the grant exposes it
-- ---------------------------------------------------------------------------
alter table public.jt_tasks add column if not exists parent_id text;
create index if not exists jt_tasks_parent_idx
  on public.jt_tasks (parent_id) where removed_at is null;

-- ---------------------------------------------------------------------------
-- Financial settings: document status mapping, balance verification policy
-- ---------------------------------------------------------------------------
create table if not exists public.bi_financial_settings (
  id text primary key default 'default' check (id = 'default'),
  -- [{ "type": "customerInvoice", "status": "approved", "lifecycle": "issued" }, ...]
  status_map jsonb not null default '[]'::jsonb,
  -- How an unpaid balance is verified before it can be called overdue or alerted on:
  --   payments_reconciled — JobTread document balance agrees with synced payment records
  --   jobtread_balance    — an administrator accepts JobTread's document balance as-is
  balance_source text not null default 'payments_reconciled'
    check (balance_source in ('payments_reconciled', 'jobtread_balance')),
  overdue_grace_days integer not null default 0 check (overdue_grace_days between 0 and 120),
  updated_by text,
  updated_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- PP# (progress payment) milestone mapping — configuration, never a guessed rule
-- ---------------------------------------------------------------------------
create table if not exists public.bi_pp_config (
  id text primary key default 'default' check (id = 'default'),
  config jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_by text,
  updated_at timestamptz not null default timezone('utc', now())
);

-- Every saved PP# configuration version (who, when, what) — the audit trail.
create table if not exists public.bi_pp_config_history (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  config jsonb not null,
  updated_by text,
  revalidation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- Invoice → milestone links. "suggested" links come from the configured rule and are not used
-- in reports until approved (or until the rule is configured to auto-accept unique matches).
create table if not exists public.bi_pp_links (
  id uuid primary key default gen_random_uuid(),
  document_id text not null unique,
  job_id text,
  task_id text,
  pp_number text,
  milestone_pct numeric,
  -- How the PP number was decided (configured rule, or an administrator's manual choice).
  classification_method text not null default 'rule'
    check (classification_method in ('rule', 'manual')),
  -- How the task was decided.
  match_method text not null check (match_method in ('rule', 'manual')),
  status text not null default 'suggested'
    check (status in ('suggested', 'approved', 'rejected')),
  config_version integer,
  -- Set when a later rule version or sync disagrees with this link. Links are never reset.
  conflict text,
  revalidated_at timestamptz,
  note text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists bi_pp_links_job_idx on public.bi_pp_links (job_id);
create index if not exists bi_pp_links_task_idx on public.bi_pp_links (task_id);

-- ---------------------------------------------------------------------------
-- Weekly snapshots (immutable, prospective only)
-- ---------------------------------------------------------------------------
create table if not exists public.bi_snapshot_settings (
  id text primary key default 'default' check (id = 'default'),
  enabled boolean not null default false,
  weekday integer not null default 1 check (weekday between 0 and 6), -- 0 = Sunday, 1 = Monday
  hour_local integer not null default 7 check (hour_local between 0 and 23),
  timezone text not null default 'America/Los_Angeles',
  -- When snapshots were last turned on; earlier periods are never captured (no backfill).
  enabled_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bi_snapshot_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  calc_version text not null,
  status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
  triggered_by text not null,
  metrics_written integer not null default 0,
  source_synced_at timestamptz,
  error text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  unique (period_start, calc_version)
);

create table if not exists public.bi_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.bi_snapshot_runs (id),
  period_start date not null,
  period_end date not null,
  metric text not null,
  dimension_key text not null default '',
  dimensions jsonb not null default '{}'::jsonb,
  value numeric,
  completeness text not null check (completeness in ('complete', 'partial', 'incomplete')),
  completeness_detail jsonb not null default '{}'::jsonb,
  source_synced_at timestamptz,
  calc_version text not null,
  captured_at timestamptz not null default timezone('utc', now()),
  unique (period_start, metric, dimension_key, calc_version)
);
create index if not exists bi_snapshots_metric_idx on public.bi_snapshots (metric, period_start);

-- Snapshots are immutable: no updates or deletes, ever.
create or replace function public.bi_snapshots_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'bi_snapshots rows are immutable';
end;
$$;
drop trigger if exists bi_snapshots_no_update on public.bi_snapshots;
create trigger bi_snapshots_no_update before update or delete on public.bi_snapshots
  for each row execute function public.bi_snapshots_immutable();

-- ---------------------------------------------------------------------------
-- Configurable alerts (nothing is enabled or sent until an administrator configures it)
-- ---------------------------------------------------------------------------
create table if not exists public.bi_alert_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  kind text not null check (kind in (
    'overdue_invoice', 'forecast_slip', 'forecast_improvement', 'full_recovery', 'high_risk'
  )),
  name text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  -- [{ "type": "role", "value": "admin" } | { "type": "user", "value": "<profile id>" }]
  recipients jsonb not null default '[]'::jsonb,
  channel text not null default 'in_app' check (channel in ('in_app', 'slack')),
  slack_channel text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bi_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.bi_alert_rules (id),
  dedupe_key text not null unique,
  kind text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  subject_type text,
  subject_id text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  first_seen_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  acknowledged_by text,
  acknowledged_at timestamptz,
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text
);
create index if not exists bi_alert_events_status_idx on public.bi_alert_events (status, last_seen_at);

create table if not exists public.bi_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.bi_alert_events (id),
  recipient text not null,
  channel text not null check (channel in ('in_app', 'slack')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (event_id, recipient, channel)
);
create index if not exists bi_alert_deliveries_pending_idx
  on public.bi_alert_deliveries (status, next_attempt_at);

create table if not exists public.bi_alert_audit (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid,
  event_id uuid,
  action text not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists bi_alert_audit_event_idx on public.bi_alert_audit (event_id, created_at);

alter table public.bi_financial_settings enable row level security;
alter table public.bi_pp_config enable row level security;
alter table public.bi_pp_links enable row level security;
alter table public.bi_pp_config_history enable row level security;
alter table public.bi_snapshot_settings enable row level security;
alter table public.bi_snapshot_runs enable row level security;
alter table public.bi_snapshots enable row level security;
alter table public.bi_alert_rules enable row level security;
alter table public.bi_alert_events enable row level security;
alter table public.bi_alert_deliveries enable row level security;
alter table public.bi_alert_audit enable row level security;
