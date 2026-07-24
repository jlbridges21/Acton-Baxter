-- Baxter Knowledge Base foundation (Prompt 2)
-- Manual admin-managed knowledge with revision history and future source registry.

-- ---------------------------------------------------------------------------
-- knowledge_entries
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  summary text,
  category text not null,
  tags text[] not null default '{}',
  source_name text,
  source_type text not null default 'manual'
    check (source_type in (
      'manual', 'policy', 'procedure', 'process', 'RACI',
      'Google Drive', 'GoHighLevel', 'Buildertrend', 'Domo',
      'Slack', 'uploaded_document', 'other'
    )),
  source_url text,
  source_external_id text,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'archived')),
  visibility text not null default 'internal'
    check (visibility in ('internal', 'admin_only')),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.profiles (id) on delete set null,
  updated_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists knowledge_entries_status_idx on public.knowledge_entries (status);
create index if not exists knowledge_entries_category_idx on public.knowledge_entries (category);
create index if not exists knowledge_entries_updated_at_idx on public.knowledge_entries (updated_at desc);
create index if not exists knowledge_entries_source_type_idx on public.knowledge_entries (source_type);
create index if not exists knowledge_entries_tags_gin_idx on public.knowledge_entries using gin (tags);
create index if not exists knowledge_entries_fts_idx on public.knowledge_entries
  using gin (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(summary, '') || ' ' ||
      coalesce(content, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(source_name, '') || ' ' ||
      coalesce(array_to_string(tags, ' '), '')
    )
  );

create trigger knowledge_entries_set_updated_at
  before update on public.knowledge_entries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- knowledge_entry_revisions
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_entry_revisions (
  id uuid primary key default gen_random_uuid(),
  knowledge_entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  version integer not null check (version >= 1),
  title text not null,
  content text not null,
  summary text,
  category text not null,
  tags text[] not null default '{}',
  source_name text,
  source_type text not null,
  source_url text,
  status text not null,
  visibility text not null,
  changed_by uuid references public.profiles (id) on delete set null,
  change_note text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (knowledge_entry_id, version)
);

create index if not exists knowledge_entry_revisions_entry_idx
  on public.knowledge_entry_revisions (knowledge_entry_id, version desc);

-- ---------------------------------------------------------------------------
-- knowledge_sources (future ingestion registry — no secrets)
-- ---------------------------------------------------------------------------
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null
    check (source_type in (
      'manual', 'policy', 'procedure', 'process', 'RACI',
      'Google Drive', 'GoHighLevel', 'Buildertrend', 'Domo',
      'Slack', 'uploaded_document', 'other'
    )),
  description text,
  status text not null default 'manual'
    check (status in ('manual', 'configured', 'active', 'paused', 'error', 'future')),
  external_identifier text,
  configuration_metadata jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists knowledge_sources_status_idx on public.knowledge_sources (status);
create index if not exists knowledge_sources_type_idx on public.knowledge_sources (source_type);

create trigger knowledge_sources_set_updated_at
  before update on public.knowledge_sources
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.knowledge_entries enable row level security;
alter table public.knowledge_entry_revisions enable row level security;
alter table public.knowledge_sources enable row level security;

-- Employees: approved + internal only
create policy "Employees can read approved internal knowledge"
  on public.knowledge_entries for select
  to authenticated
  using (
    status = 'approved'
    and visibility = 'internal'
  );

-- Admins: full read
create policy "Admins can read all knowledge entries"
  on public.knowledge_entries for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert knowledge entries"
  on public.knowledge_entries for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update knowledge entries"
  on public.knowledge_entries for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete knowledge entries"
  on public.knowledge_entries for delete
  to authenticated
  using (public.is_admin());

create policy "Admins can read knowledge revisions"
  on public.knowledge_entry_revisions for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert knowledge revisions"
  on public.knowledge_entry_revisions for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can read knowledge sources"
  on public.knowledge_sources for select
  to authenticated
  using (public.is_admin());

create policy "Admins can insert knowledge sources"
  on public.knowledge_sources for insert
  to authenticated
  with check (public.is_admin());

create policy "Admins can update knowledge sources"
  on public.knowledge_sources for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete knowledge sources"
  on public.knowledge_sources for delete
  to authenticated
  using (public.is_admin());
