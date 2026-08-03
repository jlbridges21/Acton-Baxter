-- Project setup execution lease: prevents concurrent step runners on the same run
-- when the job queue reclaim/after() paths overlap.
alter table public.project_setup_runs
  add column if not exists execution_lock_token text,
  add column if not exists execution_locked_at timestamptz;

comment on column public.project_setup_runs.execution_lock_token is
  'Opaque token held by the active run executor; cleared on complete/fail/release.';
comment on column public.project_setup_runs.execution_locked_at is
  'When the current execution lock was acquired or last heartbeated.';
