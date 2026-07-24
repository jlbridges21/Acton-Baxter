-- Prompt 6: Google Drive Knowledge Manager — selections, synced files, sync runs

-- ---------------------------------------------------------------------------
-- google_source_selections — explicit files/folders Baxter may sync
-- root_id references google_sync_folders (existing connected roots)
-- ---------------------------------------------------------------------------
create table if not exists public.google_source_selections (
  id uuid primary key default gen_random_uuid(),
  root_id uuid not null references public.google_sync_folders (id) on delete cascade,
  google_file_id text not null,
  selection_type text not null
    check (selection_type in ('file', 'folder')),
  recursive boolean not null default true,
  include_future_files boolean not null default true,
  explicitly_excluded boolean not null default false,
  enabled boolean not null default true,
  title_snapshot text,
  mime_type text,
  drive_id text,
  parent_file_id text,
  default_category text,
  default_tags text[] not null default '{}'::text[],
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  unique (root_id, google_file_id, explicitly_excluded)
);

create index if not exists google_source_selections_root_idx
  on public.google_source_selections (root_id, enabled);

create index if not exists google_source_selections_file_idx
  on public.google_source_selections (google_file_id);

create trigger google_source_selections_set_updated_at
  before update on public.google_source_selections
  for each row execute function public.set_updated_at();

alter table public.google_source_selections enable row level security;

create policy "Admins can read google source selections"
  on public.google_source_selections for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert google source selections"
  on public.google_source_selections for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update google source selections"
  on public.google_source_selections for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete google source selections"
  on public.google_source_selections for delete
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- google_synced_files — per-file sync state
-- ---------------------------------------------------------------------------
create table if not exists public.google_synced_files (
  id uuid primary key default gen_random_uuid(),
  root_id uuid not null references public.google_sync_folders (id) on delete cascade,
  selection_id uuid references public.google_source_selections (id) on delete set null,
  google_file_id text not null,
  knowledge_entry_id uuid references public.knowledge_entries (id) on delete set null,
  title text not null default '',
  mime_type text,
  web_view_link text,
  drive_id text,
  parent_file_ids text[] not null default '{}'::text[],
  modified_time timestamptz,
  revision_id text,
  content_hash text,
  sync_status text not null default 'not_synced'
    check (sync_status in (
      'not_synced', 'queued', 'syncing', 'synced', 'unchanged', 'stale',
      'failed', 'unsupported', 'excluded', 'access_lost', 'source_deleted'
    )),
  selected_reason text,
  last_discovered_at timestamptz,
  last_sync_attempt_at timestamptz,
  last_synced_at timestamptz,
  last_error_code text,
  last_error_message_safe text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  unique (root_id, google_file_id)
);

create index if not exists google_synced_files_status_idx
  on public.google_synced_files (sync_status, last_synced_at desc nulls last);

create index if not exists google_synced_files_knowledge_idx
  on public.google_synced_files (knowledge_entry_id);

create trigger google_synced_files_set_updated_at
  before update on public.google_synced_files
  for each row execute function public.set_updated_at();

alter table public.google_synced_files enable row level security;

create policy "Admins can read google synced files"
  on public.google_synced_files for select
  to authenticated
  using (public.is_admin());

-- Service role writes synced files; no authenticated write policies needed.

-- ---------------------------------------------------------------------------
-- google_sync_runs — dashboard history
-- ---------------------------------------------------------------------------
create table if not exists public.google_sync_runs (
  id uuid primary key default gen_random_uuid(),
  root_id uuid references public.google_sync_folders (id) on delete set null,
  trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'cron', 'retry', 'admin')),
  status text not null default 'running'
    check (status in ('running', 'complete', 'failed', 'partial')),
  job_id uuid,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  files_discovered integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  archived_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  duration_ms integer,
  error_summary text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists google_sync_runs_started_idx
  on public.google_sync_runs (started_at desc);

alter table public.google_sync_runs enable row level security;

create policy "Admins can read google sync runs"
  on public.google_sync_runs for select
  to authenticated
  using (public.is_admin());
