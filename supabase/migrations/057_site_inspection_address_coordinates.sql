-- Coordinates from Places autocomplete, preferred over the address string
-- for Street View. Nullable so a typed address that Google cannot resolve
-- can still be saved.

alter table public.site_inspections
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- Background backfill of Street View covers for inspections created before
-- covers were fetched at create time.

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
    'expense_jobs_sync',
    'site_inspection_ai',
    'site_inspection_pdf_export',
    'site_inspection_street_view_backfill'
  ));
