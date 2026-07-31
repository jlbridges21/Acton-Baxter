-- Project setup foundation (Prompt 1): settings, runs, steps — dry-run ready.
-- Service-role writes from server code; authenticated team can read runs; admins read settings.

create table if not exists public.project_setup_settings (
  id integer primary key default 1 check (id = 1),
  member_emails jsonb not null default '[
    "ally.moin@actonadu.com",
    "aws.jabir@actonadu.com",
    "bryan.moser@actonadu.com",
    "connor.rainey@actonadu.com",
    "jackson.bridges@actonadu.com",
    "james.parks@actonadu.com",
    "jessee.bayze@actonadu.com",
    "jesse.soares@actonadu.com",
    "kevin.lee@actonadu.com",
    "mark.nichols@actonadu.com",
    "maxx.kimbler@actonadu.com",
    "milan.romic@actonadu.com",
    "rebecca.ralston@actonadu.com",
    "stanley.acton@actonadu.com",
    "tony.radovich@actonadu.com",
    "zac.yeager@actonadu.com"
  ]'::jsonb,
  test_mode boolean not null default true,
  test_member_emails jsonb not null default '["jackson.bridges@actonadu.com"]'::jsonb,
  template_folder_id text not null default '1AJ6Czh9rJB04bJhNhChCl8E2AvCSFDIJ',
  projects_parent_folder_id text not null default '150O10sPk_V2guH_Tqrx1AKNJyqsom0dv',
  master_charter_spreadsheet_id text not null default '1_REzrzFc7vREVxqceI47soA4HWa3u-H9Y961UeQ6u6k',
  master_log_tab_name text not null default 'Master Project Log',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.project_setup_settings (id)
values (1)
on conflict (id) do nothing;

create trigger project_setup_settings_set_updated_at
  before update on public.project_setup_settings
  for each row execute function public.set_updated_at();

alter table public.project_setup_settings enable row level security;

create policy "Admins can read project setup settings"
  on public.project_setup_settings for select to authenticated
  using (public.is_admin());

-- No client writes — service role only
create policy "No client insert project setup settings"
  on public.project_setup_settings for insert to authenticated
  with check (false);

create policy "No client update project setup settings"
  on public.project_setup_settings for update to authenticated
  using (false);

create policy "No client delete project setup settings"
  on public.project_setup_settings for delete to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
create table if not exists public.project_setup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'running', 'complete', 'failed', 'cancelled')),
  dry_run boolean not null default true,
  initiated_by uuid references public.profiles (id) on delete set null,
  trigger_channel text not null default 'web'
    check (trigger_channel in ('web', 'slack')),
  ghl_contact_id text,
  contact_snapshot_json jsonb not null default '{}'::jsonb,
  sales_rep text,
  project_number text,
  project_last_name text,
  folder_name text,
  charter_name text,
  slack_channel_name text,
  fp_paid_date date,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists project_setup_runs_created_at_idx
  on public.project_setup_runs (created_at desc);

create index if not exists project_setup_runs_status_idx
  on public.project_setup_runs (status, updated_at desc);

create index if not exists project_setup_runs_initiated_by_idx
  on public.project_setup_runs (initiated_by, created_at desc);

-- Concurrent runs must never mint the same project number (failed/cancelled excluded).
create unique index if not exists project_setup_runs_project_number_active_uidx
  on public.project_setup_runs (project_number)
  where project_number is not null
    and status not in ('failed', 'cancelled');

create trigger project_setup_runs_set_updated_at
  before update on public.project_setup_runs
  for each row execute function public.set_updated_at();

alter table public.project_setup_runs enable row level security;

create policy "Team can read project setup runs"
  on public.project_setup_runs for select to authenticated
  using (true);

create policy "No client insert project setup runs"
  on public.project_setup_runs for insert to authenticated
  with check (false);

create policy "No client update project setup runs"
  on public.project_setup_runs for update to authenticated
  using (false);

create policy "No client delete project setup runs"
  on public.project_setup_runs for delete to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- Steps
-- ---------------------------------------------------------------------------
create table if not exists public.project_setup_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.project_setup_runs (id) on delete cascade,
  step_key text not null,
  order_index integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'failed', 'skipped')),
  output_json jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (run_id, step_key)
);

create index if not exists project_setup_steps_run_idx
  on public.project_setup_steps (run_id, order_index);

create trigger project_setup_steps_set_updated_at
  before update on public.project_setup_steps
  for each row execute function public.set_updated_at();

alter table public.project_setup_steps enable row level security;

create policy "Team can read project setup steps"
  on public.project_setup_steps for select to authenticated
  using (true);

create policy "No client insert project setup steps"
  on public.project_setup_steps for insert to authenticated
  with check (false);

create policy "No client update project setup steps"
  on public.project_setup_steps for update to authenticated
  using (false);

create policy "No client delete project setup steps"
  on public.project_setup_steps for delete to authenticated
  using (false);

-- Allow project_setup jobs on the existing durable queue.
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
    'project_setup'
  ));
