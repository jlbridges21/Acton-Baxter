-- Process Monitoring: delivery claim status + configurable sweep interval.
-- Default sweep interval: 15 minutes (responsive without hammering GHL every cron tick).

alter table public.monitoring_settings
  add column if not exists sweep_interval_minutes integer not null default 15
    check (sweep_interval_minutes > 0);

alter table public.monitoring_findings
  drop constraint if exists monitoring_findings_status_check;

alter table public.monitoring_findings
  add constraint monitoring_findings_status_check
  check (status in (
    'open',
    'delivering',
    'alerted',
    'acknowledged',
    'resolved',
    'dismissed_false_positive',
    'expired'
  ));
