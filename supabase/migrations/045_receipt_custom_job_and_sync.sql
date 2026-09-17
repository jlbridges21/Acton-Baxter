-- Receipt Log: free-text job labels + scheduled expense_jobs sync job type.
-- Exactly one of job_id / custom_job_label must be set (GHL tags-style one-off labels).

-- ---------------------------------------------------------------------------
-- receipts: allow one-off custom job text without creating expense_jobs rows
-- ---------------------------------------------------------------------------
alter table public.receipts
  alter column job_id drop not null;

alter table public.receipts
  add column if not exists custom_job_label text;

alter table public.receipts
  drop constraint if exists receipts_job_xor_custom;

alter table public.receipts
  add constraint receipts_job_xor_custom check (
    (
      job_id is not null
      and custom_job_label is null
    )
    or (
      job_id is null
      and custom_job_label is not null
      and length(trim(custom_job_label)) > 0
    )
  );

comment on column public.receipts.custom_job_label is
  'One-off job label for this receipt only (GHL tags-style). Mutually exclusive with job_id; never inserted into expense_jobs.';

create index if not exists receipts_custom_job_label_idx
  on public.receipts (custom_job_label)
  where deleted_at is null and custom_job_label is not null;

-- ---------------------------------------------------------------------------
-- report_jobs: expense_jobs_sync (Master Project Log → expense_jobs, off render path)
-- ---------------------------------------------------------------------------
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
    'expense_jobs_sync'
  ));
