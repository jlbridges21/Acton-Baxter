-- Citation snapshots + Google root preferences for simplified Drive UX

-- ---------------------------------------------------------------------------
-- Historical citation snapshots (survive active knowledge removal)
-- ---------------------------------------------------------------------------
alter table public.baxter_message_sources
  alter column knowledge_entry_id drop not null;

alter table public.baxter_message_sources
  add column if not exists source_title_snapshot text,
  add column if not exists source_type_snapshot text,
  add column if not exists source_url_snapshot text,
  add column if not exists source_label_snapshot text,
  add column if not exists source_deleted_at timestamptz;

-- Soft-remove stamp on knowledge entries (active retrieval excludes archived)
alter table public.knowledge_entries
  add column if not exists removed_from_active_at timestamptz;

-- Prefer one active KB entry per Google file id
create unique index if not exists knowledge_entries_google_external_active_uidx
  on public.knowledge_entries (source_external_id)
  where source_type = 'Google Drive'
    and source_external_id is not null
    and status <> 'archived'
    and removed_from_active_at is null;

-- Primary / last-browsed folder on connected roots (stored in metadata-compatible columns)
alter table public.google_sync_folders
  add column if not exists is_primary boolean not null default false,
  add column if not exists last_browsed_folder_id text,
  add column if not exists last_browsed_at timestamptz;

create unique index if not exists google_sync_folders_one_primary_uidx
  on public.google_sync_folders (is_primary)
  where is_primary = true;
