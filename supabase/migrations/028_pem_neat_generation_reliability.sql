-- PEM NEAT reliability: generation stage progress, traces, stage outputs, durable job type.

alter table public.pem_neats
  add column if not exists generation_stage text,
  add column if not exists generation_trace_json jsonb not null default '{}'::jsonb,
  add column if not exists stage_outputs_json jsonb not null default '{}'::jsonb,
  add column if not exists generation_job_id text;

comment on column public.pem_neats.generation_stage is
  'Current durable generation stage label for UI progress (e.g. extracting_facts).';
comment on column public.pem_neats.generation_trace_json is
  'Safe generation trace (no transcript / raw model output).';
comment on column public.pem_neats.stage_outputs_json is
  'Intermediate stage JSON for resume/diagnostics (server-only; contains customer data).';

alter table public.pem_neat_generations
  add column if not exists stage_outputs_json jsonb not null default '{}'::jsonb,
  add column if not exists generation_trace_json jsonb not null default '{}'::jsonb,
  add column if not exists failed_stage text;

comment on column public.pem_neat_generations.failed_stage is
  'Stage name that failed, when status=failed.';

-- Allow PEM generation jobs on the existing durable queue.
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
    'pem_neat_generate'
  ));
