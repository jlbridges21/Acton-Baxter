-- PEM NEAT Prompt 3: soft delete, transcript staleness, generation diagnostics.

alter table public.pem_neats
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles (id) on delete set null,
  add column if not exists analysis_stale boolean not null default false,
  add column if not exists current_generation_transcript_hash text,
  add column if not exists last_error_code text,
  add column if not exists generating_started_at timestamptz;

create index if not exists pem_neats_active_created_idx
  on public.pem_neats (created_at desc)
  where deleted_at is null;

create index if not exists pem_neats_deleted_at_idx
  on public.pem_neats (deleted_at)
  where deleted_at is not null;

-- Expand status to include needs_regeneration (library UX).
alter table public.pem_neats
  drop constraint if exists pem_neats_status_check;

alter table public.pem_neats
  add constraint pem_neats_status_check
  check (status in ('draft', 'generating', 'completed', 'failed', 'needs_regeneration'));

alter table public.pem_neat_generations
  add column if not exists error_code text,
  add column if not exists finish_reason text,
  add column if not exists transcript_hash text,
  add column if not exists validation_issue_count integer,
  add column if not exists diagnostics_json jsonb not null default '{}'::jsonb;

-- Stuck generating cleanup helper: app clears after timeout; no DB job required.
