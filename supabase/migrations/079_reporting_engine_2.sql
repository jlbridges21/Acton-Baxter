-- Reporting engine 2.0: Metric Library (shared calculated fields, versioned), company-wide
-- report relationships (promoted from report-specific ones), and saved personal report views.
--
-- Additive only. Report specs keep their own report-specific calculations in
-- bi_reports.spec (no column changes); existing reports and revisions are untouched.
-- Service-role access only (RLS on, no policies), like the other bi_* tables.

create table if not exists public.bi_metrics (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  -- The calculation definition (same shape as a report spec's calculations[] entry).
  definition jsonb not null,
  -- company: everyone can use it, only Reports managers edit it. private: only the owner edits it.
  visibility text not null default 'private' check (visibility in ('company', 'private')),
  owner_id uuid references public.profiles (id) on delete set null,
  version integer not null default 1 check (version >= 1),
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bi_metrics_key_unique unique (key)
);
alter table public.bi_metrics enable row level security;

create table if not exists public.bi_metric_versions (
  id uuid primary key default gen_random_uuid(),
  metric_id uuid not null references public.bi_metrics (id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  visibility text not null,
  change_summary text,
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null default 'user' check (author_kind in ('user', 'dexter', 'system')),
  created_at timestamptz not null default timezone('utc', now()),
  constraint bi_metric_versions_unique unique (metric_id, version)
);
alter table public.bi_metric_versions enable row level security;

-- A viewer's saved control state for a report (grouping, sorting, filters). Never changes the
-- report's published defaults.
create table if not exists public.bi_report_saved_views (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.bi_reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  state jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bi_report_saved_views_unique unique (report_id, user_id, name)
);
create index if not exists bi_report_saved_views_user_idx
  on public.bi_report_saved_views (user_id, report_id);
alter table public.bi_report_saved_views enable row level security;

-- Company-wide relationships between report sources, promoted by administrators from a
-- report's own validated relationship (same shape as a report spec's relationships[] entry).
-- Joins are always on a key field holding the related record's stable JobTread id.
create table if not exists public.bi_report_relationships (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  definition jsonb not null,
  promoted_from_report uuid references public.bi_reports (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint bi_report_relationships_key_unique unique (key)
);
alter table public.bi_report_relationships enable row level security;
