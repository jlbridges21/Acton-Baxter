-- Dexter intelligence upgrade: verified data catalog, JobTread document cache, report
-- planning sessions, chat attachments, and business rules (commission rates, project
-- assignments) with change history.
--
-- Additive only. Existing objects touched:
--   * jt_jobs gains actual_cost
--   * ai_agent_access_policies.access_level check gains 'business_rules'
--
-- Business-rule values live only in Baxter; nothing here is written back to JobTread.
-- All tables have RLS on with no browser policies (server routes authorize every call).

-- ---------------------------------------------------------------------------
-- JobTread cache additions
-- ---------------------------------------------------------------------------
alter table public.jt_jobs add column if not exists actual_cost numeric;

-- Financial documents (customer orders, invoices, vendor bills…): totals only, no line items.
create table if not exists public.jt_documents (
  id text primary key,
  job_id text,
  type text not null,
  status text,
  number text,
  name text,
  issue_date date,
  due_date date,
  signed_at timestamptz,
  price numeric,
  cost numeric,
  tax numeric,
  amount_paid numeric,
  balance numeric,
  source_created_at timestamptz,
  synced_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists jt_documents_job_idx on public.jt_documents (job_id, type);

-- Verified catalog of every JobTread entity the grant exposes (metadata + counts only).
create table if not exists public.jt_entity_catalog (
  entity text primary key,
  label text not null,
  description text not null default '',
  record_count integer,
  accessible boolean not null default false,
  reportable boolean not null default false,
  fields jsonb not null default '[]'::jsonb,
  relationships jsonb not null default '[]'::jsonb,
  error text,
  last_verified_at timestamptz not null default timezone('utc', now())
);

-- ---------------------------------------------------------------------------
-- Report planning sessions (requirements memory)
-- ---------------------------------------------------------------------------
create table if not exists public.bi_report_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid references public.bi_reports (id) on delete cascade,
  title text not null default 'New report',
  status text not null default 'gathering'
    check (status in ('gathering', 'awaiting_answers', 'building', 'complete', 'abandoned')),
  requirements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
create unique index if not exists bi_report_sessions_thread_unique
  on public.bi_report_sessions (user_id, coalesce(report_id, '00000000-0000-0000-0000-000000000000'::uuid));

drop trigger if exists bi_report_sessions_set_updated_at on public.bi_report_sessions;
create trigger bi_report_sessions_set_updated_at
  before update on public.bi_report_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Chat attachments (screenshots, PDFs, spreadsheets) — private storage
-- ---------------------------------------------------------------------------
create table if not exists public.bi_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid references public.bi_reports (id) on delete set null,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  kind text not null check (kind in ('image', 'pdf', 'spreadsheet', 'document', 'text')),
  storage_path text,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  extracted_text text,
  analysis jsonb not null default '{}'::jsonb,
  analyzed_by text,
  error text,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists bi_chat_attachments_thread_idx on public.bi_chat_attachments (user_id, report_id, created_at);

insert into storage.buckets (id, name, public, file_size_limit)
values ('report-attachments', 'report-attachments', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "No client access to report attachments" on storage.objects;
create policy "No client access to report attachments"
  on storage.objects for select to authenticated
  using (bucket_id = 'report-attachments' and false);

-- ---------------------------------------------------------------------------
-- Business rules (commissions first; the shape is general)
-- ---------------------------------------------------------------------------
create table if not exists public.bi_rule_sets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_-]{1,59}$'),
  kind text not null check (kind in ('commission')),
  name text not null,
  description text not null default '',
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists bi_rule_sets_set_updated_at on public.bi_rule_sets;
create trigger bi_rule_sets_set_updated_at
  before update on public.bi_rule_sets
  for each row execute function public.set_updated_at();

-- Rates are versioned by effective date; a change closes the old row (effective_to) and
-- adds a new one, so historical commissions stay reproducible.
create table if not exists public.bi_commission_rates (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.bi_rule_sets (id) on delete cascade,
  salesperson text not null,
  job_id text,
  rate_pct numeric not null check (rate_pct >= 0 and rate_pct <= 100),
  effective_from date not null,
  effective_to date,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists bi_commission_rates_lookup_idx
  on public.bi_commission_rates (rule_set_id, salesperson, effective_from);

create table if not exists public.bi_project_assignments (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.bi_rule_sets (id) on delete cascade,
  job_id text not null,
  salesperson text not null,
  split_pct numeric not null default 100 check (split_pct > 0 and split_pct <= 100),
  payment_date date,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  removed_at timestamptz
);
create index if not exists bi_project_assignments_lookup_idx
  on public.bi_project_assignments (rule_set_id, job_id) where removed_at is null;

create table if not exists public.bi_rule_changes (
  id uuid primary key default gen_random_uuid(),
  rule_set_id uuid not null references public.bi_rule_sets (id) on delete cascade,
  entity text not null check (entity in ('rule_set', 'rate', 'assignment')),
  entity_id uuid,
  action text not null,
  before jsonb,
  after jsonb,
  note text,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_by_label text,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists bi_rule_changes_rule_set_idx on public.bi_rule_changes (rule_set_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Access levels: "Edit business rules (Reports)"
-- ---------------------------------------------------------------------------
alter table public.ai_agent_access_policies
  drop constraint if exists ai_agent_access_policies_access_level_check;
alter table public.ai_agent_access_policies
  add constraint ai_agent_access_policies_access_level_check
  check (access_level in (
    'use_via_baxter', 'direct_chat', 'restricted_data', 'view_activity', 'approve', 'manage',
    'customer_data', 'financial_data', 'business_rules'
  ));

-- ---------------------------------------------------------------------------
-- RLS: server-only access
-- ---------------------------------------------------------------------------
alter table public.jt_documents enable row level security;
alter table public.jt_entity_catalog enable row level security;
alter table public.bi_report_sessions enable row level security;
alter table public.bi_chat_attachments enable row level security;
alter table public.bi_rule_sets enable row level security;
alter table public.bi_commission_rates enable row level security;
alter table public.bi_project_assignments enable row level security;
alter table public.bi_rule_changes enable row level security;
