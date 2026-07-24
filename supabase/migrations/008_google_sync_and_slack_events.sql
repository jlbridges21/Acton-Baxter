-- Prompt 4: Google Workspace sync folders, Slack event dedupe, job type expansion

-- Allow Google knowledge sync jobs
alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync'
  ));

-- ---------------------------------------------------------------------------
-- google_sync_folders — Drive folders Baxter indexes
-- ---------------------------------------------------------------------------
create table if not exists public.google_sync_folders (
  id uuid primary key default gen_random_uuid(),
  folder_id text not null unique,
  folder_name text not null,
  drive_id text,
  status text not null default 'active'
    check (status in ('active', 'paused', 'error')),
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  indexed_document_count integer not null default 0 check (indexed_document_count >= 0),
  last_modified_seen_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists google_sync_folders_status_idx
  on public.google_sync_folders (status);

create trigger google_sync_folders_set_updated_at
  before update on public.google_sync_folders
  for each row execute function public.set_updated_at();

alter table public.google_sync_folders enable row level security;

create policy "Admins can read google sync folders"
  on public.google_sync_folders for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert google sync folders"
  on public.google_sync_folders for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update google sync folders"
  on public.google_sync_folders for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete google sync folders"
  on public.google_sync_folders for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- slack_processed_events — ignore duplicate/retry deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.slack_processed_events (
  event_id text primary key,
  event_type text,
  team_id text,
  received_at timestamptz not null default timezone('utc', now())
);

create index if not exists slack_processed_events_received_idx
  on public.slack_processed_events (received_at desc);

alter table public.slack_processed_events enable row level security;

create policy "Admins can read slack processed events"
  on public.slack_processed_events for select
  to authenticated
  using (public.is_admin());

-- Service role inserts events; no authenticated insert policy needed.
