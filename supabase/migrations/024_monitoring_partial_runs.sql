-- Prompt 3: monitoring run partial coverage status.
-- Allows sweeps to record incomplete GHL datasets without claiming "all clear".

alter table public.monitoring_runs
  drop constraint if exists monitoring_runs_status_check;

alter table public.monitoring_runs
  add constraint monitoring_runs_status_check
  check (status in ('running', 'completed', 'partial', 'failed', 'skipped'));
