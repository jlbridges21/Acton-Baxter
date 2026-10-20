-- 066: Open/Closed project status on expense_jobs.
--
-- Mirrors column J ("Status") on the Master Project Log. Project pickers
-- (Receipts, Site Inspections, Inventory) show a project row only when it is
-- active and project_status = 'open'. Custom rows ignore this column.
--
-- Run by hand in the Baxter Supabase SQL editor, then click "Refresh from
-- sheet" on AI Governance → Master Project Log to fill real statuses.

alter table public.expense_jobs
  add column if not exists project_status text not null default 'unknown';

alter table public.expense_jobs
  drop constraint if exists expense_jobs_project_status_check;

alter table public.expense_jobs
  add constraint expense_jobs_project_status_check
  check (project_status in ('open', 'closed', 'unknown'));

comment on column public.expense_jobs.project_status is
  'Master Project Log column J (Open/Closed). Only open project rows appear in pickers. Rows missing from the sheet become closed on refresh. Not used for source = custom.';

-- Existing project rows stay unknown (hidden) until the next sync reads column J.
update public.expense_jobs
  set project_status = 'unknown'
  where source = 'project' and project_status is distinct from 'unknown';

create index if not exists expense_jobs_picker_idx
  on public.expense_jobs (is_active, source, project_status);
