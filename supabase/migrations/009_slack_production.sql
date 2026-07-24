-- Prompt 5B: Slack production — durable event receipts + Baxter reply jobs

-- Allow Slack Baxter reply jobs on the existing report_jobs queue
alter table public.report_jobs
  drop constraint if exists report_jobs_job_type_check;

alter table public.report_jobs
  add constraint report_jobs_job_type_check
  check (job_type in (
    'property_research',
    'slack_completion_notification',
    'google_knowledge_sync',
    'slack_baxter_reply'
  ));

-- ---------------------------------------------------------------------------
-- slack_event_receipts — durable Events API dedupe with status lifecycle
-- ---------------------------------------------------------------------------
create table if not exists public.slack_event_receipts (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  team_id text,
  event_type text,
  event_ts text,
  status text not null default 'received'
    check (status in ('received', 'processing', 'completed', 'failed', 'ignored')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  received_at timestamptz not null default timezone('utc', now()),
  processed_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists slack_event_receipts_received_idx
  on public.slack_event_receipts (received_at desc);

create index if not exists slack_event_receipts_status_idx
  on public.slack_event_receipts (status, received_at desc);

alter table public.slack_event_receipts enable row level security;

create policy "Admins can read slack event receipts"
  on public.slack_event_receipts for select
  to authenticated
  using (public.is_admin());

-- Service role inserts/updates receipts; no authenticated write policies.
