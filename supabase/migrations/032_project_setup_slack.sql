-- Project setup Prompt 3: dry-run numbers do not reserve; planned step status;
-- charter list tab setting; Slack initiator id for DMs.

-- ---------------------------------------------------------------------------
-- Dry runs must never reserve a project number (informational only).
-- ---------------------------------------------------------------------------
drop index if exists public.project_setup_runs_project_number_active_uidx;

create unique index project_setup_runs_project_number_active_uidx
  on public.project_setup_runs (project_number)
  where project_number is not null
    and dry_run = false
    and status not in ('failed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Step status: planned = recorded a plan only (not executed).
-- ---------------------------------------------------------------------------
alter table public.project_setup_steps
  drop constraint if exists project_setup_steps_status_check;

alter table public.project_setup_steps
  add constraint project_setup_steps_status_check
  check (status in ('pending', 'running', 'complete', 'failed', 'skipped', 'planned'));

-- ---------------------------------------------------------------------------
-- Project Charter List tab name (master charter spreadsheet).
-- ---------------------------------------------------------------------------
alter table public.project_setup_settings
  add column if not exists charter_list_tab_name text not null default 'Project Charter List';

-- ---------------------------------------------------------------------------
-- Slack slash-command initiator (for outcome DMs).
-- ---------------------------------------------------------------------------
alter table public.project_setup_runs
  add column if not exists slack_initiator_id text;
